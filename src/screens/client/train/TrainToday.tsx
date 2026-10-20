/**
 * C1-TRAIN-TAB (agent 159): plan C1 Style C v2, PR 3 (planning/MOCKUP3/C1 index.md section 9, index-v2.md
 * section 10), behind `featureFlags.clientTrainV2` (off in every build). The top of the Train tab:
 *   - `TrainMasthead`: the week on deep forest (light status bar), the SegmentedRing (one segment per workout
 *     the coach set this week) and the DayMark strip, Monday first. The tab's own header sits on it.
 *   - `TrainDay`, in the ctx#88 section 8.A order (#TRAIN-START-TOP: Train to the workout is one tap): the
 *     overline, today's workout name, Start workout, the coach's note on sage (the first coach note in its rows),
 *     the details line, then its lettered blocks (rows next to each other in one superset share a letter).
 * A coachless client keeps every logging route and reads "Your plan" with no coach voice (NOLOCK-R).
 * Reads only GET /assignments/me, the signed-in client's own rows; no write. TRAIN-TAB-2 (agent 160) reads three more of
 * its fields (backend main, C1V2-C1): the coach's day note (`client_note`) leads the note card; a changed row reads
 * "Changed by Sam · 3 sets, was 4" on sage with the coach's reason (`sets_before`, `client_reason`); a skipped day
 * (`skipped_at`) is never offered with Start and reads missed on the strip, as on the coach's This week.
 * "Week 3, day 2" still waits for `program_week` and `program_day`, which are not on main.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { CormorantGaramond_400Regular_Italic, useFonts } from '@expo-google-fonts/cormorant-garamond';
import type { AssignmentExercise, ClientWorkoutAssignmentWithPlan } from '../../../api/workoutBuilderApi';
import { useStatusBarBand } from '../../../components/StatusBarBand';
import { useMyCoaches } from '../../../hooks/useCalendar';
import { useExerciseNames } from '../../../hooks/useExerciseNames';
import { loadActiveWorkoutSession } from '../../../storage/activeWorkoutSession';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout, radius, typography } from '../../../theme/tokens';
import { PrimaryButton, QuietTextButton, useScreenInsets } from '../../../ui';
import { DayMark, SegmentedRing, type DayState } from '../../../ui/charts/StyleCMarks';
import { HapticService } from '../../../ui/haptics/haptics.service';
import { assignmentPrescription } from '../../../utils/workout/assignmentPrescription';
import { buildActiveWorkoutExercises, prettifyExerciseName } from '../../../utils/workout/buildActiveWorkout';
import { bucketDateLocal } from '../../../utils/date';
import { doneLine, workoutWeek, type WorkoutWeek } from '../../coach/client-detail/thisWeek';
import { DAY_LABELS } from '../habits/constants';

/** C1 wording IDs (index.md section 10). New ones wait for the owner (PR "Wording needed"); the rest are today's. */
export const TRAIN_COPY = {
  week: 'This week', // C1-C-06; the ring and its line are thisWeek's doneLine, "{n} of {total} done" (C1-C-08)
  day: { done: 'done', planned: 'planned', missed: 'missed', rest: 'rest day', today: 'Today' } as Record<DayState, string>, // C1-C-02 to 05, C1-S-33
  today: 'Today', // C1-S-33
  exercises: (n: number) => `${n} ${n === 1 ? 'exercise' : 'exercises'}`, // C1-S-34 (the singular is today's)
  minutes: (m: number) => `about ${m} min`, // C1-S-35
  superset: 'Superset', // C1-S-12
  rounds: (n: number) => `${n} ${n === 1 ? 'round' : 'rounds'}`, // C1-S-13
  nothing: 'Nothing planned yet.', // C1-C-43
  whenPlan: (coach: string) => `When ${coach} sends a plan, each day shows here with what to lift and why.`, // C1-C-44
  yourCoach: 'your coach', // C1-C-44 before the coach's name has loaded
  loading: "Loading today's workout", // C1-S-46
  yourPlan: 'Your plan', // today's (You tab section)
  start: 'Start workout', // EX-01, today's
  resume: 'Resume workout', // today's
  names: 'Loading exercise names', // today's
  failed: 'This workout did not load.', // today's
  retry: 'Try again', // today's
  adjusted: 'Updated by your coach', // today's (WorkoutAssignmentDetail); kept for a change saved without its sets before
  adjustedToday: (coach: string | null) => `${coach ?? 'Your coach'} adjusted today's workout.`, // C1-S-36
  changed: (coach: string | null, sets: number, was: number) =>
    `Changed by ${coach ?? 'your coach'} · ${sets} ${sets === 1 ? 'set' : 'sets'}, was ${was}`, // C1-C-07, C1-S-04, C1-B-46
};
const c = TRAIN_COPY;
const CAP = 1.3;

