// SET-EDIT-M (agent 203): a client can remove one wrong set in the live workout
// (saved routine, coach-assigned, Quick workout, resume) and in the edit of a
// saved workout. What is saved (the Finish POST, the coach's completion payload,
// the Save changes PUT) equals the sets left on screen; nothing else in a body
// changes. The real screens, with the api mocked at its edge.
import React from 'react';
import { Alert, AppState } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachBrief: true, romanChat: true } }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', role: 'client', coach_id: 'coach' }) }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
jest.mock('../components/roman/RomanAvatar', () => () => null);
const mockNavigation = {
  navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), dispatch: jest.fn(),
  addListener: jest.fn(() => () => undefined),
};
let mockRouteParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: mockRouteParams }),
}));
jest.mock('../hooks/useApi', () => ({ useCreateWorkout: () => ({ isPending: false, mutate: jest.fn() }) }));
const mockLoadSession = jest.fn();
const mockSaveSession = jest.fn(async (..._a: unknown[]) => undefined);
const mockClearSession = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a),
  saveActiveWorkoutSession: (...a: unknown[]) => mockSaveSession(...a),
  clearActiveWorkoutSession: (...a: unknown[]) => mockClearSession(...a),
}));
const mockPut = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({ data: { equipment: 'barbell' } })),
    put: (...a: unknown[]) => mockPut(...a),
  },
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
}));
const mockGetAllExercises = jest.fn();
jest.mock('../db/workoutDb', () => ({ getAllExercises: (...a: unknown[]) => mockGetAllExercises(...a) }));
jest.mock('../api/workoutBuilderApi', () => ({ workoutBuilderApi: { completeMyAssignment: jest.fn(async () => undefined) } }));
const mockQueue = jest.fn();
jest.mock('../offline', () => ({
  queueWorkout: (...a: unknown[]) => mockQueue(...a),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(async () => undefined),
  triggerSync: jest.fn(async () => undefined),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'rest-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  setNotificationHandler: jest.fn(), setNotificationChannelAsync: jest.fn(async () => undefined),
}));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(), warning: jest.fn(), error: jest.fn(),
    heavyImpact: jest.fn(), success: jest.fn(), lightImpact: jest.fn(),
  },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import WorkoutHistoryEditScreen from '../screens/client/WorkoutHistoryEditScreen';
import { loggedWorkoutEditPayload, loggedWorkoutExercises, type LoggedWorkout } from '../screens/client/active-workout/sessionQuality';
import { toServerMuscleGroup } from '../utils/workout/muscleGroup';
import { romanVoiceLog } from '../lib/roman/copy';

type Button = { text: string; onPress?: () => unknown };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const alertMock = () => Alert.alert as unknown as jest.Mock;
const alertsTitled = (title: string) => alertMock().mock.calls.filter((c) => c[0] === title);
const readback = (weight: number, reps: number) => romanVoiceLog({ weight, reps, timed: false, bodyWeight: false, mode: 'default' });
const json = (v: unknown) => JSON.stringify(v);

let client: QueryClient;
let spies: jest.SpyInstance[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockQueue.mockResolvedValue({ id: 'q1', alreadySynced: false, serverId: null });
  mockPut.mockResolvedValue({ data: {} });
  mockGetAllExercises.mockResolvedValue([{ id: 'e1', name: 'Incline Press', muscle: 'chest', equipment: 'Dumbbell', imageUrl: null }]);
  spies = [
    jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => undefined })),
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined),
  ];
});
afterEach(async () => {
  spies.forEach((s) => s.mockRestore());
  await cleanup();
  client.clear();
});

const frame = { x: 0, y: 0, width: 390, height: 844 };
const insets = { top: 47, bottom: 34, left: 0, right: 0 };
const wrap = (node: React.ReactElement) => (
  <QueryClientProvider client={client}>
    <SafeAreaProvider initialMetrics={{ frame, insets }}>{node}</SafeAreaProvider>
  </QueryClientProvider>
);

