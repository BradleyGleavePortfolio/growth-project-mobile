/**
 * C4 slice 1: looked after, with one clear next action (training 5.1, 6.2).
 * Current week only. Month, booking restyle and weekly forms are later slices.
 * No new reader or write: the same signed-in-client APIs supply every item.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { BookableCoach, CoachingSession } from '../../../api/schedulingApi';
import type { ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';
import { checkInsApi } from '../../../services/api';
import { useBookableTypes, useMyCoaches, useMySessions, usePastSessions } from '../../../hooks/useCalendar';
import { useMyWorkoutAssignments } from '../../../hooks/useWorkoutBuilder';
import { useWorkouts, type ApiWorkoutSession } from '../../../hooks/useApi';
import { withProtectedScreen } from '../../../entitlements/withProtectedScreen';
import { useClientNeedsCoach } from '../../../components/coachless/JoinCoachState';
import { useNetworkStatus } from '../../../hooks/useNetworkStatus';
import { useReducedMotion } from '../../../hooks/useReducedMotion';
import { formatDayLabel, formatRange, formatTime, zonesDiffer } from '../../../calendar/calendarTime';
import { addDays, bucketDateLocal, getLocalWeekStart, getTodayString } from '../../../utils/date';
import type { CalendarStackParamList } from '../../../navigation/calendarRoutes';
import { useTheme } from '../../../theme/ThemeProvider';
import { colors, layout, radius, spacing, typography } from '../../../theme/tokens';
import { PrimaryButton, Screen, TextLink } from '../../../ui';
import { QuietLoading } from '../../../ui/states/QuietStates';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { statusLabel } from './calendarUi';
import { WEEK_COPY as c } from './calendarWeekCopy';

type Props = NativeStackScreenProps<CalendarStackParamList, 'CalendarHome'>;
type CheckIn = { id: string; date: string };
export type CalendarWeekData = {
  coaches: BookableCoach[];
  sessions: CoachingSession[];
  workouts: ClientWorkoutAssignmentWithPlan[];
  checkIns: CheckIn[];
  /** Workouts the client logged (Quick Workout, own routines, coach plans). */
  logs?: ApiWorkoutSession[];
  descriptions?: Record<string, string>;
  loading: boolean;
  failed: boolean;
  refreshing: boolean;
  offline: boolean;
  hasData: boolean;
  /** No coach: own logs and plans only; Book opens the existing coach lock. */
  coachless?: boolean;
};

const active = (s: CoachingSession) => ['requested', 'scheduled', 'pending_provider'].includes(s.status);
const dayDate = (day: string) => new Date(`${day}T12:00:00`);

function CalendarWeekScreen({ navigation, coachless = false }: Props & { coachless?: boolean }) {
  // Scheduling routes need a coach (402 otherwise): a coachless client never calls them.
  const coaches = useMyCoaches(!coachless);
  const sessions = useMySessions(50, !coachless);
  const past = usePastSessions(!coachless);
  const workouts = useMyWorkoutAssignments();
  const logs = useWorkouts(50); // GET /workouts, newest first: covers any week of training.
  const coachList = coachless ? [] : coaches.data ?? [];
  const types = useBookableTypes(coachList[0]?.coach_id);
  const from = getLocalWeekStart();
  const to = addDays(from, 6);
  const checkIns = useQuery<CheckIn[]>({
    queryKey: ['check-ins', 'week', from, to],
    queryFn: async () => (await checkInsApi.list({ from, to, limit: 7 })).data,
  });
  const network = useNetworkStatus();
  const own = [workouts, checkIns, logs];
  const queries = coachless ? own : [coaches, sessions, past, ...own];
  // Native tab focus must refresh after booking, completing a workout or saving a check-in.
  const refreshRef = useRef(() => {});
  refreshRef.current = () => { queries.forEach((q) => { void q.refetch(); }); };
  useFocusEffect(useCallback(() => { refreshRef.current(); }, []));
  const data: CalendarWeekData = {
    coaches: coachList,
    sessions: coachless ? [] : [...(sessions.data ?? []), ...(past.data?.pages.flat() ?? [])],
    workouts: workouts.data ?? [],
    checkIns: checkIns.data ?? [],
    logs: logs.data ?? [],
    descriptions: Object.fromEntries((types.data ?? []).filter((t) => t.description).map((t) => [t.id, t.description!])),
    loading: queries.some((q) => q.isPending && q.fetchStatus === 'fetching'),
    failed: queries.some((q) => q.isError),
    refreshing: queries.some((q) => q.isRefetching),
    offline: !network.isOnline || network.isInternetReachable === false,
    hasData: (coachless ? own : [sessions, ...own]).some((q) => q.data !== undefined),
    coachless,
  };
  return <CalendarWeekPage data={data} onRefresh={() => refreshRef.current()}
    onSession={(id) => navigation.navigate('CalendarSession', { sessionId: id })}
    onBook={(coachId) => navigation.navigate('CalendarBook', coachId ? { coachId } : {})} />;
}

