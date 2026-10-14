/**
 * RingsHomeScreen — UI-1 client Home, "rings and tiles" (owner 10-09; V1_1_UI_SPEC UI-1),
 * rendered by HomeScreen when featureFlags.clientHomeRings is on. HomeScreen keeps the
 * day and workout reads; this layout shows the coach row and bell (coachless: Roman
 * locked), the date, three dials (each its own number and screen), Join a coach for a
 * coachless client (m#654) and the day's one forest button. Roman's line, the tiles,
 * Edit tiles and the notice slot follow in the next UI-1 pull requests.
 */
import React, { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, typography } from '../../../theme/tokens';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useTodayCheckIn } from '../../../hooks/useApi';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { bucketDateLocal } from '../../../utils/date';
import type { WorkoutRowLike } from '../../../utils/workout/workoutDoneToday';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { PrimaryButton } from '../../../ui';
import HomeHeaderActions from '../../../components/home/HomeHeaderActions';
import CoachlessHomeSlot from '../../../components/coachless/CoachlessHomeSlot';
import HomeDial from '../../../components/home/rings/HomeDial';
import { foodDial, lastNightSleep, sleepDial, trainDial, type DialView, type ReadState } from '../../../components/home/rings/homeRings';
import { homeDateLine } from '../homeDate';

/** The raw workout reads behind the Train dial (null = that read failed). */
export interface RingsWorkoutReads {
  history: WorkoutRowLike[] | null;
  assignments: ClientWorkoutAssignmentWithPlan[] | null;
}

export interface RingsHomeScreenProps {
  day: { ready: boolean; error: string | null; retrying: boolean; calories: number | undefined; calorieTarget: number | undefined };
  workout: RingsWorkoutReads & { exists: boolean | 'loading'; label: string; hint: string; onContinue: () => void };
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}

const readState = (q: { isSuccess: boolean; isError: boolean }): ReadState => (q.isSuccess ? 'ok' : q.isError ? 'failed' : 'pending');

const dialLabel = (name: string, v: DialView): string =>
  [name, `${v.value}${v.unit ? ` ${v.unit}` : ''}`, v.sub].filter(Boolean).join(', ');

export default function RingsHomeScreen({ day, workout, refreshing, onRefresh }: RingsHomeScreenProps) {
  const { semanticColors: sc } = useTheme();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  // One window per local day (last 7 days through tomorrow's midnight), so the query key is
  // stable: Home reopens on cached data and pull to refresh refetches the same key.
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = bucketDateLocal(now, timeZone);
  const range = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    return { from: new Date(y, m - 1, d - 7).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() };
  }, [today, timeZone]);
  const sleepRead = useWearableSamples(
    { bucket: 'SLEEP_RECOVERY', from: range.from, to: range.to, granularity: 'day', preferredOnly: true },
    { enabled: !!currentUser },
  );
  const checkIn = useTodayCheckIn(today, !!currentUser);
  const refresh = useCallback(async () => {
    await Promise.all([onRefresh(), sleepRead.refetch(), checkIn.refetch()]);
  }, [onRefresh, sleepRead.refetch, checkIn.refetch]);

  const food = foodDial({ ready: day.ready && !day.error, eaten: day.calories, target: day.calorieTarget });
  const train = trainDial({
    now: new Date(), assignments: workout.assignments, history: workout.history,
    daysPerWeek: currentUser?.profile?.workout_days_per_week, loading: workout.exists === 'loading',
  });
  const sleep = sleepDial({
    ...lastNightSleep(sleepRead.data, now, timeZone),
    checkInHours: Number((checkIn.data as { sleep_hours?: number | string | null } | null | undefined)?.sleep_hours) || null,
    reads: { health: readState(sleepRead), checkIn: readState(checkIn) },
  });
  // Connections only when Health answered with no sleep; pending or failed opens Sleep and recovery.
  const sleepToConnections = sleep.source === 'none' || (sleep.source === 'checkin' && readState(sleepRead) === 'ok');

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: sc.bgPrimary }}>
      <ScrollView
        testID="home-scroll"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl testID="home-refresh-control" refreshing={refreshing} onRefresh={refresh} tintColor={sc.textPrimary} />
        }
      >
        <HomeHeaderActions layout="rings" />
        {day.error ? (
          <QuietError layout="inline" message={day.error} onRetry={() => void refresh()} retrying={day.retrying} testID="home-day-data-error" />
        ) : null}
        <Text testID="home-date" style={[typography.eyebrow, { color: sc.textMuted }]}>{homeDateLine(new Date())}</Text>
        <View style={styles.dials} testID="home-dials">
          <HomeDial label="Food" view={food} testID="home-dial-food" accessibilityLabel={dialLabel('Food', food)}
            onPress={() => navigation.navigate('Log')} />
          <HomeDial label="Train" view={train} testID="home-dial-train" accessibilityLabel={dialLabel('Train', train)}
            onPress={() => navigation.navigate('WorkoutTab')} />
          <HomeDial label="Sleep" view={sleep} testID="home-dial-sleep" prompt={sleep.source === 'none'}
            accessibilityLabel={dialLabel('Sleep', sleep)}
            onPress={() => (sleepToConnections
              ? navigation.navigate('MoreTab', { screen: 'Connections', initial: false })
              : navigation.navigate('MoreTab', { screen: 'Health', initial: false, params: { bucket: 'recovery' } }))} />
        </View>
        <CoachlessHomeSlot part="join" />
        <View style={styles.cta}>
          {workout.exists === 'loading' ? (
            <QuietLoading label="Loading" rows={1} testID="cta-skeleton" />
          ) : workout.exists ? (
            <PrimaryButton label={workout.label} accessibilityHint={workout.hint} onPress={workout.onContinue} testID="home-continue-cta" />
          ) : (
            // With no workout yet, food logging is the primary action (as on today's Home).
            <PrimaryButton label="Log a meal →" accessibilityLabel="Log a meal" onPress={() => navigation.navigate('Log')} testID="home-explore-cta" />
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingTop: 6, paddingBottom: 48 },
  dials: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  cta: { marginTop: 20 },
});
