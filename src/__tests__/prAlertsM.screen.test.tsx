/**
 * PR-ALERTS-M (C1 v2 C2_logger, LO-WORKOUT C7): the real live workout marks a recent best with the gold star line on
 * the exercise where it was lifted, in the open block from the tick and in the folded block as drawn; it is spoken
 * once when a tap of hers makes it, never for a best that is simply there, and it leaves when the sets stop holding
 * it. Stand-ins from fr917r3LoggerDay.screen.test.tsx and workoutSummaryC5.screen.test.tsx. The file sets its own
 * switches, so it runs the same in the required run and in "All switches on". Fixtures are fictional.
 */
import React from 'react';
import { AccessibilityInfo, Alert, StyleSheet, Text } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

const mockFlags: Record<string, boolean> = { romanChat: false, romanP3Lock: true, shareSheetV2: false, clientTrainV2: false };
jest.mock('../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
let mockUser: { id: string; role: string; coach_id: string | null } = { id: 'client-pra', role: 'student', coach_id: 'coach-sam' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
let mockCoachless = false;
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => mockCoachless }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
const mockHaptic: Record<string, jest.Mock> = {};
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: (_t, k: string) => (mockHaptic[k] ??= jest.fn()) }),
}));
let mockParams: Record<string, unknown> = { routineName: 'Legs with Sam', assignmentId: 'assignment-legs', exercises: '[]' };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(), setParams: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
let mockSaved: unknown = null;
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => mockSaved),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../components/tutorial/TutorialTarget', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../components/HapticPressable', () => ({
  __esModule: true, default: jest.requireActual('react-native').Pressable,
}));
jest.mock('../components/share/ShareSheet', () => ({
  __esModule: true, default: () => null, ShareLink: () => null,
}));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
let mockBodyWeight: Record<string, boolean> = {};
jest.mock('../hooks/useBodyWeightExercises', () => ({ useBodyWeightExercises: () => mockBodyWeight }));
const mockCreate = jest.fn();
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({
    isPending: false,
    mutate: async (payload: unknown, options: { onSuccess: (value: unknown) => void }) =>
      options.onSuccess(await mockCreate(payload)),
  }),
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: {
    completeMyAssignment: jest.fn(async () => ({})),
    listMyAssignments: jest.fn(async () => []),
  },
}));
const mockQueue = jest.fn();
jest.mock('../offline', () => ({
  queueWorkout: (...args: unknown[]) => mockQueue(...args),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(),
  triggerSync: jest.fn(async () => undefined),
  workoutSyncEvents: { on: jest.fn(() => () => undefined), off: jest.fn(), emit: jest.fn() },
}));
const mockGetAll = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: [] })), post: jest.fn(async () => ({ data: {} })) },
  workoutApi: { getAll: (...args: unknown[]) => mockGetAll(...args) },
}));
jest.mock('../lib/userCache', () => ({ readUserCacheSync: jest.fn(() => mockUser), readUserCache: jest.fn(async () => mockUser) }));
jest.mock('../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn(async () => undefined) } }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn() }));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

const BASIS = 'heaviest in your last 50 saved workouts';
const line = (k: number, r: number, w: number) => `${k} × ${r} at ${w} lb, ${BASIS}`;
const spoken = (k: number, r: number, w: number) => `Recent best: ${k} ${k === 1 ? 'set' : 'sets'} of ${r} reps at ${w} pounds, ${BASIS}`;
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

const past = (rows: Array<[name: string, weight: number, reps: number, sets: number]>) => [{
  id: 'past-legs', workout_name: 'Legs with Sam', notes: '', duration_minutes: 50,
  exercises: rows.map(([name, weight, reps, sets]) => ({
    exercise_name: name, muscle_group: 'legs', sets_completed: sets,
    weight_per_set: Array(sets).fill(weight), reps_per_set: Array(sets).fill(reps),
  })),
}];
/** History: Back squat 4 × 5 at 180, Bench press 3 × 6 at 155 (so only Back squat can make a best). */
const AT_180 = past([['Back squat', 180, 5, 4], ['Bench press', 155, 6, 3]]);
/** History at 185: the same day makes no best. */
const AT_185 = past([['Back squat', 185, 5, 4], ['Bench press', 155, 6, 3]]);

type Row = [name: string, sets: number, weight: number, reps: number, extra?: Record<string, unknown>];
const DAY: Row[] = [['Back squat', 4, 185, 5], ['Bench press', 3, 155, 6, { notes: 'Elbows tucked, bar to the lower chest.' }]];
const plan = ([name, sets, weight, reps, extra]: Row, order: number) => ({
  exercise_external_id: `seed:${name.toLowerCase().replace(/ /g, '-')}`, order, sets, reps_or_duration_seconds: reps,
  weight_lbs: weight, rest_seconds: 0, superset_group_id: null, notes: null, ...extra,
});
const seeds = (rows: Row[]) => rows.flatMap((row, order) =>
  buildActiveWorkoutExercises({ exercises: [plan(row, order)] }).map((e) => ({ ...e, exerciseName: row[0] })));

let announced: jest.SpyInstance;
const bestAnnouncements = () => announced.mock.calls.map((c) => String(c[0])).filter((t) => t.includes('Recent best'));
const hapticCalls = () => Object.entries(mockHaptic).map(([k, fn]) => `${k}:${fn.mock.calls.length}`).filter((s) => !s.endsWith(':0')).sort();

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockHaptic)) delete mockHaptic[k];
  Object.assign(mockFlags, { romanChat: false, romanP3Lock: true, shareSheetV2: false, clientTrainV2: false });
  mockUser = { id: 'client-pra', role: 'student', coach_id: 'coach-sam' };
  mockCoachless = false;
  mockBodyWeight = {};
  mockSaved = null;
  mockParams = { routineName: 'Legs with Sam', assignmentId: 'assignment-legs', exercises: '[]' };
  mockGetAll.mockImplementation(async () => ({ data: AT_180 }));
  mockCreate.mockResolvedValue({ id: 'saved-legs' });
  mockQueue.mockResolvedValue({ id: 'queued-legs', alreadySynced: false });
  announced = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    (buttons ?? []).find((b) => b.text === 'Remove' || b.text === 'Finish')?.onPress?.();
  });
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