export type TrainState = 'loading' | 'failed' | 'ready';
export type StartParams = { routineId: string; routineName: string; exercises: string; assignmentId: string };
interface Row extends Pick<ClientWorkoutAssignmentWithPlan, 'scheduled_for' | 'completed_at'> { skipped_at?: string | null }
/** GET /assignments/me also returns the coach's day note and the day the client skipped (C1V2-C1, backend main). */
export interface TrainWorkout extends ClientWorkoutAssignmentWithPlan { client_note?: string | null; skipped_at?: string | null }
/** One coach-approved change as the server sends it: the sets before it and the coach's reason, null when not saved. */
type Change = { order: number; sets_before?: number | null; client_reason?: string | null };

const DAY = 86_400_000;
const dayOf = (a: Row) => bucketDateLocal(new Date(a.scheduled_for));
const firstName = (name?: string) => name?.trim().split(/\s+/)[0] || null;

/** The ring and strip, Monday to Sunday around `today`; a skipped day reads missed (the coach's This week rule). */
export function trainWeek(rows: ReadonlyArray<Row>, today: string): WorkoutWeek {
  const t = Date.parse(today);
  const week_start = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  const end = new Date(Date.parse(week_start) + 6 * DAY).toISOString().slice(0, 10);
  const assignments = rows.map((a) => ({ day: dayOf(a), completed_at: a.completed_at, skipped_at: a.skipped_at }));
  return workoutWeek({ week_start, today, assignments: assignments.filter((a) => a.day >= week_start && a.day <= end) });
}

/** Today's open workout; else the next open one; else the latest still open (a missed day). A skipped day is not open. */
export function featuredWorkout<T extends Row>(rows: ReadonlyArray<T>, today: string): T | null {
  const open = rows.filter((a) => !a.completed_at && !a.skipped_at).sort((a, b) => Date.parse(a.scheduled_for) - Date.parse(b.scheduled_for));
  return open.find((a) => dayOf(a) >= today) ?? open[open.length - 1] ?? null;
}

export interface Block { letter: string; rows: AssignmentExercise[] }
/** A, B, C in plan order; rows next to each other with the same `superset_group_id` share one letter. */
export function blocksOf(rows: ReadonlyArray<AssignmentExercise>): Block[] {
  const out: Block[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (last && r.superset_group_id && last.rows[0].superset_group_id === r.superset_group_id) last.rows.push(r);
    else out.push({ letter: out.length < 26 ? String.fromCharCode(65 + out.length) : String(out.length + 1), rows: [r] });
  }
  return out;
}

const blockLine = (b: Block) => {
  const r = b.rows[0];
  if (b.rows.length > 1) return `${c.superset} · ${c.rounds(r.sets)}`;
  return `${r.sets} × ${r.reps_or_duration_seconds}${r.weight_lbs ? ` · ${r.weight_lbs} lb` : ''}`;
};

