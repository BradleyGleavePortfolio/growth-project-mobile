/**
 * HealthFitnessTab (HEALTH-1, `featureFlags.healthPages`, off): Fitness tab of
 * Health and sleep, MOCK-HEALTH op 1 slice 1 (boards 3, 8 to 12). The forest
 * masthead carries on under the shell's: today's Steps, Active energy and
 * Exercise minutes toward starter goals ("No sample yet", never zero) on this
 * phone's calendar day (raw samples summed per local day; server buckets are
 * UTC). Then the device, 7 days of steps as bars, Heart, Workouts, Body (no tap
 * when empty) and, for coached clients only, one coach line.
 */
import React, { useCallback, useMemo } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import api from '../../../services/api';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { useWearableConnections } from '../../../hooks/useWearableConnections';
import { isEffectivelyOnline, useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { configFor } from '../../../api/wearablesConnectionsApi';
import type { SampleSeries, SamplesResponse, WearableMetricType } from '../../../api/wearablesSamplesApi';
import { deviceSourceForPlatform } from '../../../services/health/onDeviceSync';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { PrimaryButton } from '../../../ui';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, semantic, spacing, typography } from '../../../theme/tokens';
import { useReduceMotion } from './components/useReduceMotion';
import WearableCard from './components/WearableCard';
import { metricMeta, toneTokens } from './wearablesTheme';
import { relativeTime } from './relativeTime';
import { STARTER_GOALS } from './starterGoals';
import HeartCard from './cards/HeartCard';
import WorkoutsCard from './cards/WorkoutsCard';
import BodyCard from './cards/BodyCard';
import WeekStepBars, { type StepDay } from './cards/WeekStepBars';

const TODAY = [
  { metric: 'STEPS', label: 'Steps', unit: 'steps' },
  { metric: 'ACTIVE_ENERGY_KCAL', label: 'Active energy', unit: 'kcal' },
  { metric: 'WORKOUT_DURATION_MIN', label: 'Exercise minutes', unit: 'min' },
] as const;
const HOUR_MS = 60 * 60 * 1000;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** A series summed per local day for the `n` days ending today, oldest first; null = no sample that day. */
export function localDayTotals(series: SampleSeries | undefined, now: Date, n: number): StepDay[] {
  const sums = new Map<string, number>();
  for (const s of series?.samples ?? []) {
    const at = new Date(s.start_at);
    if (!Number.isNaN(at.getTime())) sums.set(dayKey(at), (sums.get(dayKey(at)) ?? 0) + s.value);
  }
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i));
    return { date, total: sums.get(dayKey(date)) ?? null };
  });
}