async function start(rows: Row[] = DAY, params: Record<string, unknown> = {}) {
  mockParams = { ...mockParams, exercises: JSON.stringify(seeds(rows)), ...params };
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByTestId('set-done-0-0')).toBeTruthy());
  await waitFor(() => expect(mockGetAll).toHaveBeenCalled());
  await act(flush);
  return view;
}
const tick = async (view: Awaited<ReturnType<typeof render>>, ex: number, set: number) => {
  await fireEvent.press(view.getByTestId(`set-done-${ex}-${set}`));
  await act(flush);
};
/** The text of every Text node under `root`, in tree order. */
const texts = (root: ReturnType<Awaited<ReturnType<typeof render>>['getByTestId']>) =>
  within(root).UNSAFE_queryAllByType(Text).map((t) => {
    const c = t.props.children;
    return Array.isArray(c) ? c.join('') : String(c ?? '');
  });

describe('s1-s3 the moment, more sets, the drawn state', () => {
  it('s1 the moment: the line under "1 of 4 sets complete", one accessible element, the star hidden, spoken once, no new haptic', async () => {
    const view = await start();
    expect(view.queryByTestId('exercise-best-0')).toBeNull();
    await tick(view, 0, 0);
    const best = view.getByTestId('exercise-best-0');
    expect(within(best).getByText(line(1, 5, 185))).toBeTruthy();
    expect(best.props.accessible).toBe(true);
    expect(best.props.accessibilityLabel).toBe(spoken(1, 5, 185));
    const star = view.getByTestId('exercise-best-star-0');
    expect(star.props.accessibilityLabel).toBeUndefined();
    expect(star.props.accessible).toBe(false);
    // Under main's count line, in the open block.
    const card = view.getByTestId('exercise-active-0');
    const order = texts(card);
    expect(order.indexOf('1 of 4 sets complete')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(line(1, 5, 185))).toBeGreaterThan(order.indexOf('1 of 4 sets complete'));
    expect(bestAnnouncements()).toEqual([`Back squat. ${spoken(1, 5, 185)}`]);
    const withBest = hapticCalls();
    await cleanup();
    for (const k of Object.keys(mockHaptic)) delete mockHaptic[k];
    mockGetAll.mockImplementation(async () => ({ data: AT_185 }));
    const plain = await start();
    await tick(plain, 0, 0);
    expect(plain.queryByTestId('exercise-best-0')).toBeNull();
    expect(hapticCalls()).toEqual(withBest);
  });

  it('s2 sets 2 to 4: the words follow, "4 of 4 sets complete" stays above, nothing is spoken again', async () => {
    const view = await start();
    for (const s of [0, 1, 2, 3]) await tick(view, 0, s);
    expect(within(view.getByTestId('exercise-best-0')).getByText(line(4, 5, 185))).toBeTruthy();
    expect(view.getByText('4 of 4 sets complete')).toBeTruthy();
    expect(view.queryByTestId('exercise-folded-0')).toBeNull();
    expect(bestAnnouncements()).toHaveLength(1);
  });

  it('s3 the drawn state: the folded block holds the star and the line in place of the count; its label adds the best; a press opens it', async () => {
    const view = await start();
    for (const s of [0, 1, 2, 3]) await tick(view, 0, s);
    await tick(view, 1, 0);
    const folded = view.getByTestId('exercise-folded-0');
    expect(within(folded).getByTestId('exercise-best-star-0')).toBeTruthy();
    expect(within(folded).getByText(line(4, 5, 185))).toBeTruthy();
    expect(within(folded).queryByText('4 of 4 sets complete')).toBeNull();
    expect(folded.props.accessibilityLabel).toBe(`Show sets for Back squat, 4 of 4 sets complete. ${spoken(4, 5, 185)}`);
    expect(bestAnnouncements()).toHaveLength(1);
    await fireEvent.press(folded);
    expect(view.getByTestId('set-row-0-0')).toBeTruthy();
    expect(view.getByTestId('exercise-best-0')).toBeTruthy();
    expect(view.getByText('4 of 4 sets complete')).toBeTruthy();
  });
});