async function press(view: Awaited<ReturnType<typeof render>>, label: string) {
  await act(async () => { fireEvent.press(view.getByLabelText(label)); await flush(); });
}
async function pressId(view: Awaited<ReturnType<typeof render>>, id: string) {
  await act(async () => { fireEvent.press(view.getByTestId(id)); await flush(); });
}
async function answer(title: string, button: string) {
  const calls = alertsTitled(title);
  expect(calls.length).toBeGreaterThan(0);
  const b = (calls[calls.length - 1][2] as Button[]).find((x) => x.text === button)!;
  await act(async () => { await b.onPress?.(); await flush(); });
}
async function finish(view: Awaited<ReturnType<typeof render>>) {
  await pressId(view, 'finish-workout');
  await answer('Finish workout?', 'Finish');
  expect(mockQueue).toHaveBeenCalledTimes(1);
  const queued = mockQueue.mock.calls[0][0] as {
    payload: Record<string, unknown>;
    assignment: null | { input: { completion_payload: unknown } };
  };
  return { post: queued.payload, completion: queued.assignment?.input.completion_payload };
}
/** The POST body with its own date and duration (from the clock) and every other field literal. */
const postBody = (post: Record<string, unknown>, name: string, exercises: unknown[]) => ({
  date: post.date, workout_name: name, workout_type: 'strength', duration_minutes: post.duration_minutes, notes: '', exercises,
});
const logged = (name: string, muscle: string, sets: Array<[number, number]>, plan: Record<string, unknown> = {}) => ({
  exercise_name: name, muscle_group: toServerMuscleGroup(muscle), sets_completed: sets.length,
  weight_per_set: sets.map((s) => s[0]), reps_per_set: sets.map((s) => s[1]), notes: '', ...plan,
});

// ---------------------------------------------------------------- live workout

type LiveSet = { weight: number; reps: number; completed: boolean; prescribedZero?: boolean };
const resumed = (exercises: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
  isStale: false,
  session: {
    version: 1, startedAtMs: Date.now() - 20 * 60_000, updatedAtMs: Date.now(), routineName: 'Upper Body A', exercisesJson: '[]',
    idempotencyKey: '', sessionExercises: exercises, ...extra,
  },
});
const bench = (sets: LiveSet[]) => ({ exerciseId: 'ex-1', exerciseName: 'Bench Press', muscleGroup: 'chest', restSec: 90, sets });
const row = (sets: LiveSet[]) => ({ exerciseId: 'ex-2', exerciseName: 'Seated Row', muscleGroup: 'back', restSec: 60, sets });
const set = (weight: number, reps: number, completed = false): LiveSet => ({ weight, reps, completed });

async function openLive(name = 'Bench Press') {
  const view = await render(wrap(<ActiveWorkoutScreen />));
  await waitFor(() => expect(view.getByText(name)).toBeTruthy());
  await act(async () => { await flush(); });
  return view;
}
function startResumed(exercises: Array<Record<string, unknown>>) {
  mockRouteParams = { routineName: 'Upper Body A', exercises: '[]', resume: true };
  mockLoadSession.mockResolvedValue(resumed(exercises));
}

describe('live workout: the remove control', () => {
  it('sits on the open row only: the next set, and a set once its numbers are tapped open (ticked or not)', async () => {
    startResumed([bench([set(95, 8, true), set(100, 6), set(105, 5)])]);
    const view = await openLive();
    // Set 2 is next: its numbers are open, so it has the control; set 1 (ticked) and set 3 are text rows.
    expect(view.getByLabelText('Remove set 2 from Bench Press')).toBeTruthy();
    expect(view.queryByLabelText('Remove set 1 from Bench Press')).toBeNull();
    expect(view.queryByLabelText('Remove set 3 from Bench Press')).toBeNull();
    await pressId(view, 'set-value-0-0');
    await pressId(view, 'set-value-0-2');
    expect(view.getByLabelText('Remove set 1 from Bench Press')).toBeTruthy();
    expect(view.getByLabelText('Remove set 3 from Bench Press')).toBeTruthy();
  });
});

