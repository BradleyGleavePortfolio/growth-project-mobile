import React, { useCallback, useEffect, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { Colors } from '../../constants/colors';
import { coachBillingApi, CoachBillingStatus } from '../../services/api';
import { mediumTap } from '../../utils/haptics';
import { track } from '../../lib/analytics';

interface Props {
  navigation: any;
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
  const [status, setStatus] = useState<CoachBillingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await coachBillingApi.getStatus();
      setStatus(res.data ?? null);
    } catch (err: any) {
      const code = err?.response?.status;
      if (code === 404) {
        // Backend has not deployed billing yet — render an explicit, accurate
        // empty state instead of a vague spinner.
        setStatus({ state: 'none' });
      } else {
        setError(
          err?.response?.data?.message ||
            'Could not load billing status. Check your connection and try again.',
        );
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

  const handleOpenPortal = useCallback(async () => {
    mediumTap();
    setPortalBusy(true);
    try {
      const res = await coachBillingApi.createPortalSession();
      const url = res.data?.url;
      if (!url) throw new Error('No portal URL returned');
      track('coach_billing_portal_opened');
      const result = await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
      // After the sheet closes, refresh the status so any state change made
      // inside the portal (subscribe, update card, cancel) is visible
      // immediately.
      if (result.type === 'cancel' || result.type === 'dismiss' || result.type === 'opened') {
        await load();
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        'Could not open the billing portal. Please try again.';
      Alert.alert('Billing portal unavailable', msg);
    } finally {
      setPortalBusy(false);
    }
  }, [load]);

  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle-outline" size={28} color={Colors.error} />
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
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="open-outline" size={18} color={Colors.textOnPrimary} />
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
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Billing</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
      >
        {renderBody()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  topTitle: { fontSize: 18, fontWeight: '500', color: Colors.textPrimary },
  content: { paddingHorizontal: 24, paddingBottom: 40 },
  loadingWrap: { paddingVertical: 60, alignItems: 'center' },
  errorWrap: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  errorTitle: { fontSize: 16, fontWeight: '500', color: Colors.textPrimary },
  errorBody: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  retryText: { color: Colors.primary, fontSize: 14, fontWeight: '600' },
  statusCard: {
    backgroundColor: Colors.surface,
    borderRadius: 4,
    padding: 18,
    marginBottom: 16,
  },
  statusCardAttention: {
    borderLeftWidth: 2,
    borderLeftColor: Colors.warning,
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
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillOk: { backgroundColor: Colors.primaryPale },
  statusPillAttention: { backgroundColor: Colors.noticeWarningIconBg },
  statusPillMuted: { backgroundColor: Colors.surfaceElevated },
  statusPillText: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase' },
  statusPillTextOk: { color: Colors.primary },
  statusPillTextAttention: { color: Colors.warning },
  statusPillTextMuted: { color: Colors.textMuted },
  statusBody: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20 },
  detailGrid: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailKey: { fontSize: 13, color: Colors.textSecondary },
  detailValue: { fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  portalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 2,
    marginBottom: 12,
  },
  portalBtnDisabled: { opacity: 0.6 },
  portalBtnText: { color: Colors.textOnPrimary, fontSize: 15, fontWeight: '500' },
  fineprint: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