const ProtectedWeek = withProtectedScreen(CalendarWeekScreen);
/** #COACHLESS-CAL op 1: no coach, own week; coached clients keep Calendar home's gate. */
export default function CalendarWeekRoot(props: Props) {
  return useClientNeedsCoach() ? <CalendarWeekScreen {...props} coachless /> : <ProtectedWeek {...props} />;
}

/** Shared real view for fixture-backed web previews; no fixtures in the app. */
export function CalendarWeekPage({ data, onRefresh, onSession, onBook }: {
  data: CalendarWeekData;
  onRefresh: () => void;
  onSession: (id: string) => void;
  onBook: (coachId?: string) => void;
}) {
  const { semanticColors: sc } = useTheme();
  const nav = useNavigation<NavigationProp<ParamListBase>>();
  const today = getTodayString();
  const days = Array.from({ length: 7 }, (_, i) => addDays(getLocalWeekStart(), i));
  const [selected, setSelected] = useState(today);
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(1)).current;
  const { fontScale } = useWindowDimensions();
  useEffect(() => {
    if (data.failed && !data.offline) void HapticService.error();
  }, [data.failed, data.offline]);
  useEffect(() => {
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: reduced ? 150 : 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [selected, fade, reduced]);
  const sessions = [...new Map(data.sessions.map((s) => [s.id, s])).values()]
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const next = sessions.find((s) => active(s) && Date.parse(s.end_at) > Date.now());
  const coach = data.coaches[0];
  const sessionDay = (s: CoachingSession) => bucketDateLocal(new Date(s.start_at));
  const planName = (w: ClientWorkoutAssignmentWithPlan) => w.snapshot?.plan_name || w.workout_plan.name;
  // Finishing a coach plan also saves its log (same day, same name): show that workout once.
  const logs = (data.logs ?? []).filter((l) => !data.workouts.some((w) => w.completed_at &&
    bucketDateLocal(new Date(w.completed_at)) === l.date.slice(0, 10) && planName(w) === l.workout_name));
  const workoutsOn = (day: string) => [
    ...data.workouts.filter((w) => bucketDateLocal(new Date(w.scheduled_for)) === day).map((w) => ({
      id: w.id, testID: `week-workout-${w.id}`, name: planName(w), done: !!w.completed_at,
      open: () => nav.navigate('MoreTab', { screen: 'WorkoutAssignmentDetail', params: { assignmentId: w.id }, initial: false }),
    })),
    ...logs.filter((l) => l.date.slice(0, 10) === day).map((l) => ({
      id: l.id, testID: `week-log-${l.id}`, name: l.workout_name || c['C4-S-84'], done: true,
      open: () => nav.navigate('WorkoutTab', { screen: 'WorkoutHistoryEdit', params: { workout: JSON.stringify(l) }, initial: false }),
    })),
  ];
  const checkOn = (day: string) => data.checkIns.some((row) => row.date.slice(0, 10) === day);
  const dayLabel = (day: string) => formatDayLabel(dayDate(day));
  const ink = { color: sc.textPrimary };
  // Use primary ink for small supporting text: never low-contrast stone on tan.
  const body = [styles.body, ink];
  const noItems = !sessions.some((s) => days.includes(sessionDay(s))) &&
    !days.some((day) => workoutsOn(day).length) && !data.checkIns.length;
  const sessionCard = (s: CoachingSession, hero = false) => {
    const owner = data.coaches.find((item) => item.coach_id === s.coach_id);
    const name = owner?.name ?? s.coach_name;
    const coachClock = owner?.timezone && zonesDiffer(new Date(s.start_at), owner.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone)
      ? `${formatTime(new Date(s.start_at), owner.timezone)} for ${name}` : null; // C4-S-15
    return (
      <Pressable key={s.id} accessibilityRole="button"
        accessibilityLabel={`${s.title}, ${dayLabel(sessionDay(s))}, ${formatRange(s.start_at, s.end_at)}, ${statusLabel(s.status)}`}
        onPress={() => { void HapticService.softImpact(); onSession(s.id); }}
        testID={`${hero ? 'week-next' : 'week-session'}-${s.id}`}
        style={({ pressed }) => [styles.session, { backgroundColor: sc.bgSurface, opacity: pressed ? 0.75 : 1 }]}>
        <Text style={[styles.bodyStrong, ink]}>{formatRange(s.start_at, s.end_at)}</Text>
        <Text style={[styles.sessionTitle, ink]}>{s.title}</Text>
        <Text style={body}>{dayLabel(sessionDay(s))}{coachClock ? ` · ${coachClock}` : name ? ` · With ${name}` : ''}</Text>
        <Text style={body}>{statusLabel(s.status)}</Text>
        {hero && s.session_type_id && data.descriptions?.[s.session_type_id] ? (
          <Text style={[styles.coachWords, ink]}>{data.descriptions[s.session_type_id]}</Text>
        ) : null}
      </Pressable>
    );
  };
  return (
    <Screen edges={['top']} style={{ backgroundColor: sc.surface.masthead }} contentStyle={styles.content}
      testID="calendar-week"
      refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={onRefresh} tintColor={sc.textOnAccent} />}
      footer={coach || data.coachless ? <View style={[styles.footer, { backgroundColor: sc.bgPrimary }]}>
        <PrimaryButton label={c['C4-S-09']} onPress={() => onBook(coach?.coach_id)}
          testID="week-book" disabled={data.offline} />
      </View> : undefined}>
      <View style={styles.masthead}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: sc.textOnAccent }]}>{c['C4-S-01']}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={c['C4-S-44']} testID="week-notifications"
            style={styles.bell} onPress={() => { void HapticService.softImpact(); nav.navigate('Home', { screen: 'NotificationCenter', initial: false }); }}>
            <Ionicons name="notifications-outline" size={24} color={sc.textOnAccent} />
          </Pressable>
        </View>
        <View style={styles.header}>
          <Text style={[styles.bodyStrong, { color: sc.textOnAccent }]}>{c['C4-S-80']}</Text>
          <Text style={[styles.small, { color: sc.textOnMastheadMuted }]}>{dayDate(days[0]).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {days.map((day) => (
            <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: day === selected }}
              accessibilityLabel={`${dayLabel(day)}${day === today ? `, ${c['C4-S-82']}` : ''}`}
              testID={`week-day-${day}`} onPress={() => { void HapticService.selection(); setSelected(day); }}
              style={[styles.day, { minWidth: 44 * fontScale, backgroundColor: day === selected ? sc.bgPrimary : 'transparent' }]}>
              <Text style={[styles.small, { color: day === selected ? sc.textPrimary : sc.textOnAccent }]}>
                {dayDate(day).toLocaleDateString('en-US', { weekday: 'short' })}
              </Text>
              <Text style={[styles.dayNumber, { color: day === selected ? sc.textPrimary : sc.textOnAccent }]}>{dayDate(day).getDate()}</Text>
              <View style={styles.marks} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {sessions.some((s) => sessionDay(s) === day) ? <View style={[styles.mark, { backgroundColor: colors.camel }]} /> : null}
                {workoutsOn(day).length ? <View style={[styles.mark, { backgroundColor: day === selected ? sc.textPrimary : sc.textOnAccent }]} /> : null}
                {checkOn(day) ? <View style={[styles.mark, { backgroundColor: day === selected ? sc.textPrimary : sc.textOnAccent }]} /> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {/* Solid tan page to the footer; only its content inks in (LO-769R B1). */}
      <View style={[styles.page, { backgroundColor: sc.bgPrimary }]} testID="week-page">
        <Animated.View style={{ opacity: fade }}>
          {data.offline ? <Text accessibilityRole="alert" style={body}>{c[data.hasData ? 'C4S1-S-01' : 'C4S1-S-03']}</Text> : null}
          {data.loading ? <QuietLoading label={c['C4-S-136']} rows={3} testID="week-loading" /> : null}
          {data.failed && !data.offline ? <View testID="week-error" accessibilityRole="alert">
            <Text style={body}>{c['C4-S-130']}</Text>
            <TextLink label={c['C1-S-47']} tone="ink" onPress={onRefresh} testID="week-retry" />
          </View> : null}
          {next ? <View>
            <Text style={[styles.overline, ink]}>{c['C4-S-03']}</Text>
            {sessionCard(next, true)}
          </View> : null}
          {!data.loading && !data.failed && !data.offline && data.hasData && noItems ? <Text style={body} testID="week-empty">{c['C4-S-131']}</Text> : null}
          {days.filter((day) => day >= selected).map((day) => (
            <View key={day} style={styles.daySection} testID={`week-agenda-${day}`}>
              <Text style={[styles.date, ink]} accessibilityRole="header">{dayLabel(day)}{day === today ? ` · ${c['C4-S-82']}` : ''}</Text>
              {sessions.filter((s) => sessionDay(s) === day).map((s) => sessionCard(s))}
              {workoutsOn(day).map((w) => (
                <Pressable key={w.id} accessibilityRole="button" testID={w.testID}
                  accessibilityLabel={`${w.name}, ${w.done ? c['C4-S-138'] : c['C4-S-137']}`}
                  style={[styles.row, { borderColor: sc.border }]}
                  onPress={() => { void HapticService.softImpact(); w.open(); }}>
                  <View style={styles.rowText}>
                    <Text style={[styles.small, ink]}>{c['C4-S-84']}</Text>
                    <Text style={[styles.bodyStrong, ink]}>{w.name}</Text>
                  </View>
                  <Text style={[styles.small, ink]}>{w.done ? c['C4-S-138'] : c['C4-S-137']}</Text>
                </Pressable>
              ))}
              {checkOn(day) ? <View style={[styles.row, { borderColor: sc.border }]} testID={`week-checkin-${day}`}>
                <Text style={body}>{c['C4-S-88']}</Text><Text style={[styles.small, ink]}>{c['C4-S-138']}</Text>
              </View> : null}
              {day === today ? <TextLink label={c['C4S1-S-02']} tone="ink" align="start" testID="week-checkin-open"
                onPress={() => nav.navigate('Home', { screen: 'Habits', params: { initialTab: 'checkin' }, initial: false })} /> : null}
              {!data.loading && !data.failed && !data.offline && data.hasData && !workoutsOn(day).length &&
                !sessions.some((s) => sessionDay(s) === day) && !checkOn(day) && day !== today ?
                <Text style={body}>{c['C4-S-89']}</Text> : null}
            </View>
          ))}
        </Animated.View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 0, paddingBottom: 0 },
  masthead: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.md },
  title: { ...typography.h1, flex: 1 },
  bell: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  strip: { flexGrow: 1, justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.camel },
  day: { minHeight: 88, borderRadius: radius.button, alignItems: 'center', paddingVertical: spacing.sm },
  dayNumber: { ...typography.h2 },
  marks: { flexDirection: 'row', gap: 2, height: 8, marginTop: 4 },
  mark: { width: 7, height: 3 },
  page: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.xl, flexGrow: 1 },
  body: { ...typography.body, fontSize: 14, lineHeight: 22 },
  bodyStrong: { ...typography.body, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 23 },
  small: { ...typography.caption, letterSpacing: 0, flexShrink: 1 },
  overline: { ...typography.eyebrow, lineHeight: 18, marginBottom: spacing.md },
  session: { borderRadius: radius.card, borderLeftWidth: 3, borderLeftColor: colors.camel, padding: spacing.lg, marginBottom: spacing.lg, minHeight: 44 },
  sessionTitle: { ...typography.h2 },
  coachWords: { ...typography.h3, fontStyle: 'italic', marginTop: spacing.md },
  daySection: { marginTop: spacing.lg },
  date: { ...typography.h3, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md, minHeight: 56 },
  rowText: { flex: 1, minWidth: 0 },
  footer: { marginHorizontal: -spacing.xl, marginBottom: -spacing.xl, marginTop: -layout.footerTopGap, padding: spacing.xl },
});
