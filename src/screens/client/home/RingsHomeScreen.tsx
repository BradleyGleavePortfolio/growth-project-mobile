/**
 * RingsHomeScreen — UI-1 client Home, "rings and tiles" (owner 10-09; V1_1_UI_SPEC UI-1),
 * rendered by HomeScreen when featureFlags.clientHomeRings is on. HomeScreen keeps the
 * day and workout reads; this layout shows the coach row and bell (coachless: Roman
 * locked), the date, three dials (each its own number and screen), Join a coach for a
 * coachless client (m#654), Roman's line (coachless: locked), the day's one forest
 * button, the tiles and the one notice slot (today's Home notices, most urgent first, one at
 * a time); a failed payment shows alone under the dials. Every read refreshes on open: focus
 * and a return to the foreground. Edit tiles follows in the next UI-1 pull request.
 */
import React, { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, typography } from '../../../theme/tokens';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useTodayCheckIn } from '../../../hooks/useApi';
import { useWearableSamples } from '../../../hooks/useWearableSamples';
import { useWearableConnections } from '../../../hooks/useWearableConnections';
import { useRefreshOnOpen } from '../../../hooks/useRefreshOnOpen';
import { useDeviceHealthOnOpen } from '../../../hooks/useDeviceHealthOnOpen';
import { bucketDateLocal } from '../../../utils/date';
import type { WorkoutRowLike } from '../../../utils/workout/workoutDoneToday';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';
import { QuietError, QuietLoading } from '../../../ui/states/QuietStates';
import { PrimaryButton } from '../../../ui';
import HomeHeaderActions from '../../../components/home/HomeHeaderActions';
import CoachlessHomeSlot from '../../../components/coachless/CoachlessHomeSlot';
import HomeDial from '../../../components/home/rings/HomeDial';
import { foodDial, lastNightSleep, noHealthSource, sleepDial, trainDial, type DialView, type ReadState } from '../../../components/home/rings/homeRings';
import HomeRomanLine from '../../../components/home/rings/HomeRomanLine';
import HomeTiles, { type HomeTilesProps } from '../../../components/home/rings/HomeTiles';
import { HomeNoticeSlot } from '../../../components/home/HomeNoticeSlot';
import { DunningBanner } from '../../../entitlements/dunning/DunningBanner';
import PendingInviteBanner from '../../../components/PendingInviteBanner';
import FinishJoining from '../../../components/join/FinishJoining';
import ProfileNudge from '../../../components/home/ProfileNudge';
import PushPermissionCard from '../../../components/home/PushPermissionCard';
import CoachIntroductionBanner from '../../../components/home/CoachIntroductionBanner';
import FullMacrosIntroCard from '../../../components/home/FullMacrosIntroCard';
import TutorialHomeSlot from '../../../components/tutorial/TutorialHomeSlot';
import { homeDateLine } from '../homeDate';

/** The raw workout reads behind the Train dial (null = that read failed). */
export interface RingsWorkoutReads {
  history: WorkoutRowLike[] | null;
  assignments: ClientWorkoutAssignmentWithPlan[] | null;
}

export interface RingsHomeScreenProps {
  day: HomeTilesProps['day'] & {
    error: string | null; retrying: boolean; calories: number | undefined; calorieTarget: number | undefined; carbsTarget?: number; fatTarget?: number;
  };
  workout: RingsWorkoutReads & { exists: boolean | 'loading'; label: string; hint: string; onContinue: () => void; hasCoachPlan: boolean };
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
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const range = { from: new Date(y, m - 1, d - 7).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() };
  const sleepRead = useWearableSamples(
    { bucket: 'SLEEP_RECOVERY', from: range.from, to: range.to, granularity: 'day', preferredOnly: true },
    { enabled: !!currentUser },
  );
  const checkIn = useTodayCheckIn(today, !!currentUser);
  const connections = useWearableConnections();
  const { refetch: refetchSleep } = sleepRead;
  const { refetch: refetchCheckIn } = checkIn;
  const { refetch: refetchConnections } = connections;
  const refresh = useCallback(async () => {
    await Promise.all([onRefresh(), refetchSleep(), refetchCheckIn(), refetchConnections()]);
  }, [onRefresh, refetchSleep, refetchCheckIn, refetchConnections]);

  // Refresh on open: Home's reads again on each refocus and return to the foreground; Health on this phone
  // on first open and on each return to the app, so last night reaches the Sleep dial without opening Health.
  useDeviceHealthOnOpen(connections.data);
  useRefreshOnOpen(() => {
    void refetchSleep(); void refetchCheckIn(); void refetchConnections();
  });

  const food = foodDial({ ready: day.ready && !day.error, eaten: day.calories, target: day.calorieTarget });
  const train = trainDial({
    now: new Date(), assignments: workout.assignments, history: workout.history,
    daysPerWeek: currentUser?.profile?.workout_days_per_week, loading: workout.exists === 'loading',
  });
  // #RINGS-CONNECT: Connections only when the client's connections list none connected and Health has no
  // number for last night; every other state opens Recovery. Both sit in the Home stack, so Back lands on Home.
  const noSource = noHealthSource(connections);
  const sleep = sleepDial({
    ...lastNightSleep(sleepRead.data, now, timeZone),
    checkInHours: Number((checkIn.data as { sleep_hours?: number | string | null } | null | undefined)?.sleep_hours) || null,
    reads: { health: readState(sleepRead), checkIn: readState(checkIn) },
    noSource,
  });

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
            onPress={() => (noSource && sleep.source !== 'health' ? navigation.navigate('Connections') : navigation.navigate('Health', { bucket: 'recovery' }))} />
        </View>
        {/* #RINGS-PAY-SLOT: the failed payment alone, up under the dials; every other notice waits in the slot. */}
        <DunningBanner surface="HomeScreen" presentation="section" style={styles.pay} />
        <CoachlessHomeSlot part="join" />
        {/* Once the user is known, so a coached client never sees Roman locked first. */}
        {currentUser ? <HomeRomanLine coached={!!currentUser.coach_id} /> : null}
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
        <HomeTiles day={{ ...day, ready: day.ready && !day.error }} checkIn={checkIn.data} refreshing={refreshing} noSource={noSource} />
        {/* UI-1 spec item 9: one notice at a time, most urgent first (HomeNoticeSlot's rank). */}
        <HomeNoticeSlot style={styles.notices}>
          <PendingInviteBanner />
          <PushPermissionCard presentation="section" />
          <FinishJoining />
          <CoachIntroductionBanner />
          <FullMacrosIntroCard carbsG={day.carbsTarget} fatG={day.fatTarget} />
          <TutorialHomeSlot part="reoffer" />
          <ProfileNudge hasCoachPlan={workout.hasCoachPlan} hasTargets={(day.calorieTarget ?? 0) > 0} />
        </HomeNoticeSlot>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingTop: 6, paddingBottom: 48 },
  dials: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  cta: { marginTop: 20 },
  pay: { marginTop: 20, marginBottom: 0, paddingBottom: 0 }, // the Roman line or the button below brings its own gap
  notices: { marginTop: layout.sectionGap },
});