/** When the shown data was read: "9:32 am" today, else "October 16". */
export function savedAt(ms: number, now: Date = new Date()): string {
  const d = new Date(ms);
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

const find = (data: SamplesResponse | undefined, metric: WearableMetricType) => data?.series.find((s) => s.metric === metric);
const has = (s: SampleSeries | undefined) => (s?.sample_count ?? 0) > 0;

interface Props {
  /** The shell's sync notice, drawn under the masthead. */
  readonly renderNotice?: () => React.ReactNode;
  readonly aiPanelSlot?: React.ReactNode;
}

export default function HealthFitnessTab({ renderNotice, aiPanelSlot }: Props) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const reduceMotion = useReduceMotion();
  const online = isEffectivelyOnline(useNetworkStatus());
  const accent = toneTokens('warm').accent;

  // 30 days to the end of this hour (so this hour counts), stable for the hour.
  const span = useMemo(() => {
    const to = new Date();
    to.setMinutes(0, 0, 0);
    const end = to.getTime() + HOUR_MS;
    return { from: new Date(end - 30 * 24 * HOUR_MS).toISOString(), to: new Date(end).toISOString() };
  }, []);
  const query = useWearableSamples({ bucket: 'HEALTH_FITNESS', ...span, granularity: 'day' });
  const rhrQuery = useWearableSamples({ bucket: 'SLEEP_RECOVERY', metric: 'RESTING_HEART_RATE_BPM', ...span, granularity: 'day' });
  const connectionsQuery = useWearableConnections();
  const { data, isLoading, isError, isRefetching, dataUpdatedAt } = query;

  const coachId = useCurrentUser()?.coach_id ?? null;
  const coach = useQuery({
    queryKey: ['wearables', 'coach-name', coachId],
    enabled: coachId != null,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => (await api.get<{ name?: string }>('/v1/clients/me/coach')).data?.name ?? null,
  });
  const coachFirst = typeof coach.data === 'string' ? coach.data.trim().split(/\s+/)[0] : '';

  const now = new Date();
  const week = localDayTotals(find(data, 'STEPS'), now, 7);
  const hasAnyData = (data?.series ?? []).some(has);
  const deviceSource = deviceSourceForPlatform();
  const linked = (connectionsQuery.data ?? []).filter(
    (c) => c.status !== 'disconnected' && (configFor(c.provider).buckets as readonly string[]).includes('HEALTH_FITNESS'),
  );
  const source = linked.find((c) => c.provider === deviceSource) ?? linked[0];
  const sourceName = source ? configFor(source.provider).displayName : null;
  const synced = source ? relativeTime(source.last_synced_at) : null;
  const platformName = Platform.OS === 'android' ? 'Health Connect' : 'Apple Health';
  const failed = !isLoading && !data;
  const showConnect = !isLoading && !failed && !source && !hasAnyData && connectionsQuery.data != null;

  const go = useCallback((screen: string, params?: object) => {
    void HapticService.selection();
    navigation.navigate(screen, params);
  }, [navigation]);
  const openMetric = (metric: WearableMetricType) =>
    go('WearableMetricDetail', { metric, bucket: metric === 'RESTING_HEART_RATE_BPM' ? 'SLEEP_RECOVERY' : 'HEALTH_FITNESS' });
  // Error haptic only when a Try again fails (board 12).
  const retry = async () => {
    if ((await query.refetch()).isError) void HapticService.error();
  };
  const rhr = find(rhrQuery.data, 'RESTING_HEART_RATE_BPM') ?? find(data, 'RESTING_HEART_RATE_BPM');
  const [weight, bodyFat, workouts] = [find(data, 'BODY_WEIGHT_KG'), find(data, 'BODY_FAT_PCT'), find(data, 'WORKOUT_DURATION_MIN')];
  const shape = (width: `${number}%`) => <View style={[styles.shape, { width, backgroundColor: sc.surface.forestBand }]} />;

  const masthead = isLoading ? (
    <View style={styles.rows}>
      {shape('55%')}
      {TODAY.map((m) => (
        <View key={m.metric} style={styles.shapeRow}>
          {shape('42%')}
          <View style={[styles.track, { backgroundColor: sc.surface.forestBand }]} />
        </View>
      ))}
    </View>
  ) : failed ? (
    <View style={[styles.errorBox, { borderColor: sc.data.plannedOnDark }]} testID="health-fitness-error">
      <Text style={[styles.errorText, { color: sc.textOnAccent }]} accessibilityRole="alert">
        The health server did not answer just now. Your data is safe. Try again.
      </Text>
      <Pressable
        onPress={() => void retry()}
        accessibilityRole="button"
        testID="health-fitness-retry"
        style={({ pressed }) => [styles.retry, { backgroundColor: sc.textOnAccent }, pressed && styles.pressed]}
      >
        <Ionicons name="refresh" size={18} color={sc.surface.masthead} />
        <Text style={[styles.retryText, { color: sc.surface.masthead }]}>Try again</Text>
      </Pressable>
    </View>
  ) : (
    <View style={styles.rows}>
      <Text style={[styles.date, { color: sc.textOnMastheadMuted }]}>
        {`Today · ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
      </Text>
      {TODAY.map(({ metric, label, unit }) => {
        const total = localDayTotals(find(data, metric), now, 1)[0].total;
        const goal = STARTER_GOALS[metric];
        const shown = total == null ? null : Math.round(total).toLocaleString('en-US');
        const goalText = `Starter goal: ${goal.toLocaleString('en-US')} ${unit}`;
        return (
          <View
            key={metric}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`${label}, ${shown == null ? 'No sample yet' : `${shown} ${unit}`}. ${goalText}`}
            accessibilityValue={total == null ? undefined : { min: 0, max: goal, now: Math.min(Math.round(total), goal) }}
            testID={`health-today-${metric}`}
          >
            <View style={styles.rowHead}>
              <Text style={[styles.rowLabel, { color: sc.textOnAccent }]}>{label}</Text>
              {shown == null ? (
                <Text style={[styles.none, { color: sc.textOnMastheadMuted }]}>No sample yet</Text>
              ) : (
                <Text style={[styles.value, { color: sc.textOnAccent }]}>
                  {shown}
                  <Text style={[styles.unit, { color: sc.textOnMastheadMuted }]}>{` ${unit}`}</Text>
                </Text>
              )}
            </View>
            <View style={[styles.track, { backgroundColor: sc.surface.forestBand }]}>
              {total != null && total > 0 && (
                <View style={[styles.track, styles.fill, { width: `${Math.min(1, total / goal) * 100}%`, backgroundColor: sc.data.leaf }]} />
              )}
            </View>
            <Text style={[styles.goal, { color: sc.textOnMastheadMuted }]}>{goalText}</Text>
          </View>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      accessibilityLabel={isLoading ? 'Loading your fitness overview' : undefined}
      testID="health-fitness-tab"
      refreshControl={data ? (
        <RefreshControl
          refreshing={isRefetching}
          tintColor={sc.textOnAccent}
          onRefresh={() => void Promise.all([query.refetch(), rhrQuery.refetch(), connectionsQuery.refetch()])}
        />
      ) : undefined}
    >
      <View style={[styles.masthead, { backgroundColor: sc.surface.masthead }]}>
        {/* A pull-down shows forest above the masthead, never a bone gap. */}
        <View style={[styles.bleed, { backgroundColor: sc.surface.masthead }]} />
        {masthead}
      </View>
      {isLoading ? (
        <View style={styles.body} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.placeholder, { height: 72, backgroundColor: sc.data.trackLight }]} />
          <View style={[styles.placeholder, { height: 240, backgroundColor: sc.data.trackLight }]} />
        </View>
      ) : failed ? null : (
        <View style={styles.body}>
          {renderNotice?.()}
          {(!online || isError) && (
            <View style={[styles.warm, { backgroundColor: semantic.warning.bg, borderColor: semantic.warning.border }]} testID="health-fitness-saved">
              <Ionicons name="cloud-offline-outline" size={18} color={semantic.warning.fg} />
              <Text style={[styles.body1, { color: semantic.warning.fg }]} accessibilityRole="alert">
                {!online && <Text style={styles.strong}>{"You're offline. "}</Text>}
                {`Showing your last synced data from ${savedAt(dataUpdatedAt, now)}.`}
              </Text>
            </View>
          )}
          {showConnect && (
            <View style={[styles.connect, { backgroundColor: sc.bgSurface, borderColor: sc.border }]} testID="health-fitness-connect">
              <Text style={[styles.connectTitle, { color: sc.textPrimary }]}>See your fitness in one place</Text>
              <Text style={[styles.body1, { color: sc.textMuted }]}>
                {`Connect ${platformName} to import activity, heart rate, workouts and body measurements.`}
              </Text>
              <PrimaryButton label={`Connect ${platformName}`} onPress={() => go('Connections')} haptic={false} style={styles.connectButton} />
            </View>
          )}
          {sourceName && (
            <WearableCard
              title={sourceName}
              icon="watch-outline"
              accent={accent}
              onPress={() => go('Connections')}
              accessibilityLabel={`Connected devices, ${sourceName}, ${synced ? `last synced ${synced}` : 'no sync yet'}`}
              accessibilityHint="Opens your connected devices"
            >
              <Text style={[styles.sub, { color: sc.textMuted }]}>{synced ? `Last synced ${synced}` : 'No sync yet'}</Text>
            </WearableCard>
          )}
          {(sourceName || hasAnyData) && (
            <>
              <WearableCard
                title="Last 7 days"
                icon={metricMeta('STEPS').icon}
                accent={accent}
                trailing={week.some((d) => d.total != null) ? (
                  <Pressable
                    onPress={() => openMetric('STEPS')}
                    accessibilityRole="button"
                    accessibilityHint="Open Steps detail"
                    style={({ pressed }) => [styles.link, pressed && styles.pressed]}
                    testID="health-week-steps"
                  >
                    <Text style={[styles.sub, { color: sc.textMuted }]}>Steps</Text>
                    <Ionicons name="chevron-forward" size={16} color={sc.textMuted} />
                  </Pressable>
                ) : undefined}
              >
                <WeekStepBars days={week} goal={STARTER_GOALS.STEPS} reduceMotion={reduceMotion} />
              </WearableCard>
              <HeartCard
                rhrSeries={rhr}
                tone="warm"
                onPress={has(rhr) ? () => openMetric('RESTING_HEART_RATE_BPM') : undefined}
                emptyText={sourceName ? `No heart rate from ${sourceName} yet. A watch that writes to ${sourceName} adds it.` : undefined}
              />
              <WorkoutsCard workoutSeries={workouts} tone="warm" onPress={has(workouts) ? () => openMetric('WORKOUT_DURATION_MIN') : undefined} />
              <BodyCard
                weightSeries={weight}
                bodyFatSeries={bodyFat}
                tone="warm"
                onPress={has(weight) || has(bodyFat) ? () => openMetric('BODY_WEIGHT_KG') : undefined}
                emptyText={sourceName ? `No weight from ${sourceName} yet. A scale that writes to ${sourceName} adds it.` : undefined}
              />
              {coachFirst ? (
                <View style={styles.coach} testID="health-coach-line">
                  <Ionicons name="person-outline" size={18} color={sc.textMuted} />
                  <Text style={[styles.sub, styles.grow, { color: sc.textMuted }]}>
                    {`${coachFirst} can see the health data your devices bring in.`}
                  </Text>
                </View>
              ) : null}
            </>
          )}
          {aiPanelSlot}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing['3xl'] },
  masthead: { paddingHorizontal: layout.gutter, paddingTop: spacing.sm, paddingBottom: spacing.xl, borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet },
  bleed: { position: 'absolute', left: 0, right: 0, top: -1000, height: 1000 },
  rows: { gap: spacing.lg },
  date: { ...typography.body },
  rowHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.md },
  rowLabel: { ...typography.bodyMd },
  value: { ...typography.h2, fontVariant: ['tabular-nums'] },
  unit: { ...typography.bodySmall },
  none: { ...typography.body },
  track: { height: 6, borderRadius: radius.chip, marginTop: spacing.sm, overflow: 'hidden' },
  fill: { marginTop: 0 },
  goal: { ...typography.bodySmall, marginTop: spacing.xs },
  shapeRow: { gap: spacing.xs },
  shape: { height: 14, borderRadius: radius.chip },
  errorBox: { borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.card, padding: spacing.xl, alignItems: 'center', gap: spacing.lg },
  errorText: { ...typography.body, textAlign: 'center' },
  retry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.touchMin, paddingHorizontal: spacing.xl, borderRadius: radius.button },
  retryText: { ...typography.bodyMd },
  pressed: { opacity: 0.8 },
  body: { padding: spacing.lg, gap: spacing.lg },
  placeholder: { borderRadius: radius.card },
  warm: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth },
  body1: { ...typography.body, flexShrink: 1 },
  strong: { fontFamily: 'Inter_600SemiBold' },
  connect: { padding: spacing.lg, gap: spacing.md, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth },
  connectTitle: { ...typography.h2 },
  connectButton: { paddingHorizontal: spacing.md }, // "Connect Health Connect" fits at 130% on 360 pt
  sub: { ...typography.bodySmall },
  link: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: layout.touchMin, paddingLeft: spacing.md },
  coach: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.xs },
  grow: { flex: 1 },
});
