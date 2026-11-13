/**
 * WORKOUT-SUMMARY-M (C1 Style C v2, frame C5): the workout summary's rules. No screen code.
 * - coachRatingInput: what Send adds to the one completion (PATCH /assignments/:id/complete): post_rpe, a whole 1 to 10,
 *   and post_notes, trimmed, at most 1000 (the server's CompleteAssignmentDto). Nothing chosen: no key, never 0 or "".
 * - whatMoved: "{n} lb more on every set" when every ticked set is exactly n lb heavier than the same-numbered set last
 *   time (previousSets) with the same reps or more; a record line on main's rule (workoutSummary, the last 50 saved
 *   workouts) in main's basis words. Never for a seconds or body-weight exercise. At most the two rows the frame draws.
 * - summaryWeek: the Train week (trainWeek over the same GET /assignments/me rows); after Send this workout's own row
 *   counts done, once, and its segment and day are the ones that draw in.
 */
import { previousSets, type LoggedWorkout } from './sessionQuality';
import type { SessionExercise } from './types';
import { isTimedRow } from '../../../utils/workout/exerciseUnit';
import { trainWeek } from '../train/TrainToday';
import type { WorkoutWeek } from '../../coach/client-detail/thisWeek';

export const NOTE_MAX = 1000;
const MOVED_ROWS = 2;

/** The client's How hard and note, as the completion body carries them. */
export interface CoachRating { post_rpe?: number; post_notes?: string }

export function coachRatingInput(rpe: number | null | undefined, note: string | null | undefined): CoachRating {
  const out: CoachRating = {};
  if (typeof rpe === 'number' && Number.isInteger(rpe) && rpe >= 1 && rpe <= 10) out.post_rpe = rpe;
  const text = (note ?? '').trim().slice(0, NOTE_MAX);
  if (text) out.post_notes = text;
  return out;
}

/** Words (WORKOUT-SUMMARY-M "Wording needed"; {coach} is the coach's first name, else "your coach"). */
export const SUMMARY_COPY = {
  week: 'This week', // C1-C-32
  ring: (done: number, total: number) => `${done} of ${total}`, // C1-C-08's form; spoken as doneLine ("{n} of {total} done")
  complete: 'Workout complete.', // EX-31
  totals: (minutes: number, sets: number, volume: number) =>
    `${minutes} min · ${sets} ${sets === 1 ? 'set' : 'sets'} · ${volume.toLocaleString()} lb`, // WSM-01
  moved: 'What moved', // C1-C-33
  more: (exercise: string, lb: number) => `${exercise}: ${lb.toLocaleString()} lb more on every set`, // C1-C-34
  best: (exercise: string, weight: number, reps: number) =>
    `${exercise}: ${weight.toLocaleString()} × ${reps}, heaviest in your last 50 saved workouts`, // WSM-02 (C2_offline words)
  recentBest: 'Recent best', // WSM-03, the star's spoken word on main's basis
  howHard: 'How hard, 1 to 10', // C1-C-36
  note: (coach: string) => `Note for ${coach}`, // C1-S-29's form
  send: (coach: string) => `Send to ${coach}`, // C1-C-37
  notSent: (coach: string) => `Not sent to ${coach} yet`, // C1-C-45
  safe: (coach: string) => `Your sets are safe on this phone. They go to ${coach} when the connection is back, or you can try now.`, // C1-C-46
  tryAgain: 'Try again', // C1-S-47
  back: 'Back to the workout', // WSM-04
  leave: 'Leave workout', // main's
  yourCoach: 'your coach',
};

export interface MovedLine {
  kind: 'more' | 'best';
  exercise: string;
  text: string;
  /** The heaviest weight, on a record line (the Share link's card). */
  weight?: number;
}

const nameKey = (name: string) => name.trim().toLowerCase();

export function whatMoved(
  exercises: ReadonlyArray<SessionExercise>,
  history: LoggedWorkout[],
  records: ReadonlyArray<{ name: string; weight: number }>,
  bodyWeight: Record<string, boolean | undefined>,
): MovedLine[] {
  const lines: MovedLine[] = [];
  for (const exercise of exercises) {
    // LS-928 B4: a set counted in seconds, or a body-weight set, carries no lb to compare.
    if (isTimedRow(exercise) || bodyWeight[exercise.exerciseId]) continue;
    const ticked = exercise.sets.map((set, number) => ({ set, number })).filter(({ set }) => set.completed);
    if (ticked.length === 0) continue;
    const record = records.find((r) => nameKey(r.name) === nameKey(exercise.exerciseName));
    if (record) {
      const reps = Math.max(...ticked.filter(({ set }) => set.weight === record.weight).map(({ set }) => set.reps));
      lines.push({ kind: 'best', exercise: exercise.exerciseName, weight: record.weight, text: SUMMARY_COPY.best(exercise.exerciseName, record.weight, reps) });
      continue;
    }
    const last = previousSets(history, exercise.exerciseName, exercise.unit);
    const gains = ticked.map(({ set, number }) => {
      const before = last[number];
      return before && set.reps >= before.reps ? set.weight - before.weight : Number.NaN;
    });
    const lb = gains[0];
    if (lb > 0 && gains.every((g) => g === lb)) {
      lines.push({ kind: 'more', exercise: exercise.exerciseName, text: SUMMARY_COPY.more(exercise.exerciseName, lb) });
    }
  }
  return lines.slice(0, MOVED_ROWS);
}

type WeekRow = Parameters<typeof trainWeek>[0][number] & { id: string };

export function summaryWeek(
  rows: ReadonlyArray<WeekRow>,
  today: string,
  assignmentId: string,
  sent: boolean,
): { week: WorkoutWeek; drawIndex: number | null; drawDay: number | null } {
  const before = trainWeek(rows, today);
  if (!sent) return { week: before, drawIndex: null, drawDay: null };
  // Its own row only, by id: a refreshed read that already has it done counts it once.
  const week = trainWeek(rows.map((r) => (r.id === assignmentId && !r.completed_at ? { ...r, completed_at: 'sent' } : r)), today);
  const drawIndex = week.segments.findIndex((s, i) => s === 'done' && before.segments[i] !== 'done');
  const drawDay = week.days.findIndex((d, i) => d === 'done' && before.days[i] !== 'done');
  return { week, drawIndex: drawIndex < 0 ? null : drawIndex, drawDay: drawDay < 0 ? null : drawDay };
}
