/**
 * WORKOUT-SUMMARY-M (C1 Style C v2, frame C5): the summary's rules, without the screen.
 * S3/S4: what Send adds to the one completion (post_rpe 1 to 10, the note trimmed, at most 1000; nothing when not given).
 * S11: What moved ("{n} lb more on every set" only when every ticked set is exactly n lb heavier with the same reps or
 * more; a record line on main's rule, never for a seconds or body-weight exercise; at most the two rows the frame draws).
 * S12: the week ring over the same rows, this workout counted done once after Send.
 */
import { coachRatingInput, NOTE_MAX, summaryWeek, whatMoved } from '../summaryC5';
import type { LoggedWorkout } from '../sessionQuality';
import type { SessionExercise } from '../types';

const set = (weight: number, reps: number, completed = true) => ({ weight, reps, completed });
const exercise = (name: string, sets: SessionExercise['sets'], extra: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: `id-${name}`, exerciseName: name, muscleGroup: 'chest', restSec: 60, sets, ...extra,
});
const logged = (name: string, weights: number[], reps: number[], extra: Record<string, unknown> = {}) => ({
  exercise_name: name, muscle_group: 'chest', sets_completed: weights.length, weight_per_set: weights, reps_per_set: reps, ...extra,
});
const history = (...exercises: ReturnType<typeof logged>[]): LoggedWorkout[] => [{ id: 'w1', exercises }];

describe('S3 and S4: what Send adds to the completion', () => {
  it('a chosen number and a note go in as post_rpe and the trimmed note', () => {
    expect(coachRatingInput(8, '  Squats felt strong.  ')).toEqual({ post_rpe: 8, post_notes: 'Squats felt strong.' });
  });
  it('no number and an empty or blank note add no key at all (never 0 or "")', () => {
    expect(coachRatingInput(null, '')).toEqual({});
    expect(coachRatingInput(undefined, '   \n ')).toEqual({});
    expect(Object.keys(coachRatingInput(null, ' '))).toHaveLength(0);
  });
  it('a number is only a whole 1 to 10', () => {
    for (const bad of [0, 11, -1, 7.5, Number.NaN]) expect(coachRatingInput(bad, '')).toEqual({});
    for (const good of [1, 10]) expect(coachRatingInput(good, '')).toEqual({ post_rpe: good });
  });
  it('the note takes at most 1000 characters (the server\'s limit)', () => {
    expect(NOTE_MAX).toBe(1000);
    expect(coachRatingInput(null, 'x'.repeat(1200)).post_notes).toHaveLength(1000);
  });
});

describe('S11: What moved', () => {
  it('every ticked set exactly 5 lb heavier with the same reps reads "{n} lb more on every set"', () => {
    const lines = whatMoved([exercise('Bench press', [set(155, 6), set(155, 6), set(155, 7)])], history(logged('Bench press', [150, 150, 150], [6, 6, 6])), [], {});
    expect(lines.map((l) => l.text)).toEqual(['Bench press: 5 lb more on every set']);
  });
  it('different gains, fewer reps, no gain or no last time give no line', () => {
    const last = history(logged('Bench press', [150, 150], [6, 6]));
    expect(whatMoved([exercise('Bench press', [set(155, 6), set(160, 6)])], last, [], {})).toEqual([]);
    expect(whatMoved([exercise('Bench press', [set(155, 6), set(155, 5)])], last, [], {})).toEqual([]);
    expect(whatMoved([exercise('Bench press', [set(150, 6), set(150, 6)])], last, [], {})).toEqual([]);
    expect(whatMoved([exercise('Bench press', [set(155, 6), set(155, 6)])], [], [], {})).toEqual([]);
    // A ticked set with no same-numbered set last time.
    expect(whatMoved([exercise('Bench press', [set(155, 6), set(155, 6), set(155, 6)])], last, [], {})).toEqual([]);
  });
  it('an unticked set does not count, and a ticked set keeps its own number', () => {
    const last = history(logged('Row', [100, 100, 100], [8, 8, 8]));
    expect(whatMoved([exercise('Row', [set(110, 8), set(0, 8, false), set(110, 8)])], last, [], {}).map((l) => l.text))
      .toEqual(['Row: 10 lb more on every set']);
  });
  it('a seconds or body-weight exercise never gets an lb line, even when main\'s record rule lists it', () => {
    const plank = exercise('Plank', [set(10, 60), set(10, 60)], { unit: 'seconds' } as Partial<SessionExercise>);
    const pushUp = exercise('Push-up', [set(10, 12), set(10, 12)]);
    const last = history(logged('Plank', [5, 5], [60, 60], { asked_unit: 'seconds' }), logged('Push-up', [5, 5], [12, 12]));
    const records = [{ name: 'Plank', weight: 10 }, { name: 'Push-up', weight: 10 }];
    expect(whatMoved([plank, pushUp], last, records, { 'id-Push-up': true })).toEqual([]);
  });
  it('a record reads main\'s basis words with the heaviest set\'s reps, and wins over the every-set line', () => {
    const squat = exercise('Back squat', [set(185, 5), set(185, 6), set(175, 8)]);
    const lines = whatMoved([squat], history(logged('Back squat', [175, 175, 175], [5, 5, 8])), [{ name: 'Back squat', weight: 185 }], {});
    expect(lines.map((l) => [l.kind, l.text])).toEqual([['best', 'Back squat: 185 × 6, heaviest in your last 50 saved workouts']]);
  });
  it('at most the two rows the frame draws, in exercise order', () => {
    const ex = ['A', 'B', 'C'].map((n) => exercise(n, [set(105, 5)]));
    const last = history(...['A', 'B', 'C'].map((n) => logged(n, [100], [5])));
    expect(whatMoved(ex, last, [], {}).map((l) => l.exercise)).toEqual(['A', 'B']);
  });
});

describe('S12: the week ring', () => {
  const row = (id: string, day: string, done: boolean) => ({ id, scheduled_for: `${day}T12:00:00.000Z`, completed_at: done ? `${day}T18:00:00.000Z` : null });
  // Wednesday 2026-11-11; Monday done, today open, Saturday planned.
  const rows = [row('mon', '2026-11-09', true), row('today', '2026-11-11', false), row('sat', '2026-11-14', false)];
  it('before Send this workout is not counted; after Send it is, once, and only its own segment draws', () => {
    const before = summaryWeek(rows, '2026-11-11', 'today', false);
    expect([before.week.done, before.week.total, before.drawIndex]).toEqual([1, 3, null]);
    const after = summaryWeek(rows, '2026-11-11', 'today', true);
    expect([after.week.done, after.week.total]).toEqual([2, 3]);
    expect(after.drawIndex).toBe(1);
    expect(after.drawDay).toBe(2);
  });
  it('a refreshed read that already has it done still counts it once', () => {
    const refreshed = rows.map((r) => (r.id === 'today' ? { ...r, completed_at: '2026-11-11T19:00:00.000Z' } : r));
    const after = summaryWeek(refreshed, '2026-11-11', 'today', true);
    expect([after.week.done, after.week.total, after.drawIndex]).toEqual([2, 3, null]);
  });
  it('another assignment id never changes the count', () => {
    expect(summaryWeek(rows, '2026-11-11', 'not-mine', true).week.done).toBe(1);
  });
});
