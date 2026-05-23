import React, { useCallback, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { SkeletonList } from '../../ui/skeletons/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

import { coachBillingApi, CoachBillingStatus, CoachInvoice } from '../../services/api';
import { mediumTap } from '../../utils/haptics';
import { track } from '../../lib/analytics';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage, errorStatus } from '../../types/common';
import { assertStripeUrl } from '../../utils/stripeUrlValidator';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

interface Props {
  navigation: NavigationProp<ParamListBase>;
}

const STATE_COPY: Record<
  CoachBillingStatus['state'],
  { label: string; description: string; tone: 'ok' | 'attention' | 'muted' }
> = {
  active: {
    label: 'Active',
    description: 'Your coach plan is active and billing is up to date.',
    tone: 'ok',
  },
  trialing: {
    label: 'Trial',
    description: 'You are inside the free trial window.',
    tone: 'ok',
  },
  past_due: {
    label: 'Past due',
    description: 'A recent payment did not go through. Update your card to keep access.',
    tone: 'attention',
  },
  paused: {
    label: 'Paused',
    description: 'Your seat is paused. Start your subscription to coach clients on the platform.',
    tone: 'attention',
  },
  canceled: {
    label: 'Canceled',
    description: 'Your subscription has ended. Re-subscribe to restore access.',
    tone: 'attention',
  },
  none: {
    label: 'No subscription',
    description: 'You do not have an active coach subscription yet.',
    tone: 'muted',
  },
};

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CoachBillingScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<CoachBillingStatus | null>(null);
  const [invoices, setInvoices] = useState<CoachInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      // Compact pill from /coach/billing/status. Invoice list from the
      // BFF /v1/coach/me/billing route. We fire both in parallel — the pill
      // is what blocks the loading spinner; invoices are best-effort and
      // their absence is non-fatal (some envs only deploy the compact
      // status route).
      const [statusRes, fullRes] = await Promise.allSettled([
        coachBillingApi.getStatus(),
        coachBillingApi.getFull(),
      ]);
      if (statusRes.status === 'fulfilled') {
        setStatus(statusRes.value.data ?? null);
      } else {
        const code = errorStatus(statusRes.reason);
        if (code === 404) {
          setStatus({ state: 'none' });
        } else {
          setError(
            errorMessage(
              statusRes.reason,
              'Could not load billing status. Check your connection and try again.',
            ),
          );
        }
      }
      if (fullRes.status === 'fulfilled') {
        setInvoices(fullRes.value.data?.invoices ?? []);
      } else {
        // Silent: invoice list is a nice-to-have. Keep the pill visible.
        setInvoices([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    track('coach_billing_opened');
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleOpenInvoice = useCallback(async (inv: CoachInvoice) => {
    const url = inv.hosted_invoice_url || inv.invoice_pdf;
    if (!url) return;
    mediumTap();
    try {
      assertStripeUrl(url, 'CoachBillingScreen.invoice');
    } catch {
      Alert.alert(
        'Could not open invoice',
        'Billing link is invalid. Please try again.',
      );
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
    } catch (err) {
      Alert.alert(
        'Could not open invoice',
        errorMessage(err, 'Please try again in a moment.'),
      );
    }
  }, []);

  const handleOpenPortal = useCallback(async () => {
    mediumTap();
    setPortalBusy(true);
    try {
      const res = await coachBillingApi.createPortalSession();
      const url = res.data?.url;
      if (!url) throw new Error('No portal URL returned');
      try {
        assertStripeUrl(url, 'CoachBillingScreen.portal');
      } catch {
        Alert.alert(
          'Billing portal unavailable',
          'Billing link is invalid. Please try again.',
        );
        return;
      }
      track('coach_billing_portal_opened');
      // Use openAuthSessionAsync so the sheet closes the moment the
      // portal redirects back to the app's tgp:// return URL. The old
      // openBrowserAsync path stayed open until the user tapped Done.
      const result = await WebBrowser.openAuthSessionAsync(url, 'tgp://');
      // After the sheet closes, refresh the status so any state change
      // made inside the portal (subscribe, update card, cancel) is
      // visible immediately. `openAuthSessionAsync` returns `success`
      // when the deep-link fires and `cancel`/`dismiss` otherwise; in
      // every case we want to refresh.
      if (
        result.type === 'success' ||
        result.type === 'cancel' ||
        result.type === 'dismiss'
      ) {
        await load();
      }
    } catch (err) {
      const msg =
        errorMessage(err, 'Could not open the billing portal. Please try again.');
      Alert.alert('Billing portal unavailable', msg);
    } finally {
      setPortalBusy(false);
    }
  }, [load]);

  const renderBody = () => {
    if (loading) {
      return <SkeletonList count={5} />;
    }
    if (error) {
      return (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
          <Text style={styles.errorTitle}>Could not load billing</Text>
          <Text style={styles.errorBody}>{error}</Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Retry"
          >
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }

    const s = status || { state: 'none' as const };
    const copy = STATE_COPY[s.state];
    const periodEnd = formatDate(s.currentPeriodEnd);
    const trialEnd = formatDate(s.trialEndsAt);

    return (
      <>
        <View style={[styles.statusCard, copy.tone === 'attention' && styles.statusCardAttention]}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusLabel}>Status</Text>
            <View
              style={[
                styles.statusPill,
                copy.tone === 'ok' && styles.statusPillOk,
                copy.tone === 'attention' && styles.statusPillAttention,
                copy.tone === 'muted' && styles.statusPillMuted,
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  copy.tone === 'ok' && styles.statusPillTextOk,
                  copy.tone === 'attention' && styles.statusPillTextAttention,
                  copy.tone === 'muted' && styles.statusPillTextMuted,
                ]}
              >
                {copy.label}
              </Text>
            </View>
          </View>
          <Text style={styles.statusBody}>{s.summary || copy.description}</Text>

          {(s.planName || s.seatLimit != null || periodEnd || trialEnd) && (
            <View style={styles.detailGrid}>
              {s.planName ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Plan</Text>
                  <Text style={styles.detailValue}>{s.planName}</Text>
                </View>
              ) : null}
              {s.seatLimit != null ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Seats</Text>
                  <Text style={styles.detailValue}>
                    {(s.seatsUsed ?? 0)} / {s.seatLimit}
                  </Text>
                </View>
              ) : null}
              {trialEnd && s.state === 'trialing' ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Trial ends</Text>
                  <Text style={styles.detailValue}>{trialEnd}</Text>
                </View>
              ) : null}
              {periodEnd ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>
                    {s.cancelAtPeriodEnd ? 'Ends on' : 'Renews on'}
                  </Text>
                  <Text style={styles.detailValue}>{periodEnd}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[styles.portalBtn, portalBusy && styles.portalBtnDisabled]}
          onPress={handleOpenPortal}
          disabled={portalBusy}
          accessibilityRole="button"
          accessibilityLabel={
            s.state === 'none' || s.state === 'paused' || s.state === 'canceled'
              ? 'Start subscription'
              : 'Manage billing'
          }
        >
          {portalBusy ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="open-outline" size={18} color={colors.textOnPrimary} />
              <Text style={styles.portalBtnText}>
                {s.state === 'none' || s.state === 'paused' || s.state === 'canceled'
                  ? 'Start subscription'
                  : 'Manage billing'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.fineprint}>
          Billing is handled by our payment provider in a secure browser session. Card
          details never touch the app.
        </Text>

        {invoices.length > 0 ? (
          <View style={styles.invoicesSection}>
            <Text style={styles.invoicesTitle}>Invoices</Text>
            {invoices.slice(0, 12).map((inv) => (
              <TouchableOpacity
                key={inv.id}
                style={styles.invoiceRow}
                onPress={() => handleOpenInvoice(inv)}
                disabled={!inv.hosted_invoice_url && !inv.invoice_pdf}
                accessibilityRole="button"
                accessibilityLabel={`Invoice ${formatDate(inv.created_at) ?? ''}, ${inv.status}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.invoiceDate}>
                    {formatDate(inv.created_at) ?? 'Unknown date'}
                  </Text>
                  <Text style={styles.invoiceMeta}>
                    {(inv.currency || 'usd').toUpperCase()}{' '}
                    {((inv.amount_paid_cents || inv.amount_due_cents || 0) / 100).toFixed(2)}
                    {' · '}
                    {inv.status}
                  </Text>
                </View>
                {inv.hosted_invoice_url || inv.invoice_pdf ? (
                  <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Billing</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {renderBody()}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  topTitle: { fontSize: 18, fontWeight: '500', color: colors.textPrimary },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  loadingWrap: { paddingVertical: 60, alignItems: 'center' },
  errorWrap: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  errorTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  errorBody: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  retryText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 18,
    marginBottom: 16,
  },
  statusCardAttention: {
    borderLeftWidth: 2,
    borderLeftColor: colors.warning,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillOk: { backgroundColor: colors.primaryPale },
  statusPillAttention: { backgroundColor: colors.noticeWarningIconBg },
  statusPillMuted: { backgroundColor: colors.surfaceElevated },
  statusPillText: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase' },
  statusPillTextOk: { color: colors.primary },
  statusPillTextAttention: { color: colors.warning },
  statusPillTextMuted: { color: colors.textMuted },
  statusBody: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  detailGrid: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailKey: { fontSize: 13, color: colors.textSecondary },
  detailValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
  portalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    borderRadius: 2,
    marginBottom: 12,
  },
  portalBtnDisabled: { opacity: 0.6 },
  portalBtnText: { color: colors.textOnPrimary, fontSize: 15, fontWeight: '500' },
  fineprint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  invoicesSection: {
    marginTop: 28,
  },
  invoicesTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 14,
    marginBottom: 6,
    gap: 8,
  },
  invoiceDate: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
  invoiceMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  });
