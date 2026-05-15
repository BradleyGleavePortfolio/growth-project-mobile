/**
 * CoachBusinessMetricsScreen
 *
 * The coach's business surface — revenue, churn, MRR, sub-coach attribution,
 * packages, payouts. Backend contract lives in `src/api/coachConnectApi.ts`.
 *
 * When the backend is unreachable (404 / 501), the screen renders an honest
 * "Connect Stripe to enable revenue reporting" CTA. When the coach has not
 * onboarded yet (`configured === false` from /coach/connect/status), the
 * same CTA is shown. We never fabricate numbers.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  coachConnectApi,
  type BusinessMetrics,
  type ConnectResult,
  type ConnectStatus,
  type CoachPackage,
  type Payout,
} from '../../api/coachConnectApi';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

function formatPct(num: number, denom: number): string {
  if (denom <= 0) return '—';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function MetricCard({
  label,
  value,
  hint,
  styles,
}: {
  label: string;
  value: string;
  hint?: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      {hint ? <Text style={styles.metricHint}>{hint}</Text> : null}
    </View>
  );
}

function NotConfigured({
  onConnect,
  connecting,
  colors,
  styles,
}: {
  onConnect: () => void;
  connecting: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.gate}>
      <Ionicons name="card-outline" size={36} color={colors.textMuted} />
      <Text style={styles.gateTitle}>Connect Stripe to enable revenue</Text>
      <Text style={styles.gateBody}>
        Once you connect a Stripe account, this screen reports total revenue,
        churn, clients added, sub-coach attribution, and payout history. Until
        then no fake numbers are shown.
      </Text>
      <TouchableOpacity
        style={[styles.cta, connecting && styles.ctaDisabled]}
        onPress={onConnect}
        disabled={connecting}
        accessibilityRole="button"
        accessibilityLabel="Connect Stripe account"
      >
        {connecting ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={styles.ctaText}>Connect Stripe</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function ErrorBanner({
  message,
  onRetry,
  styles,
}: {
  message: string;
  onRetry: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      onPress={onRetry}
      accessibilityRole="button"
      accessibilityLabel="Retry loading metrics"
      style={styles.errorBanner}
    >
      <Ionicons name="alert-circle-outline" size={18} color="#fff" />
      <Text style={styles.errorBannerText}>{message} Tap to retry.</Text>
    </TouchableOpacity>
  );
}

export default function CoachBusinessMetricsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [status, setStatus] = useState<ConnectResult<ConnectStatus> | null>(null);
  const [metrics, setMetrics] = useState<ConnectResult<BusinessMetrics> | null>(null);
  const [payouts, setPayouts] = useState<ConnectResult<Payout[]> | null>(null);
  const [packages, setPackages] = useState<ConnectResult<CoachPackage[]> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, m, p, k] = await Promise.all([
      coachConnectApi.getStatus(),
      coachConnectApi.getMetrics(),
      coachConnectApi.getPayouts(5),
      coachConnectApi.getPackages(),
    ]);
    setStatus(s);
    setMetrics(m);
    setPayouts(p);
    setPackages(k);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleConnectStripe = useCallback(async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      const res = await coachConnectApi.createOnboardingLink();
      if (res.ok) {
        await Linking.openURL(res.data.url);
      } else if (res.reason === 'not_configured') {
        setConnectError(
          'Stripe onboarding is not yet available. Please reach out to support.',
        );
      } else {
        setConnectError(res.message);
      }
    } finally {
      setConnecting(false);
    }
  }, []);

  // Loading: any of the four queries is still null.
  if (!status || !metrics || !payouts || !packages) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const isNotConfigured =
    (status.ok && !status.data.configured) ||
    (!status.ok && status.reason === 'not_configured');

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.header}>Business</Text>
      <Text style={styles.subheader}>
        Revenue, churn, sub-coach attribution. Reported directly from your
        connected Stripe account.
      </Text>

      {isNotConfigured ? (
        <>
          {connectError ? <ErrorBanner message={connectError} onRetry={handleConnectStripe} styles={styles} /> : null}
          <NotConfigured onConnect={handleConnectStripe} connecting={connecting} colors={colors} styles={styles} />
        </>
      ) : (
        <>
          {/* Account status banner if KYC requirements due */}
          {status.ok && status.data.requirements_due.length > 0 ? (
            <TouchableOpacity
              style={styles.warnBanner}
              onPress={handleConnectStripe}
              accessibilityRole="button"
              accessibilityLabel="Complete Stripe verification"
            >
              <Ionicons name="warning-outline" size={18} color="#fff" />
              <Text style={styles.warnBannerText}>
                Stripe needs more info to enable payouts. Tap to finish.
              </Text>
            </TouchableOpacity>
          ) : null}

          {/* Revenue + MRR */}
          {metrics.ok ? (
            <>
              <View style={styles.cardRow}>
                <MetricCard
                  label="Revenue · 30d"
                  value={formatMoney(metrics.data.revenue_30d, metrics.data.currency)}
                  hint={`Net ${formatMoney(metrics.data.net_30d, metrics.data.currency)}`}
                  colors={colors}
                  styles={styles}
                />
                <MetricCard
                  label="MRR"
                  value={formatMoney(metrics.data.mrr, metrics.data.currency)}
                  hint={`Total ${formatMoney(metrics.data.total_revenue, metrics.data.currency)}`}
                  colors={colors}
                  styles={styles}
                />
              </View>

              {/* Clients */}
              <View style={styles.cardRow}>
                <MetricCard
                  label="Active clients"
                  value={String(metrics.data.active_clients)}
                  hint={`+${metrics.data.clients_added_30d} this month`}
                  colors={colors}
                  styles={styles}
                />
                <MetricCard
                  label="Churn · 30d"
                  value={String(metrics.data.clients_churned_30d)}
                  hint={formatPct(
                    metrics.data.clients_churned_30d,
                    metrics.data.active_clients + metrics.data.clients_churned_30d,
                  )}
                  colors={colors}
                  styles={styles}
                />
              </View>

              {/* Sub-coach attribution */}
              <Text style={styles.sectionTitle}>Sub-coach attribution · 30d</Text>
              <View style={styles.cardRow}>
                <MetricCard
                  label="Revenue"
                  value={formatMoney(metrics.data.sub_coach_revenue_30d, metrics.data.currency)}
                  colors={colors}
                  styles={styles}
                />
                <MetricCard
                  label="Acquired"
                  value={`+${metrics.data.sub_coach_acquisition_30d}`}
                  colors={colors}
                  styles={styles}
                />
                <MetricCard
                  label="Churned"
                  value={String(metrics.data.sub_coach_churn_30d)}
                  colors={colors}
                  styles={styles}
                />
              </View>
            </>
          ) : metrics.reason === 'error' ? (
            <ErrorBanner message={metrics.message} onRetry={load} styles={styles} />
          ) : null}

          {/* Packages */}
          <Text style={styles.sectionTitle}>Packages</Text>
          {packages.ok ? (
            packages.data.length === 0 ? (
              <Text style={styles.emptyText}>
                No packages yet. Create one in your Stripe dashboard.
              </Text>
            ) : (
              packages.data.map((p) => (
                <View key={p.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{p.name}</Text>
                    <Text style={styles.rowSub}>
                      {formatMoney(p.price, p.currency)}
                      {p.type === 'recurring' && p.interval ? ` / ${p.interval}` : ''}
                      {p.type === 'recurring' ? ` · ${p.active_subscribers} active` : ''}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      { backgroundColor: p.active ? colors.success + '22' : colors.textMuted + '22' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        { color: p.active ? colors.success : colors.textMuted },
                      ]}
                    >
                      {p.active ? 'Active' : 'Inactive'}
                    </Text>
                  </View>
                </View>
              ))
            )
          ) : packages.reason === 'error' ? (
            <ErrorBanner message={packages.message} onRetry={load} styles={styles} />
          ) : (
            <Text style={styles.emptyText}>Packages will appear once Stripe is connected.</Text>
          )}

          {/* Payouts */}
          <Text style={styles.sectionTitle}>Recent payouts</Text>
          {payouts.ok ? (
            payouts.data.length === 0 ? (
              <Text style={styles.emptyText}>No payouts yet.</Text>
            ) : (
              payouts.data.map((p) => (
                <View key={p.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{formatMoney(p.amount, p.currency)}</Text>
                    <Text style={styles.rowSub}>
                      {new Date(p.arrival_date).toLocaleDateString()}
                      {p.description ? ` · ${p.description}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.payoutStatus}>{p.status}</Text>
                </View>
              ))
            )
          ) : payouts.reason === 'error' ? (
            <ErrorBanner message={payouts.message} onRetry={load} styles={styles} />
          ) : (
            <Text style={styles.emptyText}>Payouts will appear once Stripe is connected.</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
    header: { fontSize: 28, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
    subheader: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: 20 },
    sectionTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 24,
      marginBottom: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    cardRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
    metricCard: {
      flex: 1,
      minWidth: 140,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    metricLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
    metricValue: { fontSize: 22, fontWeight: '600', color: colors.textPrimary },
    metricHint: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowTitle: { fontSize: 15, fontWeight: '500', color: colors.textPrimary },
    rowSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    payoutStatus: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase' },
    statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    statusPillText: { fontSize: 11, fontWeight: '600' },
    emptyText: { fontSize: 13, color: colors.textMuted, paddingVertical: 8 },
    gate: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
    gateTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginTop: 12 },
    gateBody: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    cta: {
      marginTop: 20,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    ctaDisabled: { opacity: 0.5 },
    ctaText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.error,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      marginBottom: 12,
    },
    errorBannerText: { color: '#fff', fontSize: 13, flex: 1 },
    warnBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.warning,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      marginBottom: 12,
    },
    warnBannerText: { color: '#fff', fontSize: 13, flex: 1 },
  });
