/**
 * C4 slice 1: looked after, with one clear next action (training 5.1, 6.2).
 * Current week, and the C4 Style C month (LS-917R3 B3). Booking restyle and
 * weekly forms are later slices.
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
import { assignmentDay, instantDay, workoutDay } from '../../../utils/workout/workoutDay';
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
  /**
   * Saved workouts are complete only for days after this one (the oldest row
   * read may have more on its day); absent means every saved workout is read.
   * A day on or before it is never called a rest day (LS-917R4 B3).
   */
  logsAfter?: string;
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
/** First day of the month `delta` months from the month of `day` (YYYY-MM-01). */
export function monthStart(day: string, delta = 0): string {
  const d = dayDate(day);
  return bucketDateLocal(new Date(d.getFullYear(), d.getMonth() + delta, 1, 12));
}
export const monthEnd = (first: string) => addDays(monthStart(first, 1), -1);
/** The month grid: whole Monday-first weeks covering the month. */
export function monthGrid(first: string): string[] {
  const start = addDays(first, -((dayDate(first).getDay() + 6) % 7));
  const count = Math.ceil(((dayDate(first).getDay() + 6) % 7 + Number(monthEnd(first).slice(8))) / 7) * 7;
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

function CalendarWeekScreen({ navigation, coachless = false }: Props & { coachless?: boolean }) {
  // Scheduling routes need a coach (402 otherwise): a coachless client never calls them.
  const coaches = useMyCoaches(!coachless);
  const sessions = useMySessions(50, !coachless);
  const past = usePastSessions(!coachless);
  const workouts = useMyWorkoutAssignments();
  // GET /workouts, newest first. 50 covers a week of training; an earlier
  // month grows the same read's limit until it covers the month (LS-917R4 B3).
  const [logLimit, setLogLimit] = useState(50);
  const logs = useWorkouts(logLimit);
  const coachList = coachless ? [] : coaches.data ?? [];
  const types = useBookableTypes(coachList[0]?.coach_id);
  // Month view asks for that month's check-ins only (one a day at most).
  const [month, setMonth] = useState<string | null>(null);
  const from = month ?? getLocalWeekStart();
  const to = month ? monthEnd(month) : addDays(from, 6);
  const checkIns = useQuery<CheckIn[]>({
    queryKey: ['check-ins', month ? 'month' : 'week', from, to],
    queryFn: async () => (await checkInsApi.list({ from, to, limit: month ? 31 : 7 })).data,
  });
  // Month view: page past sessions back until the month's first day is covered.
  // A failed page waits for Try again or pull to refresh (LS-917R4 B4): their
  // refetch clears the error, then paging resumes.
  const oldestPast = past.data?.pages.at(-1)?.at(-1)?.start_at;
  useEffect(() => {
    if (month && !coachless && past.hasNextPage && !past.isFetchingNextPage && !past.isFetchNextPageError
      && (!oldestPast || bucketDateLocal(new Date(oldestPast)) >= month)) void past.fetchNextPage();
  }, [month, coachless, oldestPast, past.hasNextPage, past.isFetchingNextPage, past.isFetchNextPageError, past]);
  // Saved workouts: the rows read are complete after their oldest day, or for
  // every day when the server sent fewer than asked. Until the first day shown
  // (the grid's first Monday, or this week's) is covered, ask again with a
  // doubled limit; a failed read stops here and shows Try again.
  const logRows = logs.data;
  const logsReal = !!logRows && !logs.isPlaceholderData;
  const logsAll = logsReal && logRows.length < logLimit;
  const oldestLog = logRows?.reduce<string | undefined>((min, l) => (!min || workoutDay(l) < min ? workoutDay(l) : min), undefined);
  const firstShown = month ? monthGrid(month)[0] : getLocalWeekStart();
  const logsCover = logsAll || (!!oldestLog && oldestLog < firstShown);
  useEffect(() => {
    if (!logsCover && logsReal && !logs.isFetching && !logs.isError) setLogLimit((n) => n * 2);
  }, [logsCover, logsReal, logs.isFetching, logs.isError]);
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
    logs: logRows ?? [],
    logsAfter: logsAll ? undefined : oldestLog ?? '9999-12-31',
    descriptions: Object.fromEntries((types.data ?? []).filter((t) => t.description).map((t) => [t.id, t.description!])),
    loading: queries.some((q) => q.isPending && q.fetchStatus === 'fetching')
      || (!logsCover && !logs.isError && logs.fetchStatus !== 'paused'),
    failed: queries.some((q) => q.isError),
    refreshing: queries.some((q) => q.isRefetching),
    offline: !network.isOnline || network.isInternetReachable === false,
    hasData: (coachless ? own : [sessions, ...own]).some((q) => q.data !== undefined),
    coachless,
  };
  return <CalendarWeekPage data={data} onRefresh={() => refreshRef.current()} onMonthChange={setMonth}
    onSession={(id) => navigation.navigate('CalendarSession', { sessionId: id })}
    onBook={(coachId) => navigation.navigate('CalendarBook', coachId ? { coachId } : {})} />;
}

