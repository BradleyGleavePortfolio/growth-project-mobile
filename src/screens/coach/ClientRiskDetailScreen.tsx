// PTM Phase 1E — Client Risk Detail
//
// Renders the latest PtmPrediction for one client: bucket dot, risk %,
// the per-factor "why" list, a 14-row history list, and a "Send check-in
// nudge" button that POSTs through the existing coachApi.sendNudge wire.
//
// Doctrine:
//   - We render `factors[].label` and the sign of `factors[].contribution`
//     only — never the engine basis (`heuristic_v1` / `weighted_v2`) nor
//     internal keys.
//   - Coaches/owners only. Students never reach this screen.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { useRoute, RouteProp } from '@react-navigation/native';
import RiskDot from '../../components/RiskDot';
import FactorRow from '../../components/FactorRow';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { ptmApi, ClientPtmResponse } from '../../services/ptmApi';
import { coachApi } from '../../services/api';

type RouteParams = { ClientRiskDetail: { userId: string; clientName?: string } };

const NUDGE_TITLE = 'Quick check-in';
const NUDGE_BODY = 'Just checking in — how are things this week?';

export default function ClientRiskDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const route = useRoute<RouteProp<RouteParams, 'ClientRiskDetail'>>();
  const { userId, clientName } = route.params;
  const currentUser = useCurrentUser();
  const isAuthorized = currentUser?.role === 'owner' || currentUser?.role === 'coach';

  const [data, setData] = useState<ClientPtmResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nudging, setNudging] = useState(false);
  const [nudgeSent, setNudgeSent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ptmApi.getClientPtm(userId);
      setData(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load risk detail.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!isAuthorized) return;
    load();
  }, [isAuthorized, load]);

  const onNudge = useCallback(async () => {
    if (nudging || nudgeSent) return;
    setNudging(true);
    try {
      await coachApi.sendNudge(userId, { title: NUDGE_TITLE, body: NUDGE_BODY });
      setNudgeSent(true);
    } catch (err) {
      Alert.alert(
        'Could not send nudge',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setNudging(false);
    }
  }, [nudgeSent, nudging, userId]);

  if (!isAuthorized) {
    return (
      <View style={styles.container}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderTitle}>Not available</Text>
          <Text style={styles.placeholderBody}>
            This view is restricted.
          </Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorTitle}>Could not load</Text>
        <Text style={styles.errorBody}>{error ?? 'No data returned.'}</Text>
      </View>
    );
  }

  const current = data.current;
  const bucket =
    current.risk_score <= 0.3 ? 'green' : current.risk_score <= 0.6 ? 'amber' : 'red';
  const sortedFactors = [...current.factors].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Risk detail</Text>
        <Text style={styles.title} numberOfLines={1}>
          {clientName ?? data.user.name}
        </Text>
        <Text style={styles.email}>{data.user.email}</Text>
      </View>

      <View style={styles.heroCard}>
        <RiskDot bucket={bucket} size={40} />
        <View style={styles.heroBody}>
          <Text style={styles.heroScore}>
            {Math.round(current.risk_score * 100)}%
          </Text>
          <Text style={styles.heroLabel}>Risk score</Text>
        </View>
      </View>

      {data.outcome_label && (
        <View style={styles.outcomeBadge}>
          <Text style={styles.outcomeText}>Outcome: {data.outcome_label}</Text>
        </View>
      )}

      <HapticPressable
        intent="medium"
        style={[
          styles.nudgeBtn,
          (nudging || nudgeSent) && styles.nudgeBtnDisabled,
        ]}
        onPress={onNudge}
        disabled={nudging || nudgeSent}
        accessibilityRole="button"
        accessibilityLabel="Send check-in nudge"
      >
        <Text style={styles.nudgeText}>
          {nudgeSent ? 'Nudge sent' : nudging ? 'Sending…' : 'Send check-in nudge'}
        </Text>
      </HapticPressable>

      <Text style={styles.sectionTitle}>Why</Text>
      {sortedFactors.length === 0 ? (
        <Text style={styles.muted}>No contributing factors yet.</Text>
      ) : (
        sortedFactors.map((f) => (
          <FactorRow
            key={f.key}
            label={f.label}
            contribution={f.contribution}
            observed={f.observed}
          />
        ))
      )}

      <Text style={styles.sectionTitle}>Score history</Text>
      {data.history.length === 0 ? (
        <Text style={styles.muted}>No history yet.</Text>
      ) : (
        data.history.slice(0, 14).map((h) => (
          <View key={h.id} style={styles.historyRow}>
            <Text style={styles.historyDate}>
              {new Date(h.computed_at).toLocaleDateString()}
            </Text>
            <Text style={styles.historyScore}>
              {Math.round(h.risk_score * 100)}%
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingTop: 60,
      paddingHorizontal: 24,
      paddingBottom: 100,
    },
    center: { justifyContent: 'center', alignItems: 'center' },
    header: { marginBottom: 20 },
    eyebrow: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      letterSpacing: 1.98,
      textTransform: 'uppercase',
      color: colors.textMuted,
      marginBottom: 6,
    },
    title: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      color: colors.textPrimary,
    },
    email: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 2,
    },
    heroCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      padding: 20,
      backgroundColor: colors.surface,
      borderRadius: 4,
      marginBottom: 16,
    },
    heroBody: { flex: 1 },
    heroScore: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 44,
      color: colors.textPrimary,
    },
    heroLabel: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
      marginTop: -4,
    },
    outcomeBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 4,
      backgroundColor: colors.primaryTint,
      marginBottom: 16,
    },
    outcomeText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 12,
      color: colors.primary,
    },
    nudgeBtn: {
      paddingVertical: 14,
      borderRadius: 0,
      backgroundColor: colors.primary,
      alignItems: 'center',
      marginBottom: 24,
    },
    nudgeBtnDisabled: {
      opacity: 0.5,
    },
    nudgeText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: colors.textOnPrimary,
    },
    sectionTitle: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 20,
      color: colors.textPrimary,
      marginBottom: 12,
      marginTop: 8,
    },
    muted: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textMuted,
      marginBottom: 12,
    },
    historyRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    historyDate: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
    },
    historyScore: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: colors.textPrimary,
    },
    placeholder: {
      flex: 1,
      paddingHorizontal: 32,
      paddingTop: 120,
      alignItems: 'center',
      gap: 8,
    },
    placeholderTitle: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 24,
      color: colors.textPrimary,
    },
    placeholderBody: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    errorTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
      color: colors.textPrimary,
    },
    errorBody: {
      fontFamily: 'Inter_400Regular',
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 32,
      marginTop: 8,
    },
  });