describe('live workout, saved routine resumed', () => {
  it('case 1: an unticked extra set leaves at once with no ask; the count drops; the POST is as without it', async () => {
    startResumed([bench([set(95, 8), set(100, 6), set(105, 5)]), row([set(80, 10)])]);
    const view = await openLive();
    await pressId(view, 'set-done-0-0');
    expect(view.getByText('1 / 4 sets')).toBeTruthy();
    await pressId(view, 'set-value-0-2');
    await press(view, 'Remove set 3 from Bench Press');
    expect(alertMock()).not.toHaveBeenCalled();
    expect(view.queryByTestId('set-row-0-2')).toBeNull();
    expect(view.getByText('1 / 3 sets')).toBeTruthy();
    const { post } = await finish(view);
    expect(json(post)).toBe(json(postBody(post, 'Upper Body A', [logged('Bench Press', 'chest', [[95, 8]])])));
  });

  it('case 2: a ticked set asks first; Keep leaves it; Remove takes it out of the POST, the rest in order', async () => {
    startResumed([bench([set(95, 8, true), set(100, 6, true), set(105, 5, true)])]);
    const view = await openLive();
    await pressId(view, 'set-value-0-1');
    await press(view, 'Remove set 2 from Bench Press');
    const asks = alertsTitled('Remove set 2?');
    expect(asks).toHaveLength(1);
    expect(asks[0][1]).toBe('This logged set will be removed from this workout.');
    expect((asks[0][2] as Button[]).map((b) => b.text)).toEqual(['Keep', 'Remove']);
    await answer('Remove set 2?', 'Keep');
    expect(view.getByTestId('set-row-0-2')).toBeTruthy();
    await press(view, 'Remove set 2 from Bench Press');
    await answer('Remove set 2?', 'Remove');
    expect(view.queryByTestId('set-row-0-2')).toBeNull();
    expect(view.getByText('2 / 2 sets')).toBeTruthy();
    const { post } = await finish(view);
    expect(json(post)).toBe(json(postBody(post, 'Upper Body A', [logged('Bench Press', 'chest', [[95, 8], [105, 5]])])));
  });

  it('case 3: removing set 2 of 3 while set 3 is open with a typed draft leaves set 3 as "Set 2" with its own numbers only', async () => {
    startResumed([bench([set(95, 8), set(100, 6), set(105, 5)])]);
    const view = await openLive();
    await pressId(view, 'set-value-0-1');
    await pressId(view, 'set-value-0-2');
    await act(async () => { fireEvent.changeText(view.getByTestId('set-weight-0-2'), '107.'); await flush(); });
    await press(view, 'Remove set 2 from Bench Press');
    expect(view.queryByTestId('set-row-0-2')).toBeNull();
    // The removed set's open fields do not carry over to the row now in its place.
    expect(view.queryByTestId('set-weight-0-1')).toBeNull();
    expect(view.getByTestId('set-value-0-1').props.accessibilityLabel).toBe('Set 2, 107 pounds, 5 reps. Change the numbers');
    // Set 1 is still the next set, with its own number.
    expect(view.getByTestId('set-weight-0-0').props.value).toBe('95');
  });

  it('case 4: removing the set ticked last stops its rest; the readback reads the next latest; the next tick reads first', async () => {
    startResumed([bench([set(95, 8), set(100, 6), set(105, 5)])]);
    const view = await openLive();
    await pressId(view, 'set-done-0-0');
    await pressId(view, 'set-done-0-1');
    expect(view.getByTestId('rest-timer')).toBeTruthy();
    expect(view.getByText(readback(100, 6))).toBeTruthy();
    await pressId(view, 'set-value-0-1');
    await press(view, 'Remove set 2 from Bench Press');
    await answer('Remove set 2?', 'Remove');
    expect(view.queryByTestId('rest-timer')).toBeNull();
    expect(view.getByText(readback(95, 8))).toBeTruthy();
    await pressId(view, 'set-done-0-1');
    expect(view.getByText(readback(105, 5))).toBeTruthy();
  });

  it('case 6: kill and reopen after a removal keeps it removed; Leave keeps the changed session', async () => {
    startResumed([bench([set(95, 8), set(100, 6), set(105, 5)])]);
    const view = await openLive();
    await pressId(view, 'set-value-0-2');
    await press(view, 'Remove set 3 from Bench Press');
    await press(view, 'Leave workout');
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockClearSession).not.toHaveBeenCalled();
    const saved = mockSaveSession.mock.calls[mockSaveSession.mock.calls.length - 1][1] as { sessionExercises: Array<{ sets: LiveSet[] }> };
    expect(json(saved.sessionExercises[0].sets)).toBe(json([set(95, 8), set(100, 6)]));
    await cleanup();
    mockLoadSession.mockResolvedValue({ isStale: false, session: { ...saved, version: 1, updatedAtMs: Date.now() } });
    const reopened = await openLive();
    expect(reopened.getByTestId('set-row-0-1')).toBeTruthy();
    expect(reopened.queryByTestId('set-row-0-2')).toBeNull();
  });

  it('negative: with no removal the POST is main\'s, and Add set still copies the last set', async () => {
    startResumed([bench([set(95, 8, true), set(100, 6)])]);
    const view = await openLive();
    await act(async () => { fireEvent.press(view.getByText('Add set')); await flush(); });
    expect(view.getByTestId('set-row-0-2')).toBeTruthy();
    expect(view.getByText('1 / 3 sets')).toBeTruthy();
    const { post } = await finish(view);
    expect(json(post)).toBe(json(postBody(post, 'Upper Body A', [logged('Bench Press', 'chest', [[95, 8]])])));
  });
});