const ProtectedWeek = withProtectedScreen(CalendarWeekScreen);
/** #COACHLESS-CAL op 1: no coach, own week; coached clients keep Calendar home's gate. */
export default function CalendarWeekRoot(props: Props) {
  return useClientNeedsCoach() ? <CalendarWeekScreen {...props} coachless /> : <ProtectedWeek {...props} />;
}

/**
 * The saved workouts left to show once each done assignment is paired with its
 * own. Pairs are made across the whole week by match strength (LS-917R2 B3):
 * first every start-day match (started_at), then every assigned-day match,
 * then the completed day for rows still unpaired. So an older row done a day
 * late cannot take the next day's workout before that day's own row pairs.
 */
function pairDoneAssignments(
  workouts: ClientWorkoutAssignmentWithPlan[],
  logs: ApiWorkoutSession[],
  planName: (w: ClientWorkoutAssignmentWithPlan) => string,
): ApiWorkoutSession[] {
  const left = [...logs];
  let open = workouts.filter((w) => !!w.completed_at);
  const pass = (dayOf: (w: ClientWorkoutAssignmentWithPlan) => string | null) => {
    open = open.filter((w) => {
      const day = dayOf(w);
      if (!day) return true;
      const at = left.findIndex((l) => l.workout_name === planName(w) && workoutDay(l) === day);
      if (at < 0) return true;
      left.splice(at, 1);
      return false;
    });
  };
  pass((w) => (w.started_at ? instantDay(w.started_at) : null));
  // A row with started_at pairs on its start day only.
  open = open.filter((w) => !w.started_at);
  pass((w) => assignmentDay(w));
  pass((w) => instantDay(w.completed_at));
  return left;
}