describe('s4-s8 no best, and the line goes away truthfully', () => {
  it('s4 no best (history at 185): no line through the same taps; the folded label is exactly main\'s', async () => {
    mockGetAll.mockImplementation(async () => ({ data: AT_185 }));
    const view = await start();
    for (const s of [0, 1, 2, 3]) await tick(view, 0, s);
    await tick(view, 1, 0);
    expect(view.queryAllByTestId(/^exercise-best/)).toHaveLength(0);
    expect(view.getByTestId('exercise-folded-0').props.accessibilityLabel).toBe('Show sets for Back squat, 4 of 4 sets complete');
    expect(bestAnnouncements()).toHaveLength(0);
  });

  it('s5 untick the only record set: the line leaves; tick it again: it is back, not spoken again', async () => {
    const view = await start();
    await tick(view, 0, 0);
    expect(view.getByTestId('exercise-best-0')).toBeTruthy();
    await tick(view, 0, 0);
    expect(view.queryByTestId('exercise-best-0')).toBeNull();
    await tick(view, 0, 0);
    expect(within(view.getByTestId('exercise-best-0')).getByText(line(1, 5, 185))).toBeTruthy();
    expect(bestAnnouncements()).toHaveLength(1);
  });

  it('s6 190 typed into a ticked 180 set: the line at 190; 170: it leaves', async () => {
    const view = await start([['Back squat', 4, 180, 5], DAY[1]]);
    await tick(view, 0, 0);
    expect(view.queryByTestId('exercise-best-0')).toBeNull();
    await fireEvent.press(view.getByTestId('set-value-0-0'));
    await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '190');
    await act(flush);
    expect(within(view.getByTestId('exercise-best-0')).getByText(line(1, 5, 190))).toBeTruthy();
    expect(bestAnnouncements()).toEqual([`Back squat. ${spoken(1, 5, 190)}`]);
    await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '170');
    await act(flush);
    expect(view.queryByTestId('exercise-best-0')).toBeNull();
  });

  it('s7 the record set removed (the ask, then Remove): the line leaves; the exercise removed: no line, no error', async () => {
    const view = await start();
    await tick(view, 0, 0);
    expect(view.getByTestId('exercise-best-0')).toBeTruthy();
    await fireEvent.press(view.getByTestId('set-value-0-0'));
    await fireEvent.press(view.getByTestId('remove-set-0-0'));
    await act(flush);
    expect(Alert.alert).toHaveBeenCalledWith('Remove set 1?', expect.any(String), expect.any(Array));
    expect(view.queryByTestId('exercise-best-0')).toBeNull();
    await tick(view, 0, 0);
    expect(view.getByTestId('exercise-best-0')).toBeTruthy();
    await fireEvent.press(view.getByTestId('remove-exercise-0'));
    await act(flush);
    expect(view.queryAllByTestId(/^exercise-best/)).toHaveLength(0);
    expect(view.getByText('Bench press')).toBeTruthy();
  });

  it('s8 never a guess: the read fails: no line, main\'s unavailable line shows', async () => {
    mockGetAll.mockImplementation(async () => { throw new Error('Network Error'); });
    const view = await start();
    for (const s of [0, 1, 2, 3]) await tick(view, 0, s);
    await tick(view, 1, 0);
    expect(view.queryAllByTestId(/^exercise-best/)).toHaveLength(0);
    expect(view.getByText('Previous performance unavailable. Sets can still be logged.')).toBeTruthy();
  });

  it('s8 never a guess: the read answers after the tick: the line appears, nothing is spoken', async () => {
    let answer: (value: { data: unknown }) => void = () => undefined;
    mockGetAll.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const view = await start();
    await tick(view, 0, 0);
    expect(view.queryByTestId('exercise-best-0')).toBeNull();
    await act(async () => { answer({ data: AT_180 }); await flush(); });
    await waitFor(() => expect(view.getByTestId('exercise-best-0')).toBeTruthy());
    expect(within(view.getByTestId('exercise-best-0')).getByText(line(1, 5, 185))).toBeTruthy();
    expect(bestAnnouncements()).toHaveLength(0);
  });
});