describe('live workout, coach-assigned', () => {
  const assigned = JSON.stringify([
    { exerciseId: 'cat-1', exerciseName: 'Bench Press', sets: 3, reps: 8, restSec: 90, weightLbs: 95, workoutPlanExerciseId: 'wpe-1', muscleGroup: 'chest', planOrder: 0 },
    { exerciseId: 'cat-2', exerciseName: 'Seated Row', sets: 1, reps: 10, restSec: 60, weightLbs: 80, workoutPlanExerciseId: 'wpe-2', muscleGroup: 'back', planOrder: 1 },
  ]);
  beforeEach(() => {
    mockRouteParams = { routineName: 'Push A', exercises: assigned, assignmentId: 'asg-1' };
    mockLoadSession.mockResolvedValue(null);
  });

  it('cases 1, 5 and 8: an unticked set and a whole exercise\'s sets go; plan fields stay; the completion payload renumbers', async () => {
    const view = await openLive();
    await pressId(view, 'set-done-0-0');
    await pressId(view, 'set-value-0-2');
    await press(view, 'Remove set 3 from Bench Press');
    expect(alertMock()).not.toHaveBeenCalled();
    // Case 5: every set of Seated Row.
    await pressId(view, 'exercise-waiting-1');
    await pressId(view, 'set-value-1-0');
    await press(view, 'Remove set 1 from Seated Row');
    expect(view.queryByTestId('set-row-1-0')).toBeNull();
    expect(view.getByText('0 of 0 sets complete')).toBeTruthy();
    expect(view.getByTestId('live-block-line').props.children).toBe('Block A of B');
    expect(view.getByText('1 / 2 sets')).toBeTruthy();
    expect(view.getByTestId('exercise-active-0')).toBeTruthy();
    const { post, completion } = await finish(view);
    expect(json(post)).toBe(json(postBody(post, 'Push A', [
      logged('Bench Press', 'chest', [[95, 8]], { plan_assignment_id: 'asg-1', plan_order: 0 }),
    ])));
    expect(json(completion)).toBe(json({ exercises: [
      { exerciseName: 'Bench Press', workoutPlanExerciseId: 'wpe-1', sets: [
        { set_index: 1, status: 'completed', actual_reps: 8, actual_weight_lbs: 95 },
        { set_index: 2, status: 'skipped', actual_reps: 8, actual_weight_lbs: 95 },
      ] },
      { exerciseName: 'Seated Row', workoutPlanExerciseId: 'wpe-2', sets: [] },
    ] }));
  });

  it('case 2 coach-assigned: Remove on a ticked set takes it out of the POST and the completion payload', async () => {
    const view = await openLive();
    await act(async () => { fireEvent.changeText(view.getByTestId('set-weight-0-0'), '90'); await flush(); });
    await pressId(view, 'set-done-0-0');
    await pressId(view, 'set-done-0-1');
    await pressId(view, 'set-value-0-0');
    await press(view, 'Remove set 1 from Bench Press');
    await answer('Remove set 1?', 'Remove');
    const { post, completion } = await finish(view);
    expect(json(post)).toBe(json(postBody(post, 'Push A', [
      logged('Bench Press', 'chest', [[95, 8]], { plan_assignment_id: 'asg-1', plan_order: 0 }),
    ])));
    expect(json(completion)).toBe(json({ exercises: [
      { exerciseName: 'Bench Press', workoutPlanExerciseId: 'wpe-1', sets: [
        { set_index: 1, status: 'completed', actual_reps: 8, actual_weight_lbs: 95 },
        { set_index: 2, status: 'skipped', actual_reps: 8, actual_weight_lbs: 95 },
      ] },
      { exerciseName: 'Seated Row', workoutPlanExerciseId: 'wpe-2', sets: [
        { set_index: 1, status: 'skipped', actual_reps: 10, actual_weight_lbs: 80 },
      ] },
    ] }));
  });
});