/** The deep-forest week above the page. `children`: the tab's own header (title and icons), drawn light. */
export function TrainMasthead({ rows, today, state, children }: {
  rows: ReadonlyArray<Row>; today: string; state: TrainState; children?: React.ReactNode;
}) {
  const sc = useTheme().semanticColors;
  const insets = useScreenInsets();
  useStatusBarBand(sc.surface.masthead);
  const week = useMemo(() => trainWeek(rows, today), [rows, today]);
  const light = { color: sc.textOnAccent };
  const muted = { color: sc.textOnMastheadMuted };
  const bar = { backgroundColor: sc.surface.forestBand };
  const line = doneLine(week);
  return (
    <View testID="train-masthead" style={[s.mast, { backgroundColor: sc.surface.masthead, paddingTop: insets.top + layout.statusBarGap }]}>
      {children}
      {state === 'loading' ? (
        <View style={s.pad} testID="train-masthead-loading" accessible accessibilityLabel={c.loading}>
          <View style={s.row}>
            <View style={[s.flex, s.gap]}><View style={[s.line, bar, { width: '45%' }]} /><View style={[s.line, bar, { width: '60%' }]} /></View>
            <View style={[s.ringSkel, bar]} />
          </View>
          <View style={s.strip}>{DAY_LABELS.map((_, d) => <View key={d} style={[s.daySkel, bar]} />)}</View>
        </View>
      ) : state === 'failed' ? null : (
        <View style={s.pad} testID="train-week">
          <View style={s.row}>
            <View style={s.flex}>
              <Text maxFontSizeMultiplier={CAP} style={[typography.eyebrow, muted]}>{c.week}</Text>
              {week.total > 0 ? <Text maxFontSizeMultiplier={CAP} style={[typography.bodyMd, light]}>{line}</Text> : null}
            </View>
            {week.total > 0 ? (
              <SegmentedRing onDark size={88} segments={week.segments} label={line} testID="train-week-ring">
                <Text maxFontSizeMultiplier={1.15} style={[typography.h3, light, s.tabular]}>{`${week.done}/${week.total}`}</Text>
              </SegmentedRing>
            ) : null}
          </View>
          <View style={s.strip}>
            {week.days.map((mark, d) => (
              <View key={d} style={s.day}>
                <Text maxFontSizeMultiplier={CAP} style={[typography.caption, muted]} importantForAccessibility="no" aria-hidden>{DAY_LABELS[d]}</Text>
                <DayMark onDark state={mark} day={week.dates[d]} label={`${week.dates[d]}, ${c.day[mark]}`} testID={`train-day-${d}`} />
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

/** The tab's header alone with the flag off; on the masthead with it on (so no status-bar change when off). */
export function TrainHead({ on, children, ...rest }: React.ComponentProps<typeof TrainMasthead> & { on: boolean }) {
  return on ? <TrainMasthead {...rest}>{children}</TrainMasthead> : <>{children}</>;
}

/**
 * Under the masthead: today's workout, Start workout, the coach's note, the details, the blocks. With no workout ever set, a
 * calm empty line (the tab's Quick workout stays the one forest action below it); with every workout done, nothing.
 */
export function TrainDay({ workout, hasAny, state, coachless, coachId, userId, onStart, onRetry, today }: {
  workout: TrainWorkout | null; hasAny: boolean; state: TrainState; coachless: boolean;
  coachId?: string | null; userId?: string; onStart: (params: StartParams) => void; onRetry: () => unknown; today: string;
}) {
  const sc = useTheme().semanticColors;
  const ink = { color: sc.textPrimary };
  const muted = { color: sc.textMuted };
  const [italic] = useFonts({ CormorantGaramond_400Regular_Italic });
  const coaches = useMyCoaches(!coachless && !!userId).data;
  // The empty line names the client's coach; a note is signed only by the coach who set that workout (a note
  // kept from a former coach shows unsigned, never under the current coach's name).
  const coachName = coachless ? null : firstName((coaches?.find((x) => x.coach_id === coachId) ?? coaches?.[0])?.name);
  const author = coachless || !workout ? null : firstName(coaches?.find((x) => x.coach_id === workout.assigned_by_coach_id)?.name);
  const plan = useMemo(() => (workout ? assignmentPrescription(workout) : null), [workout]);
  const ids = useMemo(() => (plan?.exercises ?? []).map((e) => e.exercise_external_id), [plan]);
  // Start waits for the names: the session copies them at Start (as WorkoutAssignmentDetail does).
  const { names, loading: namesLoading } = useExerciseNames(ids);
  const nameOf = (id: string) => names[id] || prettifyExerciseName(id) || 'Exercise';
  const [resume, setResume] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  };
  const workoutId = workout?.id;
  useFocusEffect(useCallback(() => {
    let live = true;
    setResume(false);
    if (userId && workoutId) {
      loadActiveWorkoutSession(userId).then((saved) => { if (live) setResume(saved?.session.assignmentId === workoutId); }, () => undefined);
    }
    return () => { live = false; };
  }, [userId, workoutId]));

  if (state === 'loading') {
    return (
      <View style={s.body} testID="train-day-loading" accessible accessibilityLabel={c.loading}>
        <View style={[s.line, s.overSkel, { backgroundColor: sc.border }]} />
        <View style={[s.line, s.titleSkel, { backgroundColor: sc.border }]} />
        <View style={s.startWrap}><PrimaryButton label={c.start} disabled onPress={() => undefined} testID="train-start" /></View>
        <View style={[s.cardSkel, { backgroundColor: sc.border }]} />
        {[0, 1, 2].map((i) => <View key={i} style={[s.rowSkel, { borderTopColor: sc.border }]}><View style={[s.line, { width: '50%', backgroundColor: sc.border }]} /></View>)}
      </View>
    );
  }
  if (state === 'failed') {
    return (
      <View style={s.body} testID="train-day-failed" accessibilityRole="alert">
        <Text style={[typography.body, ink]}>{c.failed}</Text>
        <QuietTextButton label={c.retry} onPress={() => void retry()} disabled={retrying} testID="train-retry" />
      </View>
    );
  }
  if (!workout || !plan) {
    if (hasAny) return null;
    return (
      <View style={s.body} testID="train-day-empty">
        {coachless ? <Text maxFontSizeMultiplier={CAP} style={[typography.eyebrow, muted, s.over]}>{c.yourPlan}</Text> : null}
        <Text accessibilityRole="header" style={[typography.h1, ink]}>{c.nothing}</Text>
        {coachless ? null : <Text style={[typography.body, ink, s.lede]}>{c.whenPlan(coachName ?? c.yourCoach)}</Text>}
      </View>
    );
  }

  // The day's note first; before the coach writes one, the first coach note in its rows (plan C1 section 8).
  const note = coachless ? undefined : workout.client_note?.trim() || plan.exercises.find((e) => e.notes?.trim())?.notes?.trim();
  const changes = new Map(((workout.roman_adjusted_sets ?? []) as Change[]).map((x) => [x.order, x]));
  const isToday = dayOf(workout) === today;
  const when = isToday
    ? c.today
    : new Date(workout.scheduled_for).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const minutes = plan.durationMinutes ? ` · ${c.minutes(plan.durationMinutes)}` : '';
  const start = () => {
    if (namesLoading) return;
    void HapticService.mediumImpact();
    const exercises = buildActiveWorkoutExercises({ exercises: plan.exercises })
      .map((e) => ({ ...e, exerciseName: names[e.exerciseId] || e.exerciseName }));
    onStart({ routineId: workout.workout_plan?.id ?? workout.workout_plan_id, routineName: plan.name, exercises: JSON.stringify(exercises), assignmentId: workout.id });
  };
  return (
    <View style={s.body} testID="train-day">
      <Text maxFontSizeMultiplier={CAP} style={[typography.eyebrow, muted, s.over]}>{when}</Text>
      <Text accessibilityRole="header" style={[typography.h1, ink]}>{plan.name}</Text>
      <View style={s.startWrap}>
        <PrimaryButton
          label={namesLoading ? c.names : resume ? c.resume : c.start} onPress={start} loading={namesLoading} haptic={false}
          accessibilityHint={`Opens ${plan.name} as a live workout`} testID="train-start"
        />
      </View>
      {isToday && plan.adjustedOrders.size > 0 ? (
        <Text style={[typography.h4, ink, s.lead]} testID="train-adjusted-lead">{c.adjustedToday(author)}</Text>
      ) : null}
      {note ? (
        <View style={[s.card, { backgroundColor: sc.surface.sage }]} testID="train-coach-note" accessible>
          {author ? (
            <View style={[s.avatar, { backgroundColor: sc.surface.masthead }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Text maxFontSizeMultiplier={1.15} style={[typography.h3, { color: sc.textOnAccent }]}>{author.charAt(0).toUpperCase()}</Text>
            </View>
          ) : null}
          <View style={s.flex}>
            <Text style={[s.note, italic && s.italic, ink]}>{note}</Text>
            {author ? <Text style={[typography.bodySmall, ink]} testID="train-coach-note-author">{author}</Text> : null}
          </View>
        </View>
      ) : null}
      <Text style={[typography.bodySmall, muted, s.tabular, s.meta]} testID="train-details">{`${c.exercises(plan.exercises.length)}${minutes}`}</Text>
      {blocksOf(plan.exercises).map((b) => {
        const changed = b.rows.find((r) => plan.adjustedOrders.has(r.order));
        const change = changed ? changes.get(changed.order) : undefined;
        const reason = typeof change?.client_reason === 'string' ? change.client_reason.trim() : '';
        return (
          <View key={b.letter} style={[s.block, { borderTopColor: sc.border }]} accessible testID={`train-block-${b.letter}`}>
            <View style={[s.letter, { borderColor: sc.data.moss }]}>
              <Text maxFontSizeMultiplier={1.15} style={[typography.h3, ink]}>{b.letter}</Text>
            </View>
            <View style={[s.flex, changed && [s.changed, { backgroundColor: sc.surface.sage, borderLeftColor: sc.data.forest }]]}>
              <Text style={[typography.h4, ink]}>{b.rows.map((r) => nameOf(r.exercise_external_id)).join(' + ')}</Text>
              <Text style={[typography.bodySmall, muted, s.tabular]}>{blockLine(b)}</Text>
              {changed ? (
                <Text style={[typography.bodySmall, s.mark, s.tabular, { color: sc.accentText }]} testID={`train-block-${b.letter}-adjusted`}>
                  {typeof change?.sets_before === 'number' ? c.changed(author, changed.sets, change.sets_before) : c.adjusted}
                </Text>
              ) : null}
              {reason ? <Text style={[typography.h3, italic && s.italic, ink, s.reason]} testID={`train-block-${b.letter}-reason`}>{reason}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  mast: { borderBottomLeftRadius: radius.sheet, borderBottomRightRadius: radius.sheet, paddingBottom: 24, marginBottom: 24 },
  pad: { paddingHorizontal: layout.gutter },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  flex: { flex: 1, minWidth: 0 },
  gap: { gap: 10 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 },
  day: { alignItems: 'center', gap: 6, minWidth: 40 },
  tabular: { fontVariant: ['tabular-nums'] },
  line: { height: 14, borderRadius: radius.control },
  ringSkel: { width: 88, height: 88, borderRadius: radius.pill },
  daySkel: { width: 36, height: 36, borderRadius: radius.pill, marginTop: 20 },
  body: { marginHorizontal: layout.gutter, marginBottom: 24 },
  over: { marginBottom: 8 },
  lede: { marginTop: 8 },
  card: { flexDirection: 'row', gap: 14, padding: 20, borderRadius: radius.card, marginBottom: 16 },
  avatar: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  note: { ...typography.h3, lineHeight: 26, marginBottom: 6 },
  italic: { fontFamily: 'CormorantGaramond_400Regular_Italic', fontWeight: '400' },
  startWrap: { marginTop: 16, marginBottom: 20 },
  meta: { marginBottom: 12 },
  lead: { marginBottom: 12 },
  changed: { borderLeftWidth: 3, borderTopRightRadius: radius.card, borderBottomRightRadius: radius.card, paddingVertical: 10, paddingHorizontal: 14 },
  mark: { fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  reason: { marginTop: 6 },
  block: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: layout.rowMinHeight, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  letter: { width: 32, height: 32, borderRadius: radius.control, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  overSkel: { width: '30%', marginBottom: 8 },
  titleSkel: { width: '55%', height: 28, marginVertical: 6 },
  cardSkel: { height: 120, borderRadius: radius.card, marginBottom: 16 },
  rowSkel: { minHeight: layout.rowMinHeight, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth },
});
