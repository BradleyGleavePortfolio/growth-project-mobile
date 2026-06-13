/**
 * CoachEarningsScreen — net earnings summary + per-package breakdown.
 *
 * Wires GET /v1/coach/earnings. Reads `lastPayoutAt`, `nextPayoutEta`, and
 * a per-package breakdown — no fictional projections. If the endpoint isn't
 * deployed (404), the screen renders an honest "coming soon" state.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

import { coachPackagesApi, CoachEarningsSummary } from '../../../api/packagesApi';
import { errorMessage, errorStatus } from '../../../types/common';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { formatCurrencyCents } from '../../../utils/currency';
import { track } from '../../../lib/analytics';
import { featureFlags } from '../../../config/featureFlags';
// §2.12 Coach payout — Roman confirms the last payout in his voice, beside his
// face (RomanPayoutNotice co-locates <RomanAvatar />). Gated behind
// featureFlags.romanChat (default OFF), the dedicated Roman flag.
import RomanPayoutNotice from '../../../components/roman/RomanPayoutNotice';

// The normalised CoachEarningsSummary deliberately does NOT carry the
// destination bank's last-four (payouts are Stripe-managed and the digits are
// not exposed to the mobile contract — see api/packagesApi.ts
// CoachEarningsSummary). Rather than invent or mask digits, the §2.12 notice
// omits the bankLast4 prop entirely; romanPayout then drops the "account
// ending …" clause and states only the real amount + settlement window.
// Documented in FIXER_241_R5_REPORT.md.

interface Props {
  navigation: NavigationProp<ParamListBase>;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function CoachEarningsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<CoachEarningsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setUnavailable(null);
    try {
      const res = await coachPackagesApi.earnings();
      setData(res.data);
    } catch (err) {
      if (errorStatus(err) === 404) {
        setUnavailable(
          errorMessage(
            err,
            'Earnings reporting is not enabled in this environment yet. It will appear once the marketplace launches.',
          ),
        );
      } else {
        setError(errorMessage(err, 'Could not load earnings.'));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    track('coach_earnings_opened');
    load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

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
        <Text style={styles.topTitle}>Earnings</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : unavailable ? (
          <View style={styles.emptyCard}>
            <Ionicons name="construct-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Earnings coming soon</Text>
            <Text style={styles.emptyBody}>{unavailable}</Text>
          </View>
        ) : error ? (
          <View style={styles.emptyCard}>
            <Ionicons name="alert-circle-outline" size={28} color={colors.error} />
            <Text style={styles.emptyTitle}>Could not load earnings</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : data ? (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Pending payout</Text>
              <Text style={styles.heroValue}>
                {formatCurrencyCents(data.pendingPayoutCents, data.currency)}
              </Text>
              {data.nextPayoutEta ? (
                <Text style={styles.heroMeta}>
                  Next payout {formatDate(data.nextPayoutEta)}
                </Text>
              ) : null}
            </View>

            <View style={styles.gridRow}>
              <View style={styles.gridCard}>
                <Text style={styles.gridLabel}>This month</Text>
                <Text style={styles.gridValue}>
                  {formatCurrencyCents(data.monthToDateNetCents, data.currency)}
                </Text>
              </View>
              <View style={styles.gridCard}>
                <Text style={styles.gridLabel}>Lifetime</Text>
                <Text style={styles.gridValue}>
                  {formatCurrencyCents(data.lifetimeNetCents, data.currency)}
                </Text>
              </View>
            </View>

            {data.lastPayoutAt ? (
              <View style={styles.lastPayoutCard}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.primary} />
                <Text style={styles.lastPayoutText}>
                  Last payout:{' '}
                  {formatCurrencyCents(data.lastPayoutAmountCents ?? 0, data.currency)} on{' '}
                  {formatDate(data.lastPayoutAt)}
                </Text>
              </View>
            ) : null}

            {/* §2.12 Roman payout notice — voiced beside his face. Only when the
                Roman flag is on AND a real last payout exists (amount + a
                formattable send date). All tokens are real: amount from
                data.lastPayoutAmountCents, sentOn from the actual
                data.lastPayoutAt timestamp. The copy is past tense because the
                CoachEarningsSummary contract carries only the historical send
                time, not an in-transit/settlement signal (api/packagesApi.ts).
                The bank last-four is NOT in the summary contract, so it is
                omitted — romanPayout drops the destination-account clause
                rather than ship a placeholder token. */}
            {featureFlags.romanChat &&
            data.lastPayoutAmountCents != null &&
            formatDate(data.lastPayoutAt) ? (
              <RomanPayoutNotice
                amount={formatCurrencyCents(data.lastPayoutAmountCents, data.currency)}
                sentOn={formatDate(data.lastPayoutAt) as string}
                mode="default"
                testID="roman-payout-card"
              />
            ) : null}

            <Text style={styles.sectionTitle}>By package</Text>
            {data.perPackage.length === 0 ? (
              <View style={styles.emptyInline}>
                <Text style={styles.emptyInlineText}>
                  No active package revenue this month yet.
                </Text>
              </View>
            ) : (
              data.perPackage.map((p) => (
                <View key={p.packageId} style={styles.pkgRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pkgTitle} numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Text style={styles.pkgMeta}>
                      {p.activeSubscribers}{' '}
                      {p.activeSubscribers === 1 ? 'subscriber' : 'subscribers'}
                    </Text>
                  </View>
                  <Text style={styles.pkgAmount}>
                    {formatCurrencyCents(p.monthToDateGrossCents, data.currency)}
                  </Text>
                </View>
              ))
            )}

            <Text style={styles.fineprint}>
              Amounts shown are net of platform fees and Stripe processing fees.
              Stripe sends payouts to your linked bank automatically on its
              standard schedule (typically every 2 business days after a sale).
            </Text>
          </>
        ) : null}
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
    heroCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 22,
      marginBottom: 12,
    },
    heroLabel: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    heroValue: { fontSize: 32, fontWeight: '400', color: colors.textPrimary },
    heroMeta: { marginTop: 6, fontSize: 12, color: colors.textSecondary },
    gridRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
    gridCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 16,
    },
    gridLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
    gridValue: { fontSize: 20, fontWeight: '500', color: colors.textPrimary, marginTop: 4 },
    lastPayoutCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.primaryPale,
      padding: 12,
      borderRadius: 4,
      marginBottom: 18,
    },
    lastPayoutText: { flex: 1, fontSize: 13, color: colors.textPrimary },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 8,
      marginTop: 4,
    },
    pkgRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      marginBottom: 6,
    },
    pkgTitle: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
    pkgMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    pkgAmount: { fontSize: 14, color: colors.textPrimary, fontWeight: '500' },
    emptyInline: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 16,
    },
    emptyInlineText: { color: colors.textSecondary, fontSize: 13 },
    emptyCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 24,
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: colors.textPrimary,
      marginTop: 4,
    },
    emptyBody: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
      paddingHorizontal: 8,
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
    fineprint: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
      marginTop: 20,
    },
  });