describe('s9-s13 restore, every set done, everyone, never seconds or body weight', () => {
  it('s9 a restored workout with a ticked 185: the line is there after the read, nothing is spoken', async () => {
    const exercises = seeds(DAY);
    const now = Date.now();
    mockSaved = {
      isStale: false,
      session: {
        version: 1, startedAtMs: now - 20 * 60_000, updatedAtMs: now - 60_000, routineName: 'Legs with Sam',
        exercisesJson: JSON.stringify(exercises), assignmentId: 'assignment-legs', idempotencyKey: 'key-legs', workoutNotes: '',
        sessionExercises: [
          { exerciseId: 'seed:back-squat', exerciseName: 'Back squat', restSec: 0, sets: [
            { weight: 185, reps: 5, completed: true, doneOrder: 1 }, { weight: 185, reps: 5, completed: false },
            { weight: 185, reps: 5, completed: false }, { weight: 185, reps: 5, completed: false }] },
          { exerciseId: 'seed:bench-press', exerciseName: 'Bench press', restSec: 0, sets: [
            { weight: 155, reps: 6, completed: false }, { weight: 155, reps: 6, completed: false }, { weight: 155, reps: 6, completed: false }] },
        ],
      },
    };
    const view = await start(DAY, { resume: true });
    await waitFor(() => expect(view.getByTestId('exercise-best-0')).toBeTruthy());
    expect(within(view.getByTestId('exercise-best-0')).getByText(line(1, 5, 185))).toBeTruthy();
    await act(flush);
    expect(bestAnnouncements()).toHaveLength(0);
  });

  it('s10 every set of both exercises ticked: nothing folds, the line is still on Back squat', async () => {
    const view = await start();
    for (const s of [0, 1, 2, 3]) await tick(view, 0, s);
    for (const s of [0, 1, 2]) await tick(view, 1, s);
    expect(view.queryAllByTestId(/^exercise-folded-/)).toHaveLength(0);
    expect(within(view.getByTestId('exercise-best-0')).getByText(line(4, 5, 185))).toBeTruthy();
    expect(view.getByText('4 of 4 sets complete')).toBeTruthy();
  });

  it.each([
    ['a client with no coach', () => { mockUser = { id: 'client-pra', role: 'student', coach_id: null }; mockCoachless = true; }, {}],
    ['a Quick workout with no assignment', () => undefined, { routineName: 'Quick workout', assignmentId: undefined }],
  ])('s11 who: %s sees s1\'s line, and it names no coach', async (_who, setUp, params) => {
    setUp();
    const view = await start(DAY, params);
    await tick(view, 0, 0);
    const best = view.getByTestId('exercise-best-0');
    expect(within(best).getByText(line(1, 5, 185))).toBeTruthy();
    expect(best.props.accessibilityLabel).toBe(spoken(1, 5, 185));
    expect(`${texts(best).join(' ')} ${best.props.accessibilityLabel}`).not.toMatch(/coach|Sam/i);
    expect(bestAnnouncements()).toEqual([`Back squat. ${spoken(1, 5, 185)}`]);
  });

  it.each([[false], [true]])('s12 clientTrainV2 %s: s1 and s3 the same', async (on) => {
    mockFlags.clientTrainV2 = on;
    const view = await start();
    await tick(view, 0, 0);
    expect(within(view.getByTestId('exercise-best-0')).getByText(line(1, 5, 185))).toBeTruthy();
    for (const s of [1, 2, 3]) await tick(view, 0, s);
    await tick(view, 1, 0);
    const folded = view.getByTestId('exercise-folded-0');
    expect(within(folded).getByText(line(4, 5, 185))).toBeTruthy();
    expect(folded.props.accessibilityLabel).toBe(`Show sets for Back squat, 4 of 4 sets complete. ${spoken(4, 5, 185)}`);
  });

  it('s13 a seconds exercise and a body-weight exercise that beat their earlier weight: no line', async () => {
    mockGetAll.mockImplementation(async () => ({ data: past([['Plank hold', 20, 60, 2], ['Pull up', 20, 8, 2]]) }));
    mockBodyWeight = { 'seed:pull-up': true };
    const view = await start([['Plank hold', 2, 25, 60, { unit: 'seconds' }], ['Pull up', 2, 25, 8]]);
    for (const s of [0, 1]) await tick(view, 0, s);
    for (const s of [0, 1]) await tick(view, 1, s);
    expect(view.queryAllByTestId(/^exercise-best/)).toHaveLength(0);
    expect(bestAnnouncements()).toHaveLength(0);
  });
});