describe('live workout, Quick workout', () => {
  it('case 7: an exercise picked from the sheet removes an unticked set at once and a ticked one after the ask', async () => {
    mockRouteParams = { routineName: 'Quick Workout', exercises: '[]' };
    mockLoadSession.mockResolvedValue(null);
    const view = await render(wrap(<ActiveWorkoutScreen />));
    await waitFor(() => expect(view.getByTestId('active-workout-empty')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByText('Add exercise')); await flush(); });
    await waitFor(() => expect(view.getByText('Incline Press')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByText('Incline Press')); await flush(); });
    await waitFor(() => expect(view.getByTestId('set-row-0-2')).toBeTruthy());
    await act(async () => { fireEvent.changeText(view.getByTestId('set-weight-0-0'), '20'); await flush(); });
    await pressId(view, 'set-done-0-0');
    await act(async () => { fireEvent.changeText(view.getByTestId('set-weight-0-1'), '25'); await flush(); });
    await pressId(view, 'set-done-0-1');
    await press(view, 'Remove set 3 from Incline Press');
    expect(alertMock()).not.toHaveBeenCalled();
    await pressId(view, 'set-value-0-0');
    await press(view, 'Remove set 1 from Incline Press');
    await answer('Remove set 1?', 'Remove');
    expect(view.getByText('1 / 1 sets')).toBeTruthy();
    const { post } = await finish(view);
    expect(json(post)).toBe(json(postBody(post, 'Quick Workout', [
      logged('Incline Press', toServerMuscleGroup('chest'), [[25, 10]]),
    ])));
  });
});

describe('live workout: timed and body-weight rows', () => {
  it('case 13: a timed set and a coach\'s 0 lb set remove the same way', async () => {
    startResumed([
      { exerciseId: 'ex-3', exerciseName: 'Plank', muscleGroup: 'core', unit: 'seconds', restSec: 60, sets: [set(0, 60), set(0, 60)] },
      { exerciseId: 'ex-4', exerciseName: 'Push-up', muscleGroup: 'chest', restSec: 60,
        sets: [{ ...set(0, 12), prescribedZero: true }, { ...set(0, 12), prescribedZero: true }] },
    ]);
    const view = await openLive('Plank');
    await press(view, 'Remove set 1 from Plank');
    expect(view.queryByTestId('set-row-0-1')).toBeNull();
    await pressId(view, 'exercise-waiting-1');
    await pressId(view, 'set-value-1-1');
    await press(view, 'Remove set 2 from Push-up');
    expect(view.queryByTestId('set-row-1-1')).toBeNull();
    expect(view.getByText('0 / 2 sets')).toBeTruthy();
  });
});

// ------------------------------------------------------- edit of a saved workout

const savedWorkout = (exercises: LoggedWorkout['exercises']): LoggedWorkout => ({
  id: 'w1', workout_name: 'Push A', notes: 'felt good', duration_minutes: 50, exercises,
});
const A = {
  exercise_name: 'Bench Press', muscle_group: 'chest', sets_completed: 3, weight_per_set: [135, 140, 145], reps_per_set: [8, 6, 5],
  notes: 'a', rpe: 8, video_url: 'https://video.example/a', plan_assignment_id: 'asg-1', plan_order: 0,
};
const B = {
  exercise_name: 'Seated Row', muscle_group: 'back', sets_completed: 2, weight_per_set: [80, 85], reps_per_set: [10, 10],
  notes: 'b', rpe: 7, video_url: 'https://video.example/b', plan_assignment_id: 'asg-1', plan_order: 1,
};
const EMPTY = { exercise_name: 'Face Pull', muscle_group: 'shoulders', sets_completed: 0, weight_per_set: [], reps_per_set: [], notes: 'none done' };
const mainBody = (w: LoggedWorkout) => loggedWorkoutEditPayload(w, loggedWorkoutExercises(w), w.notes ?? '');

async function openEdit(w: LoggedWorkout) {
  mockRouteParams = { workout: JSON.stringify(w) };
  const view = await render(wrap(<WorkoutHistoryEditScreen />));
  await waitFor(() => expect(view.getByText(w.exercises[0].exercise_name)).toBeTruthy());
  return view;
}
async function save(view: Awaited<ReturnType<typeof render>>) {
  await press(view, 'Save workout changes');
  expect(mockPut).toHaveBeenCalledTimes(1);
  expect(mockPut.mock.calls[0][0]).toBe('/workouts/w1');
  return mockPut.mock.calls[0][1];
}

