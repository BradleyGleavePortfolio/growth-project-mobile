/**
 * FIX-928 (fix round 3 of m#928): one table per class LS-928 named.
 * B1/B3 "a known unit lost at a boundary", B4 "weight x count assumes reps",
 * B2 "terminal catalog misses retry". Each table holds known seconds, reps,
 * an absent (legacy) unit, a zero and body weight vs a weighted zero.
 */
import { setVolume } from '../utils/workout/exerciseUnit';
import { catalogReadRetry, byIdQuery } from '../hooks/exerciseByIdQuery';
import { isPhoneMadeId } from '../utils/workout/exerciseId';
import { romanVoiceLog } from '../lib/roman/copy';
import { loggedWorkoutExercises, loggedWorkoutEditPayload, workoutSummary } from '../screens/client/active-workout/sessionQuality';

describe('B4 class: one set adds weight x reps to lb volume, a timed set adds none', () => {
  it.each([
    ['reps', 20, 10, 200],
    [undefined, 20, 10, 200],
    [null, 135, 5, 675],
    ['other', 20, 10, 200],
    ['seconds', 20, 60, 0],
    ['seconds', 0, 60, 0],
    ['reps', 0, 10, 0],
    ['reps', undefined, 10, 0],
  ])('unit %p, %p lb x %p -> %p', (unit, weight, count, volume) => {
    expect(setVolume(weight, count, unit)).toBe(volume);
  });

  it('the finish summary mixes a timed and a rep exercise without counting seconds', () => {
    const summary = workoutSummary([
      { exerciseId: 'a', exerciseName: 'Weighted plank', unit: 'seconds', sets: [{ weight: 20, reps: 60, completed: true }] },
      { exerciseId: 'b', exerciseName: 'Curl', sets: [{ weight: 20, reps: 10, completed: true }, { weight: 20, reps: 10, completed: false }] },
    ], []);
    expect(summary).toMatchObject({ exercises: 2, sets: 2, volume: 200 });
  });
});

describe('B1 class: a saved exercise keeps its known unit into the edit, and the edit PUT is unchanged', () => {
  const saved = (asked_unit: unknown) => ({
    id: 'w', exercises: [{
      exercise_name: 'Plank', muscle_group: 'core', sets_completed: 1,
      weight_per_set: [0], reps_per_set: [60], asked_unit: asked_unit as string | null | undefined,
    }],
  });
  it.each([
    ['seconds', 'seconds'],
    ['reps', 'reps'],
    [null, undefined],
    [undefined, undefined],
    ['minutes', undefined],
  ])('asked_unit %p -> unit %p', (asked, unit) => {
    const workout = saved(asked);
    const [exercise] = loggedWorkoutExercises(workout);
    expect(exercise.unit).toBe(unit);
    expect(exercise.sets).toEqual([{ weight: 0, reps: 60, completed: true }]);
    const body = loggedWorkoutEditPayload(workout, [exercise], '');
    expect(body.exercises[0]).not.toHaveProperty('unit');
    expect(body.exercises[0]).not.toHaveProperty('asked_unit');
    expect(body.exercises[0].reps_per_set).toEqual([60]);
    expect(body.exercises[0].weight_per_set).toEqual([0]);
  });
});

describe('B3 class: Roman reads a set back in its own unit and load words', () => {
  it.each([
    [{ weight: 135, reps: 5 }, '135 pounds, 5 reps.'],
    [{ weight: 0, reps: 10 }, '0 pounds, 10 reps.'],
    [{ weight: 0, reps: 60, timed: true }, '0 pounds, 60 seconds.'],
    [{ weight: 20, reps: 45, timed: true }, '20 pounds, 45 seconds.'],
    [{ weight: 0, reps: 60, timed: true, bodyWeight: true }, 'Body weight, 60 seconds.'],
    [{ weight: 0, reps: 12, bodyWeight: true }, 'Body weight, 12 reps.'],
    [{ weight: 25, reps: 8, bodyWeight: true }, '25 pounds, 8 reps.'],
  ])('%p -> %p', (args, line) => {
    expect(romanVoiceLog({ ...args, mode: 'default' })).toBe(line);
  });
  it('the celebration keeps the unit too', () => {
    expect(romanVoiceLog({ weight: 20, reps: 60, timed: true, mode: 'celebration' })).toBe('20 pounds, 60 seconds — and a new best. Noted.');
    expect(romanVoiceLog({ weight: 135, reps: 5, mode: 'celebration' })).toBe('135 pounds, 5 reps — and a new best. Noted.');
  });
});

describe('B2 class: a catalog read by id is retried once, never on an answer that will not change', () => {
  const err = (status?: number, code?: string) => (status ? { response: { status, data: code ? { code } : {} } } : new Error('Network Error'));
  it.each([
    [err(404), false],
    [err(400), false],
    [err(403), false],
    [err(503, 'EXERCISEDB_NOT_CONFIGURED'), false],
    [err(503), true],
    [err(500), true],
    [err(408), true],
    [err(429), true],
    [err(), true],
  ])('first failure %p -> retry %p', (error, retry) => {
    expect(catalogReadRetry(0, error)).toBe(retry);
    expect(catalogReadRetry(1, error)).toBe(false);
  });
  it.each([
    ['ex_abc123', false],
    ['logged:0', false],
    ['manual:plank', false],
    ['seed:core-001', 'fn'],
    ['0001', 'fn'],
  ])('id %p: retry option %p', (id, kind) => {
    expect(isPhoneMadeId(id)).toBe(kind === false);
    const { retry, queryKey } = byIdQuery(id);
    expect(queryKey).toEqual(['exercises', 'by-id', id]);
    if (kind === false) expect(retry).toBe(false);
    else expect(typeof retry).toBe('function');
  });
});
