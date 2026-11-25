/**
 * BW-LOCAL-M (agent 203, owner #197-E10): an exercise from the phone's own
 * list (Quick workout Add, Swap) or from a saved routine reads BW in the live
 * workout, as m#928's catalog body-weight rows do. The catalog read
 * (GET /exercises/:id) cannot answer these ids; the phone's own list
 * (getAllExercises) says the equipment, by id first, then by name. A catalog
 * answer always wins, and everything sent or kept is unchanged (a 0 saves 0).
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';
import { routineToSessionExercises, type ApiRoutine } from '../utils/workout/workoutLogging';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
const mockUser = { id: 'member-bw-local', role: 'student', coach_id: 'coach-fixture' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => false }));
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(), setParams: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockParams }),
}));
// Roman's readback line, from the real copy (copy.ts romanVoiceLog).
jest.mock('../components/roman/RomanVoiceLogReadback', () => {
  const { Text } = jest.requireActual('react-native');
  const { romanVoiceLog } = jest.requireActual('../lib/roman/copy');
  const ReactActual = jest.requireActual('react');
  return (props: Record<string, unknown>) => ReactActual.createElement(Text, { testID: 'roman-line' }, romanVoiceLog(props));
});
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
const mockLoadSession = jest.fn();
const mockSaveSession = jest.fn();
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: (...a: unknown[]) => mockLoadSession(...a),
  saveActiveWorkoutSession: (...a: unknown[]) => mockSaveSession(...a),
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
// The phone's own exercise list (src/db/workoutDb.ts seed rows, ex_ ids).
const LIST = [
  { id: 'ex_pushups', name: 'Push-Ups', muscle: 'chest', equipment: 'bodyweight', instructions: '' },
  { id: 'ex_pullups', name: 'Pull-Ups', muscle: 'back', equipment: 'bodyweight', instructions: '' },
  { id: 'ex_squat', name: 'Barbell Squat', muscle: 'legs', equipment: 'barbell', instructions: '' },
];
const mockGetAllExercises = jest.fn();
jest.mock('../db/workoutDb', () => ({ getAllExercises: (...a: unknown[]) => mockGetAllExercises(...a) }));
const mockCreate = jest.fn();
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({
    isPending: false,
    mutate: async (payload: unknown, options: { onSuccess: (value: unknown) => void }) =>
      options.onSuccess(await mockCreate(payload)),
  }),
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: jest.fn(async () => ({})) },
}));
const mockQueue = jest.fn();
jest.mock('../offline', () => ({
  queueWorkout: (...a: unknown[]) => mockQueue(...a),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(),
  triggerSync: jest.fn(async () => undefined),
}));
const LIBRARY_UUID = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';
const RESOLVING_UUID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
let mockHistory: unknown[] = [];
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a) },
  workoutApi: { getAll: jest.fn(async () => ({ data: mockHistory })) },
}));
// The catalog at its api edge (GET /exercises/:id, backend 647c671f): seed:
// ids answer locally; anything else goes upstream, which answers a phone-made
// id 404 and a library uuid 500.
function catalog(url: string) {
  const id = decodeURIComponent(url.replace(/^\/exercises\//, ''));
  if (id === 'seed:pull-001') return Promise.resolve({ data: { id, name: 'pull up', equipment: 'body weight' } });
  if (id === 'seed:legs-001') return Promise.resolve({ data: { id, name: 'back squat', equipment: 'barbell' } });
  if (id === 'seed:chest-009') return Promise.resolve({ data: { id, name: 'push-ups', equipment: 'barbell' } });
  if (id === RESOLVING_UUID) return Promise.resolve({ data: { id, name: 'push-ups', equipment: 'barbell' } });
  if (id === LIBRARY_UUID) return Promise.reject({ response: { status: 500, data: { message: 'Internal server error' } } });
  return Promise.reject({ response: { status: 404, data: { message: 'Exercise not found' } } });
}

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockGet.mockImplementation(catalog);
  mockGetAllExercises.mockImplementation(async () => LIST);
  mockLoadSession.mockResolvedValue(null);
  mockSaveSession.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue({ id: 'saved-bw-local' });
  mockQueue.mockResolvedValue({ id: 'queued-bw-local', alreadySynced: false });
  mockHistory = [];
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  await cleanup();
  qc.clear();
  jest.restoreAllMocks();
});

const mount = () => render(<QueryClientProvider client={qc}><ActiveWorkoutScreen /></QueryClientProvider>);

async function quickWorkout(...names: string[]) {
  mockParams = { routineName: 'Quick Workout', exercises: '[]' };
  const view = await mount();
  for (const name of names) {
    await act(async () => { fireEvent.press(view.getByText('Add exercise')); });
    await waitFor(() => expect(view.getByText(name)).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByText(name)); });
  }
  return view;
}

function savedRoutine(rows: ApiRoutine['exercises']) {
  const routine: ApiRoutine = { id: 'routine-7', name: 'My push day', exercises: rows };
  mockParams = { routineId: routine.id, routineName: routine.name, exercises: JSON.stringify(routineToSessionExercises(routine)) };
  return mount();
}

const routineRow = (name: string, catalogId: string | null) => ({
  exercise_name: name, muscle_group: 'chest', default_sets: 3, default_reps: 10, default_rest_seconds: 60, catalog_exercise_id: catalogId,
});

function coachWorkout(rows: Array<{ id: string; name: string; reps: number; weight: number | null }>) {
  const exercises = buildActiveWorkoutExercises({ exercises: rows.map((r, i) => ({
    exercise_external_id: r.id, order: i + 1, sets: 3, reps_or_duration_seconds: r.reps,
    weight_lbs: r.weight, rest_seconds: 0, superset_group_id: null, notes: null,
  })) as never }).map((exercise, i) => ({ ...exercise, exerciseName: rows[i].name }));
  mockParams = { routineName: 'Coach day', assignmentId: 'assigned-bw-local', exercises: JSON.stringify(exercises) };
  return mount();
}

async function finish(view: Awaited<ReturnType<typeof mount>>) {
  await act(async () => { fireEvent.press(view.getByLabelText('Finish workout')); });
  const confirm = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Finish workout?');
  expect(confirm).toBeTruthy();
  await act(async () => {
    await confirm[2].find((button: { text: string }) => button.text === 'Finish').onPress();
  });
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
}

describe('BW-LOCAL-M: red at 3287119c', () => {
  it('1. Quick workout, Add Push-Ups from the phone list: "BW × 10", spoken "body weight", set 1 reads BW with "×"', async () => {
    const view = await quickWorkout('Push-Ups');
    await waitFor(() => expect(view.getAllByText('BW × 10').length).toBe(2));
    expect(view.getByLabelText('Set 2, body weight, 10 reps. Change the numbers')).toBeTruthy();
    expect(view.getByLabelText('Set 3, body weight, 10 reps. Change the numbers')).toBeTruthy();
    expect(view.queryByText('0 lb × 10')).toBeNull();
    expect(view.getByTestId('set-weight-0-0').props.placeholder).toBe('BW');
    expect(view.getByLabelText('Set 1 weight, body weight')).toBeTruthy();
    const row = within(view.getByTestId('set-row-0-0'));
    expect(row.getByText('×')).toBeTruthy();
    expect(row.queryByText('lb ×')).toBeNull();
  });

  it('2. a coach workout, Swap the squat for Pull-Ups: the swapped-in rows read BW, the logged squat set keeps its own reading', async () => {
    const view = await coachWorkout([{ id: 'seed:legs-001', name: 'Back Squat', reps: 5, weight: null }]);
    await waitFor(() => expect(view.getByTestId('set-done-0-0')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); });
    await act(async () => { fireEvent.press(view.getByLabelText('Swap Back Squat')); });
    const swap = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Swap remaining sets?');
    await act(async () => { swap[2].find((b: { text: string }) => b.text === 'Choose replacement').onPress(); });
    await waitFor(() => expect(view.getByText('Pull-Ups')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByText('Pull-Ups')); });
    await waitFor(() => expect(view.getByLabelText('Set 2, body weight, 5 reps. Change the numbers')).toBeTruthy());
    expect(view.getAllByText('BW × 5')).toHaveLength(1);
    expect(view.getByTestId('set-weight-1-0').props.placeholder).toBe('BW');
    // The logged squat set is the squat's own: weighted, never BW.
    expect(view.queryByLabelText('Set 1, body weight, 5 reps. Change the numbers')).toBeNull();
    expect(view.getByLabelText(/^Set 1, 0 pounds, 5 reps/)).toBeTruthy();
  });

  it('3. a saved routine whose Push-Ups row has a library uuid the catalog does not answer: BW', async () => {
    const view = await savedRoutine([routineRow('Push-Ups', LIBRARY_UUID)]);
    await waitFor(() => expect(view.getAllByText('BW × 10').length).toBeGreaterThan(0));
    expect(view.getByLabelText('Set 2, body weight, 10 reps. Change the numbers')).toBeTruthy();
    expect(view.queryByText('0 lb × 10')).toBeNull();
  });

  it('4. a saved routine row with no catalog id (routine:<id>/push-ups): BW', async () => {
    const view = await savedRoutine([routineRow('Push-Ups', null)]);
    await waitFor(() => expect(view.getAllByText('BW × 10').length).toBeGreaterThan(0));
    expect(view.getByLabelText('Set 3, body weight, 10 reps. Change the numbers')).toBeTruthy();
    expect(view.queryByText('0 lb × 10')).toBeNull();
  });

  it('5. Roman reads a ticked Push-Ups set back as "Body weight, 10 reps."', async () => {
    const view = await quickWorkout('Push-Ups');
    await waitFor(() => expect(view.getByTestId('set-done-0-0')).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); });
    await waitFor(() => expect(view.getByTestId('roman-line').props.children).toBe('Body weight, 10 reps.'));
  });

  it('6a. the same session reopened from the saved session (resume): BW', async () => {
    const sessionExercises = [{
      exerciseId: 'ex_pushups', exerciseName: 'Push-Ups', muscleGroup: 'chest', restSec: 60,
      sets: [{ weight: 0, reps: 10, completed: false }, { weight: 0, reps: 10, completed: false }, { weight: 0, reps: 10, completed: false }],
    }];
    mockLoadSession.mockResolvedValue({ isStale: false, session: {
      version: 1, startedAtMs: Date.now() - 60000, updatedAtMs: Date.now(), routineName: 'Quick Workout', exercisesJson: '[]',
      idempotencyKey: 'idem-bw-local', sessionExercises, workoutNotes: '',
    } });
    mockParams = { routineName: 'Quick Workout', exercises: '[]', resume: true };
    const view = await mount();
    await waitFor(() => expect(view.getAllByText('BW × 10').length).toBe(2));
    expect(view.queryByText('0 lb × 10')).toBeNull();
  });

  it('6b. an ex_ id no longer in the list after a re-seed is matched by its name: BW', async () => {
    const sessionExercises = [{
      exerciseId: 'ex_before_reseed', exerciseName: 'Push-Ups', muscleGroup: 'chest', restSec: 60,
      sets: [{ weight: 0, reps: 10, completed: false }, { weight: 0, reps: 10, completed: false }, { weight: 0, reps: 10, completed: false }],
    }];
    mockLoadSession.mockResolvedValue({ isStale: false, session: {
      version: 1, startedAtMs: Date.now() - 60000, updatedAtMs: Date.now(), routineName: 'Quick Workout', exercisesJson: '[]',
      idempotencyKey: 'idem-bw-local', sessionExercises, workoutNotes: '',
    } });
    mockParams = { routineName: 'Quick Workout', exercises: '[]', resume: true };
    const view = await mount();
    await waitFor(() => expect(view.getAllByText('BW × 10').length).toBe(2));
  });
});

describe('BW-LOCAL-M: green at both', () => {
  it('7. a free-workout Barbell Squat (list "barbell") at 0 keeps "0 lb × 10"', async () => {
    const view = await quickWorkout('Barbell Squat');
    await waitFor(() => expect(view.getAllByText('0 lb × 10').length).toBe(2));
    expect(view.queryByText('BW × 10')).toBeNull();
    expect(view.getByTestId('set-weight-0-0').props.placeholder).toBe('0');
    expect(within(view.getByTestId('set-row-0-0')).getByText('lb ×')).toBeTruthy();
  });

  it('8a. Push-Ups with 20 typed in reads "20 lb × 10"', async () => {
    const view = await quickWorkout('Push-Ups');
    await act(async () => { fireEvent.changeText(view.getByTestId('set-weight-0-0'), '20'); });
    await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); });
    await waitFor(() => expect(view.getByText('20 lb × 10')).toBeTruthy());
    expect(view.getByLabelText('Set 1, 20 pounds, 10 reps. Change the numbers')).toBeTruthy();
  });

  it('8b. Push-Ups whose last time was 20 lb × 8 read as a catalog body-weight exercise does in that state', async () => {
    mockHistory = [{ id: 'previous-push-ups', exercises: [{
      exercise_name: 'Push-Ups', muscle_group: 'chest', sets_completed: 3, weight_per_set: [20, 20, 20], reps_per_set: [8, 8, 8],
    }] }];
    const read = (view: Awaited<ReturnType<typeof mount>>) => ({
      set1Placeholder: view.getByTestId('set-weight-0-0').props.placeholder,
      set2: view.getByTestId('set-value-0-1').props.accessibilityLabel,
      set3: view.getByTestId('set-value-0-2').props.accessibilityLabel,
      previous: view.queryAllByLabelText(/^Use previous set/).map((n) => n.props.accessibilityLabel),
    });
    const catalogView = await coachWorkout([{ id: 'seed:pull-001', name: 'Push-Ups', reps: 10, weight: null }]);
    await waitFor(() => expect(catalogView.getByTestId('set-value-0-1')).toBeTruthy());
    await waitFor(() => expect(qc.getQueryData(['exercises', 'by-id', 'seed:pull-001'])).toBeTruthy());
    const fromCatalog = read(catalogView);
    await cleanup();
    const listView = await quickWorkout('Push-Ups');
    await waitFor(() => expect(mockGetAllExercises).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(read(listView)).toEqual(fromCatalog);
    expect(fromCatalog.set2).toBe('Set 2, 20 pounds, 10 reps. Change the numbers');
  });

  it('9. a coach seed: id the catalog answers "barbell" stays as main, whatever the list says about its name; the list is not read', async () => {
    const view = await coachWorkout([{ id: 'seed:chest-009', name: 'Push-Ups', reps: 10, weight: null }]);
    await waitFor(() => expect(qc.getQueryData(['exercises', 'by-id', 'seed:chest-009'])).toBeTruthy());
    await waitFor(() => expect(view.getByTestId('set-value-0-1')).toBeTruthy());
    expect(view.getAllByText('0 lb × 10').length).toBe(2);
    expect(view.queryByText('BW × 10')).toBeNull();
    expect(mockGetAllExercises).not.toHaveBeenCalled();
  });

  it('9b. a saved-routine library uuid the catalog does answer ("barbell") is a catalog answer and wins over the list', async () => {
    const view = await savedRoutine([routineRow('Push-Ups', RESOLVING_UUID)]);
    await waitFor(() => expect(qc.getQueryData(['exercises', 'by-id', RESOLVING_UUID])).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    expect(view.getAllByText('0 lb × 10').length).toBe(2);
    expect(view.queryByText('BW × 10')).toBeNull();
  });

  it('10a. the list empty: a saved routine Push-Ups row reads as main, no alert', async () => {
    mockGetAllExercises.mockImplementation(async () => []);
    const view = await savedRoutine([routineRow('Push-Ups', null)]);
    await waitFor(() => expect(view.getAllByText('0 lb × 10').length).toBe(2));
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByText('BW × 10')).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('10b. the list read throwing: rows read as main, no new alert; Add exercise keeps its own error', async () => {
    mockGetAllExercises.mockImplementation(async () => { throw new Error('sqlite closed'); });
    const view = await savedRoutine([routineRow('Push-Ups', null)]);
    await waitFor(() => expect(view.getAllByText('0 lb × 10').length).toBe(2));
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByText('BW × 10')).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(view.getByText('Add exercise')); });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
    expect((Alert.alert as jest.Mock).mock.calls[0].slice(0, 2)).toEqual([
      'Exercise list unavailable', 'The exercise list did not load. Keep this workout open and try Add exercise again.',
    ]);
  });

  it('11. a saved routine row whose name is not in the list keeps "0 lb × 10"', async () => {
    const view = await savedRoutine([routineRow('Kettlebell Halo', null)]);
    await waitFor(() => expect(view.getAllByText('0 lb × 10').length).toBe(2));
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByText('BW × 10')).toBeNull();
  });

  it('12. what case 1 sends and keeps is main\'s: POST /workouts body, the queued workout and the saved session (a 0 saves 0)', async () => {
    const view = await quickWorkout('Push-Ups');
    await waitFor(() => expect(view.getByTestId('set-value-0-1')).toBeTruthy());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); });
    await waitFor(() => expect(mockSaveSession).toHaveBeenCalled());
    const saved = mockSaveSession.mock.calls[mockSaveSession.mock.calls.length - 1];
    expect(saved[1].sessionExercises).toStrictEqual([{
      exerciseId: 'ex_pushups', exerciseName: 'Push-Ups', muscleGroup: 'chest', restSec: 60,
      sets: [{ weight: 0, reps: 10, completed: true, doneOrder: 1 }, { weight: 0, reps: 10, completed: false }, { weight: 0, reps: 10, completed: false }],
    }]);
    await finish(view);
    const sent = [{
      exercise_name: 'Push-Ups', muscle_group: 'chest', sets_completed: 1, reps_per_set: [10], weight_per_set: [0], notes: '',
    }];
    expect(mockCreate.mock.calls[0][0].exercises).toStrictEqual(sent);
    expect(JSON.stringify(mockCreate.mock.calls[0][0].exercises)).toBe(
      '[{"exercise_name":"Push-Ups","muscle_group":"chest","sets_completed":1,"weight_per_set":[0],"reps_per_set":[10],"notes":""}]');
    expect(JSON.stringify(mockQueue.mock.calls[0][0].payload)).toBe(JSON.stringify(mockCreate.mock.calls[0][0]));
  });
});