describe('s14-s17 nothing saved or sent, size, guards, the two places agree', () => {
  it('s14 Finish: the saved body is the same with a history that makes a best and one that does not', async () => {
    const bodies: unknown[] = [];
    for (const history of [AT_180, AT_185]) {
      mockCreate.mockClear();
      mockQueue.mockClear();
      mockGetAll.mockImplementation(async () => ({ data: history }));
      const view = await start();
      await tick(view, 0, 0);
      await act(async () => { await fireEvent.press(view.getByTestId('finish-workout')); await flush(); });
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      bodies.push({ post: mockCreate.mock.calls[0][0], queued: (mockQueue.mock.calls[0][0] as { payload: unknown }).payload });
      await cleanup();
    }
    expect(bodies[0]).toEqual(bodies[1]);
    expect(JSON.stringify(bodies[0])).not.toMatch(/best|heaviest|star/i);
  });

  it('s15 320 x 568 at 130%: the sentence has no numberOfLines and no size cap main\'s sub lines lack; the star keeps its size', async () => {
    const view = await start();
    await tick(view, 0, 0);
    const words = within(view.getByTestId('exercise-best-0')).getByText(line(1, 5, 185));
    const count = view.getByText('1 of 4 sets complete');
    expect(words.props.numberOfLines).toBeUndefined();
    expect(words.props.maxFontSizeMultiplier).toBe(count.props.maxFontSizeMultiplier);
    expect(words.props.allowFontScaling).not.toBe(false);
    const w = StyleSheet.flatten(words.props.style);
    const c = StyleSheet.flatten(count.props.style);
    expect([w.fontSize, w.lineHeight, w.color, w.fontFamily]).toEqual([c.fontSize, c.lineHeight, c.color, c.fontFamily]);
    expect(w.width).toBeUndefined();
    expect(w.height).toBeUndefined();
    const lineStyle = StyleSheet.flatten(view.getByTestId('exercise-best-0').props.style);
    expect(lineStyle.height).toBeUndefined();
    expect(lineStyle.maxHeight).toBeUndefined();
  });

  const SRC = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  const MINE = ['screens/client/active-workout/blockBest.ts', 'screens/client/active-workout/ExerciseCard.tsx'];
  it.each(MINE)('s16 %s: no colour literal, no pale green name, no "New best", "Best ever" or "heaviest yet"', (p) => {
    const text = SRC(p);
    // A colour literal in quotes (an owner id such as #197-E10 in a comment is not one).
    expect(text).not.toMatch(/['"`]#[0-9a-f]{3,8}['"`]|rgba?\(/i);
    expect(text).not.toMatch(/surface\.sage|sageLine/);
    expect(text).not.toMatch(/New best|Best ever|heaviest yet/i);
  });
  it('s16 the star is the one from ui/charts/StyleCMarks; no second star under active-workout/', () => {
    expect(SRC('screens/client/active-workout/ExerciseCard.tsx')).toMatch(/import \{[^}]*\bPeakStar\b[^}]*\} from '\.\.\/\.\.\/\.\.\/ui\/charts\/StyleCMarks'/);
    for (const p of ['blockBest.ts', 'ExerciseCard.tsx']) {
      const text = SRC(`screens/client/active-workout/${p}`);
      expect(text).not.toMatch(/react-native-svg|<Path\b|name="star/);
    }
  });

  it('s17 the two places agree: with clientTrainV2 on, What moved names the same 185 the logger drew', async () => {
    mockFlags.clientTrainV2 = true;
    const view = await start();
    for (const s of [0, 1, 2, 3]) await tick(view, 0, s);
    await tick(view, 1, 0);
    expect(within(view.getByTestId('exercise-folded-0')).getByText(line(4, 5, 185))).toBeTruthy();
    await act(async () => { await fireEvent.press(view.getByTestId('finish-workout')); await flush(); });
    await waitFor(() => expect(view.getByTestId('what-moved-0')).toBeTruthy());
    expect(within(view.getByTestId('what-moved-0')).getByText(`Back squat: 185 × 5, ${BASIS}`)).toBeTruthy();
  });
});
