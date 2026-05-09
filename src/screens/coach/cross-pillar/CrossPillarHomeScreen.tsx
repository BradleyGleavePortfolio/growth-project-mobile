/**
 * CrossPillarHomeScreen — Stage-3 cross-pillar coach dashboard.
 *
 * Replaces the Stage-2 BothPillarsScreen stub with the live federated
 * dashboard. Renders practice analytics fanned out across both Body
 * (this fitness backend) and Wealth (the finance backend, called
 * server-to-server via the existing FederationService — the mobile app
 * never reaches finance directly).
 *
 * Doctrine notes:
 *   - Loading state is a skeleton, not a spinner. Reduce-Motion replaces
 *     the shimmer with a quiet ActivityIndicator.
 *   - Empty / unavailable / error states are designed first-class — never
 *     a bare "—".
 *   - The screen never crashes on a degraded finance call. The coarse
 *     `finance.status` from the cross-pillar response collapses to a
 *     calm pill at the top: "Wealth temporarily unavailable".
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { crossPillarApi } from '../../../services/api';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import { Typography } from '../../../theme';
import type {
  CrossPillarAnalyticsResponse,
  CrossPillarRosterResponse,
} from '../../../types/crossPillar';
import type { CrossPillarStackParamList } from './CrossPillarNavigator';

type Nav = NativeStackNavigationProp<CrossPillarStackParamList, 'CrossPillarHome'>;

interface ScreenState {
  analytics: CrossPillarAnalyticsResponse | null;
  roster: CrossPillarRosterResponse | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

export default function CrossPillarHomeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();

  const [state, setState] = useState<ScreenState>({
    analytics: null,
    roster: null,
    loading: true,
    refreshing: false,
    error: null,
  });
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => setReduceMotion(!!v))
      .catch(() => setReduceMotion(false));
  }, []);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    setState((s) => ({
      ...s,
      loading: mode === 'initial',
      refreshing: mode === 'refresh',
      error: null,
    }));
    try {
      const [analytics, roster] = await Promise.all([
        crossPillarApi.getAnalytics().then((r) => r.data),
        crossPillarApi.getClients().then((r) => r.data),
      ]);
      setState({
        analytics,
        roster,
        loading: false,
        refreshing: false,
        error: null,
      });
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: toMessage(err),
      }));
    }
  }, []);

  useEffect(() => {
    load('initial');
  }, [load]);

  const goRoster = () => navigation.navigate('CrossPillarClients');
  const goSearch = () => navigation.navigate('CrossPillarClients', { focus: 'search' });
  const goMessages = () => navigation.navigate('CrossPillarMessages');
  const goAssignments = () => navigation.navigate('CrossPillarAssignments');

  return (
    <ScrollView
      style={styles.safe}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={state.refreshing}
          onRefresh={() => load('refresh')}
          tintColor={colors.textSecondary}
        />
      }
    >
      <View style={styles.headerBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>BOTH PILLARS</Text>
        <View style={{ width: 32 }} />
      </View>

      <Text style={styles.eyebrow}>CROSS-PILLAR PRACTICE</Text>
      <Text style={styles.headline}>One roster. Both pillars.</Text>
      <Text style={styles.lede}>
        Body and Wealth, together. Search any client, see their full picture
        across both products, and message or assign without flipping apps.
      </Text>

      {state.loading ? (
        <LoadingBlock styles={styles} reduceMotion={reduceMotion} colors={colors} />
      ) : state.error ? (
        <ErrorBlock
          styles={styles}
          message={state.error}
          onRetry={() => load('initial')}
        />
      ) : (
        <>
          {/* Wealth unavailability pill — shown once, calm. */}
          {state.roster?.finance.status === 'unavailable' ? (
            <View style={styles.warningBanner}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.warningText}>
                Wealth backend temporarily unavailable. Finance figures will
                refresh on the next pull.
              </Text>
            </View>
          ) : null}

          <View style={styles.statsGrid}>
            <StatTile
              styles={styles}
              label="ACTIVE CLIENTS"
              value={state.analytics?.fitness.client_count ?? 0}
              hint={`${state.analytics?.fitness.active_client_count_7d ?? 0} active in last 7d`}
            />
            <StatTile
              styles={styles}
              label="WEALTH USERS"
              value={state.analytics?.finance.data?.users?.total ?? 0}
              hint={
                state.analytics?.finance.status === 'ok'
                  ? `${state.analytics.finance.data?.engagement?.wau ?? 0} WAU`
                  : 'Backend unavailable'
              }
              degraded={state.analytics?.finance.status !== 'ok'}
            />
          </View>

          <Text style={styles.sectionLabel}>YOUR ROSTER</Text>
          <Pressable style={styles.actionRow} onPress={goRoster}>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>
                {state.roster?.results.length ?? 0} client
                {state.roster?.results.length === 1 ? '' : 's'}
              </Text>
              <Text style={styles.actionSubtitle}>
                {state.roster
                  ? `${state.roster.finance.ok_count} on both pillars · ${
                      state.roster.results.length - state.roster.finance.ok_count
                    } body-only`
                  : 'Tap to view'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
          </Pressable>

          <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
          <View style={styles.quickGrid}>
            <QuickTile
              styles={styles}
              icon="search-outline"
              label="Universal search"
              onPress={goSearch}
              colors={colors}
            />
            <QuickTile
              styles={styles}
              icon="chatbubbles-outline"
              label="Combined inbox"
              onPress={goMessages}
              colors={colors}
            />
            <QuickTile
              styles={styles}
              icon="checkmark-done-outline"
              label="All assignments"
              onPress={goAssignments}
              colors={colors}
            />
          </View>

          <Text style={styles.footnote}>
            Identity join key: email. Two products owned by the same person
            under different emails appear as two records until a durable shared
            identity ships.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

interface BlockStyles {
  styles: ReturnType<typeof makeStyles>;
}

function LoadingBlock({
  styles,
  reduceMotion,
  colors,
}: BlockStyles & { reduceMotion: boolean; colors: ThemeColors }) {
  if (reduceMotion) {
    return (
      <View style={styles.spinnerBlock}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    );
  }
  return (
    <View style={styles.skeletonContainer}>
      <View style={[styles.skeletonStat, { width: '47%' }]} />
      <View style={[styles.skeletonStat, { width: '47%' }]} />
      <View style={[styles.skeletonRow, { marginTop: 12 }]} />
      <View style={[styles.skeletonRow, { width: '70%' }]} />
    </View>
  );
}

function ErrorBlock({
  styles,
  message,
  onRetry,
}: BlockStyles & { message: string; onRetry: () => void }) {
  return (
    <View style={styles.errorBlock}>
      <Text style={styles.errorTitle}>Couldn't load</Text>
      <Text style={styles.errorBody}>{message}</Text>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Retry"
      >
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

function StatTile({
  styles,
  label,
  value,
  hint,
  degraded,
}: BlockStyles & {
  label: string;
  value: number;
  hint: string;
  degraded?: boolean;
}) {
  return (
    <View style={[styles.statTile, degraded && styles.statTileDegraded]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statHint}>{hint}</Text>
    </View>
  );
}

function QuickTile({
  styles,
  icon,
  label,
  onPress,
  colors,
}: BlockStyles & {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  colors: ThemeColors;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickTile, pressed && { opacity: 0.85 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={colors.textPrimary} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function toMessage(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? 'Something went wrong.');
  }
  return 'Something went wrong.';
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    content: { padding: 24, paddingBottom: 80 },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 16,
    },
    backBtn: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      ...Typography.label,
      color: colors.textSecondary,
    },
    eyebrow: { ...Typography.label, color: colors.textSecondary },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 32,
      lineHeight: 36,
      color: colors.textPrimary,
      marginTop: 4,
    },
    lede: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      marginTop: 8,
      marginBottom: 24,
    },
    warningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 10,
      marginBottom: 16,
    },
    warningText: { ...Typography.caption, color: colors.textSecondary, flex: 1 },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 24,
    },
    statTile: {
      flexBasis: '47%',
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 14,
      gap: 4,
    },
    statTileDegraded: { opacity: 0.5 },
    statLabel: { ...Typography.label, color: colors.textMuted, fontSize: 10, letterSpacing: 1.6 },
    statValue: {
      fontFamily: 'CormorantGaramond_500Medium',
      fontSize: 28,
      color: colors.textPrimary,
    },
    statHint: { ...Typography.caption, color: colors.textMuted },
    sectionLabel: {
      ...Typography.label,
      color: colors.textMuted,
      letterSpacing: 1.5,
      marginTop: 8,
      marginBottom: 8,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 24,
    },
    actionTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 16,
      color: colors.textPrimary,
    },
    actionSubtitle: { ...Typography.caption, color: colors.textMuted, marginTop: 2 },
    quickGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
      marginBottom: 24,
    },
    quickTile: {
      flexBasis: '47%',
      flexGrow: 1,
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      paddingVertical: 18,
      paddingHorizontal: 14,
      gap: 8,
    },
    quickLabel: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: colors.textPrimary,
    },
    footnote: {
      ...Typography.caption,
      color: colors.textMuted,
      fontStyle: 'italic',
      marginTop: 24,
    },
    spinnerBlock: { paddingVertical: 32, alignItems: 'center' },
    skeletonContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    skeletonStat: {
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      height: 92,
    },
    skeletonRow: {
      width: '100%',
      height: 14,
      backgroundColor: colors.surface,
    },
    errorBlock: {
      backgroundColor: colors.surface,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 16,
      gap: 8,
    },
    errorTitle: { fontFamily: 'Inter_500Medium', fontSize: 16, color: colors.textPrimary },
    errorBody: { ...Typography.caption, color: colors.textMuted },
    retryText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: colors.primary },
  });