/** Shared real view for fixture-backed web previews; no fixtures in the app. */
export function CalendarWeekPage({ data, onRefresh, onSession, onBook, onMonthChange, initialMonth }: {
  data: CalendarWeekData;
  onRefresh: () => void;
  onSession: (id: string) => void;
  onBook: (coachId?: string) => void;
  /** The month shown (YYYY-MM-01), or null for the week; the screen loads its check-ins. */
  onMonthChange?: (month: string | null) => void;
  /** Previews and tests: open on this month. */
  initialMonth?: string;
}) {
  const { semanticColors: sc } = useTheme();
  const nav = useNavigation<NavigationProp<ParamListBase>>();
  const today = getTodayString();
  const days = Array.from({ length: 7 }, (_, i) => addDays(getLocalWeekStart(), i));
  const [selected, setSelected] = useState(initialMonth ?? today);
  const [month, setMonthState] = useState<string | null>(initialMonth ?? null);
  const showMonth = (next: string | null) => {
    void HapticService.selection();
    setMonthState(next);
    onMonthChange?.(next);
    // The chosen day stays when it is in view; else the month's first day (or today).
    const inView = next ? selected.startsWith(next.slice(0, 7)) : days.includes(selected);
    if (!inView) setSelected(next ? (today.startsWith(next.slice(0, 7)) ? today : next) : today);
  };
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(1)).current;
  const { fontScale, width } = useWindowDimensions();
  // Month rings fit their seventh of the page (LS-917R4 C2): 40 pt, scaled
  // with text, but never wider than the column less a 2 pt gap, so neighbours
  // never touch. The date's own line is tighter so it stays round inside.
  const ringSize = Math.min(40 * fontScale, Math.floor((width - 2 * spacing.xl) / 7) - 2);
  useEffect(() => {
    if (data.failed && !data.offline) void HapticService.error();
  }, [data.failed, data.offline]);
  useEffect(() => {
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: reduced ? 150 : 200, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [selected, month, fade, reduced]);
  const sessions = [...new Map(data.sessions.map((s) => [s.id, s])).values()]
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const next = sessions.find((s) => active(s) && Date.parse(s.end_at) > Date.now());
  const coach = data.coaches[0];
  const sessionDay = (s: CoachingSession) => bucketDateLocal(new Date(s.start_at));
  const planName = (w: ClientWorkoutAssignmentWithPlan) => w.snapshot?.plan_name || w.workout_plan.name;
  // Finishing a coach plan also saves its log: show that workout once. A done
  // assignment pairs with one saved workout of its plan begun the same day
  // (started_at is the session's start, the workout's date its start day), so
  // a late upload or a finish after midnight still pairs, and a second workout
  // of the plan that day still shows. Older rows without started_at pair on
  // the day assigned or the day completed.
  const logs = pairDoneAssignments(data.workouts, data.logs ?? [], planName);
  const workoutsOn = (day: string) => [
    ...data.workouts.filter((w) => assignmentDay(w) === day).map((w) => ({
      id: w.id, testID: `week-workout-${w.id}`, name: planName(w), done: !!w.completed_at,
      open: () => nav.navigate('MoreTab', { screen: 'WorkoutAssignmentDetail', params: { assignmentId: w.id }, initial: false }),
    })),
    ...logs.filter((l) => workoutDay(l) === day).map((l) => ({
      id: l.id, testID: `week-log-${l.id}`, name: l.workout_name || c['C4-S-84'], done: true,
      open: () => nav.navigate('WorkoutTab', { screen: 'WorkoutHistoryEdit', params: { workout: JSON.stringify(l) }, initial: false }),
    })),
  ];
  const checkOn = (day: string) => data.checkIns.some((row) => row.date.slice(0, 10) === day);
  // Saved workouts read for this day (LS-917R4 B3): else it is still loading, never a rest day.
  const logsKnown = (day: string) => !data.logsAfter || day > data.logsAfter;
  // C4 Month: a missed session (no_show) is a grey ring, any other a camel ring.
  const sessionsOn = (day: string) => sessions.filter((s) => sessionDay(s) === day);
  const dayLabel = (day: string) => formatDayLabel(dayDate(day));
  const ink = { color: sc.textPrimary };
  // Use primary ink for small supporting text: never low-contrast stone on tan.
  const body = [styles.body, ink];
  // C4 Style C agenda rows lead with a round icon (barbell = workout, check = done, moon = rest day).
  const rowIcon = (name: React.ComponentProps<typeof Ionicons>['name']) => (
    <View style={[styles.icon, { borderColor: sc.border }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Ionicons name={name} size={18} color={sc.textPrimary} />
    </View>
  );
  const noItems = !sessions.some((s) => days.includes(sessionDay(s))) &&
    !days.some((day) => workoutsOn(day).length) && !data.checkIns.length && logsKnown(days[0]);
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
  const daySection = (day: string) => (
        <View key={day} style={styles.daySection} testID={`week-agenda-${day}`}>
          <View style={styles.dateRow}>
            <Text style={[styles.date, ink]} accessibilityRole="header">{dayLabel(day)}{day === today ? ` · ${c['C4-S-82']}` : ''}</Text>
            <View style={[styles.dateRule, { backgroundColor: sc.border }]} />
          </View>
          {sessions.filter((s) => sessionDay(s) === day).map((s) => sessionCard(s))}
          {workoutsOn(day).map((w) => (
            <Pressable key={w.id} accessibilityRole="button" testID={w.testID}
              accessibilityLabel={`${w.name}, ${w.done ? c['C4-S-138'] : c['C4-S-137']}`}
              style={[styles.row, { borderColor: sc.border }]}
              onPress={() => { void HapticService.softImpact(); w.open(); }}>
              {rowIcon(w.done ? 'checkmark' : 'barbell-outline')}
              <View style={styles.rowText}>
                <Text style={[styles.small, ink]}>{c['C4-S-84']}</Text>
                <Text style={[styles.bodyStrong, ink]}>{w.name}</Text>
              </View>
              <Text style={[styles.small, ink]}>{w.done ? c['C4-S-138'] : c['C4-S-137']}</Text>
            </Pressable>
          ))}
          {checkOn(day) ? <View style={[styles.row, { borderColor: sc.border }]} testID={`week-checkin-${day}`}>
            {rowIcon('checkmark')}<Text style={[body, styles.rowText]}>{c['C4-S-88']}</Text><Text style={[styles.small, ink]}>{c['C4-S-138']}</Text>
          </View> : null}
          {day === today ? <TextLink label={c['C4S1-S-02']} tone="ink" align="start" testID="week-checkin-open"
            onPress={() => nav.navigate('Home', { screen: 'Habits', params: { initialTab: 'checkin' }, initial: false })} /> : null}
          {!data.loading && !data.failed && !data.offline && data.hasData && logsKnown(day) && !workoutsOn(day).length &&
            !sessions.some((s) => sessionDay(s) === day) && !checkOn(day) && day !== today ?
            <View style={styles.restRow}>{rowIcon('moon-outline')}<Text style={[body, styles.rowText, { color: sc.textMuted }]}>{c['C4-S-89']}</Text></View> : null}
        </View>
  );
  const tab = (label: string, on: boolean, next: string | null) => (
    <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: on }} testID={`calendar-tab-${label.toLowerCase()}`}
      onPress={() => { if (!on) showMonth(next); }}
      style={[styles.tab, { borderBottomColor: on ? colors.camel : 'transparent' }]}>
      <Text style={[styles.tabText, { color: on ? sc.textOnAccent : sc.textOnMastheadMuted }]}>{label}</Text>
    </Pressable>
  );
  const chevron = (label: string, icon: 'chevron-back' | 'chevron-forward', delta: number) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={styles.bell} testID={`month-${delta < 0 ? 'previous' : 'next'}`}
      onPress={() => showMonth(monthStart(month ?? today, delta))}>
      <Ionicons name={icon} size={24} color={sc.textOnAccent} />
    </Pressable>
  );
  // C4 Style C month: ring = session (grey when missed), dot = workout, square = check-in; the chosen day is filled forest.
  const monthView = month ? (
    <View testID="calendar-month">
      <View style={styles.weekRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {monthGrid(month).slice(0, 7).map((day) => (
          <Text key={day} style={[styles.cellHead, { color: sc.textMuted }]}>{dayDate(day).toLocaleDateString('en-US', { weekday: 'narrow' })}</Text>
        ))}
      </View>
      <View style={styles.weekRow}>
        {monthGrid(month).map((day) => {
          const inMonth = day.startsWith(month.slice(0, 7));
          const on = day === selected;
          const session = sessionsOn(day).some((s) => s.status !== 'no_show');
          const missed = sessionsOn(day).some((s) => s.status === 'no_show');
          return (
            <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: on }}
              accessibilityLabel={[dayLabel(day), day === today && c['C4-S-82'], session && c['C4-S-83'], missed && c['917-W11'],
                workoutsOn(day).length > 0 && c['C4-S-84'], checkOn(day) && c['C4-S-85']].filter(Boolean).join(', ')} testID={`month-day-${day}`}
              onPress={() => { void HapticService.selection(); setSelected(day); }} style={styles.cell}>
              {/* A day with both keeps the camel ring (the session still to come or held); its label says both. */}
              <View style={[styles.cellCircle, { minWidth: ringSize, minHeight: ringSize, borderRadius: ringSize / 2,
                borderColor: session ? colors.camel : missed ? sc.data.missed : 'transparent', backgroundColor: on ? sc.accent : 'transparent' }]}>
                <Text style={[styles.cellNumber, { color: on ? sc.textOnAccent : inMonth ? sc.textPrimary : sc.textMuted },
                  day === today && !on ? { textDecorationLine: 'underline', textDecorationColor: colors.camel } : null]}>{dayDate(day).getDate()}</Text>
              </View>
              <View style={styles.marks} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {workoutsOn(day).length ? <View testID={`month-workout-${day}`} style={[styles.markDot, { backgroundColor: sc.accent }]} /> : null}
                {checkOn(day) ? <View testID={`month-checkin-${day}`} style={[styles.markSquare, { backgroundColor: colors.camel }]} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {/* Each mark wraps with its word (at 130% text the legend takes two lines). */}
      <View style={styles.legend} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={styles.legendItem}><View style={[styles.markRing, { borderColor: colors.camel }]} /><Text style={body}>{c['C4-S-83']}</Text></View>
        <View style={styles.legendItem}><View style={[styles.markDot, { backgroundColor: sc.accent }]} /><Text style={body}>{c['C4-S-84']}</Text></View>
        <View style={styles.legendItem}><View style={[styles.markSquare, { backgroundColor: colors.camel }]} /><Text style={body}>{c['C4-S-85']}</Text></View>
        <View style={styles.legendItem}><View style={[styles.markRing, { borderColor: sc.data.missed }]} /><Text style={body}>{c['917-W11']}</Text></View>
      </View>
    </View>
  ) : null;
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
        <View style={styles.header} accessibilityRole="tablist">
          <View style={styles.tabs}>{tab(c['C4-S-80'], !month, null)}{tab(c['C4-S-81'], !!month, monthStart(selected))}</View>
          {month ? null : <Text style={[styles.small, { color: sc.textOnMastheadMuted }]}>{dayDate(days[0]).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>}
        </View>
        {month ? <View style={[styles.header, styles.monthHead]}>
          <Text accessibilityRole="header" style={[styles.sessionTitle, styles.grow, { color: sc.textOnAccent }]}>
            {dayDate(month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
          {chevron(c['917-W4'], 'chevron-back', -1)}{chevron(c['917-W5'], 'chevron-forward', 1)}
        </View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {days.map((day) => (
            <Pressable key={day} accessibilityRole="button" accessibilityState={{ selected: day === selected }}
              accessibilityLabel={`${dayLabel(day)}${day === today ? `, ${c['C4-S-82']}` : ''}`}
              testID={`week-day-${day}`} onPress={() => { void HapticService.selection(); setSelected(day); }}
              style={[styles.day, { minWidth: 44 * fontScale }]}>
              <Text style={[styles.small, { color: sc.textOnAccent }]}>
                {dayDate(day).toLocaleDateString('en-US', { weekday: 'short' })}
              </Text>
              {/* C4 Style C: the chosen day's number sits in a light circle. */}
              <View testID={`week-day-circle-${day}`} style={[styles.dayCircle, { minWidth: 40 * fontScale, minHeight: 40 * fontScale,
                borderRadius: 20 * fontScale, backgroundColor: day === selected ? sc.bgPrimary : 'transparent' }]}>
                <Text style={[styles.dayNumber, { color: day === selected ? sc.textPrimary : sc.textOnAccent }]}>{dayDate(day).getDate()}</Text>
              </View>
              {/* C4 Style C marks: ring = session, dot = workout, square = check-in. */}
              <View style={styles.marks} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                {sessions.some((s) => sessionDay(s) === day) ? <View style={[styles.markRing, { borderColor: colors.camel }]} /> : null}
                {workoutsOn(day).length ? <View style={[styles.markDot, { backgroundColor: sc.textOnAccent }]} /> : null}
                {checkOn(day) ? <View style={[styles.markSquare, { backgroundColor: colors.camel }]} /> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>}
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
          {monthView}
          {next && !month ? <View>
            <Text style={[styles.overline, ink]}>{c['C4-S-03']}</Text>
            {sessionCard(next, true)}
          </View> : null}
          {!data.loading && !data.failed && !data.offline && data.hasData && noItems ? <Text style={body} testID="week-empty">{c['C4-S-131']}</Text> : null}
          {month ? daySection(selected) : days.filter((day) => day >= selected).map(daySection)}
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
  day: { minHeight: 88, alignItems: 'center', paddingVertical: spacing.sm },
  dayNumber: { ...typography.h2 },
  dayCircle: { alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  marks: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 8, marginTop: 4 },
  markRing: { width: 6, height: 6, borderRadius: 3, borderWidth: 1 },
  markDot: { width: 5, height: 5, borderRadius: 2.5 },
  markSquare: { width: 5, height: 5 },
  page: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: spacing.xl, flexGrow: 1 },
  body: { ...typography.body, fontSize: 14, lineHeight: 22 },
  bodyStrong: { ...typography.body, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 23 },
  small: { ...typography.caption, letterSpacing: 0, flexShrink: 1 },
  overline: { ...typography.eyebrow, lineHeight: 18, marginBottom: spacing.md },
  session: { borderRadius: radius.card, borderLeftWidth: 3, borderLeftColor: colors.camel, padding: spacing.lg, marginBottom: spacing.lg, minHeight: 44 },
  sessionTitle: { ...typography.h2 },
  coachWords: { ...typography.h3, fontStyle: 'italic', marginTop: spacing.md },
  daySection: { marginTop: spacing.lg },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  date: { ...typography.h3, fontStyle: 'italic', flexShrink: 1 },
  dateRule: { flex: 1, height: StyleSheet.hairlineWidth, minWidth: spacing.lg },
  icon: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  restRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.md, minHeight: 56 },
  rowText: { flex: 1, minWidth: 0 },
  tabs: { flexDirection: 'row', gap: spacing.xl },
  grow: { flex: 1 },
  tab: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2 },
  tabText: { ...typography.body, fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  monthHead: { borderBottomWidth: 1, borderColor: colors.camel, paddingBottom: spacing.sm },
  weekRow: { flexDirection: 'row', flexWrap: 'wrap' },
  cellHead: { ...typography.caption, width: `${100 / 7}%`, textAlign: 'center', marginBottom: spacing.sm },
  cell: { width: `${100 / 7}%`, minHeight: 56, alignItems: 'center', paddingVertical: 2 },
  cellCircle: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  // h3 with a tighter line (25 -> 22) so the date stays inside a column-fit ring at 130% text.
  cellNumber: { ...typography.h3, lineHeight: 22 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm + 6, rowGap: 4, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footer: { marginHorizontal: -spacing.xl, marginBottom: -spacing.xl, marginTop: -layout.footerTopGap, padding: spacing.xl },
});