describe('edit of a saved workout', () => {
  it('case 9: removing set 2 of 3 sends the other two in order; every other exercise is main\'s, no ask', async () => {
    const w = savedWorkout([A, B, EMPTY]);
    const view = await openEdit(w);
    await press(view, 'Remove set 2 from Bench Press');
    expect(alertMock()).not.toHaveBeenCalled();
    expect(view.getByTestId('set-weight-0-1').props.value).toBe('145');
    expect(view.queryByTestId('set-weight-0-2')).toBeNull();
    const body = await save(view);
    const main = mainBody(w);
    expect(json(body)).toBe(json({ ...main, exercises: [
      { ...main.exercises[0], sets_completed: 2, weight_per_set: [135, 145], reps_per_set: [8, 5] },
      main.exercises[1], main.exercises[2],
    ] }));
  });

  it('case 10 (operator ruling): the only set of A goes; A is sent with 0 sets and its own fields; B keeps its own', async () => {
    const one = { ...A, sets_completed: 1, weight_per_set: [135], reps_per_set: [8] };
    const w = savedWorkout([one, B]);
    const view = await openEdit(w);
    await press(view, 'Remove set 1 from Bench Press');
    expect(view.getByText('No sets left')).toBeTruthy();
    expect(view.getByLabelText('Notes for Bench Press')).toBeTruthy();
    const body = await save(view);
    const main = mainBody(w);
    expect(json(body)).toBe(json({ ...main, exercises: [
      { ...main.exercises[0], sets_completed: 0, weight_per_set: [], reps_per_set: [] },
      main.exercises[1],
    ] }));
    expect(body.exercises[1]).toMatchObject({ rpe: 7, video_url: 'https://video.example/b', plan_assignment_id: 'asg-1', plan_order: 1 });
  });

  it('case 11: the last set in the workout has no remove', async () => {
    const solo = await openEdit(savedWorkout([{ ...A, sets_completed: 1, weight_per_set: [135], reps_per_set: [8] }]));
    expect(solo.queryByLabelText('Remove set 1 from Bench Press')).toBeNull();
    await cleanup();
    const two = await openEdit(savedWorkout([{ ...A, sets_completed: 1, weight_per_set: [135], reps_per_set: [8] },
      { ...B, sets_completed: 1, weight_per_set: [80], reps_per_set: [10] }]));
    expect(two.getByLabelText('Remove set 1 from Seated Row')).toBeTruthy();
    await press(two, 'Remove set 1 from Bench Press');
    expect(two.queryByLabelText('Remove set 1 from Seated Row')).toBeNull();
  });

  it('case 12: remove then Cancel asks to discard and sends nothing; a failed Save keeps the removal on screen', async () => {
    const w = savedWorkout([A, B]);
    const view = await openEdit(w);
    await press(view, 'Remove set 3 from Bench Press');
    await press(view, 'Cancel workout editing');
    await answer('Discard workout changes?', 'Discard changes');
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockPut).not.toHaveBeenCalled();
    await cleanup();
    mockPut.mockRejectedValueOnce(new Error('offline'));
    const again = await openEdit(w);
    await press(again, 'Remove set 3 from Bench Press');
    await press(again, 'Save workout changes');
    expect(alertsTitled('Workout changes not saved')).toHaveLength(1);
    expect(again.queryByTestId('set-weight-0-2')).toBeNull();
    expect(again.getByTestId('set-weight-0-1').props.value).toBe('140');
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('case 13: a timed exercise removes the same way', async () => {
    const plank = { exercise_name: 'Plank', muscle_group: 'core', sets_completed: 2, weight_per_set: [0, 0], reps_per_set: [60, 45], notes: '', asked_unit: 'seconds' };
    const w = savedWorkout([plank, B]);
    const view = await openEdit(w);
    await press(view, 'Remove set 1 from Plank');
    const body = await save(view);
    const main = mainBody(w);
    expect(json(body)).toBe(json({ ...main, exercises: [
      { ...main.exercises[0], sets_completed: 1, weight_per_set: [0], reps_per_set: [45] }, main.exercises[1],
    ] }));
  });

  it('negative: no removal sends main\'s body, including an exercise saved with 0 sets', async () => {
    const w = savedWorkout([A, EMPTY, B]);
    const view = await openEdit(w);
    const body = await save(view);
    expect(json(body)).toBe(json(mainBody(w)));
    expect(body.exercises).toHaveLength(3);
  });
});
