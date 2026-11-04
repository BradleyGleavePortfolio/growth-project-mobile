/**
 * EXID-M (#189-D4 op 1): a saved routine keeps each exercise's library id
 * (catalog_exercise_id), so Watch video opens that exercise by id. Real
 * builder, real API adapter, real live workout and detail screens; only the
 * HTTP layer answers as the backend contract (EXID-BE) says.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const LIB_PRESS = '3f1c2b9e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const LIB_ROW = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const LIB_SQUAT = 'c0ffee00-1234-4abc-8def-001122334455';

const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
let mockParams: Record<string, unknown> = {};
let mockRoutines: unknown[] = [];
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate, goBack: mockBack, dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-fixture', role: 'student', coach_id: 'coach-fixture' }),
}));
jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, clientTrainV2: true },
}));
jest.mock('../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({ mutate: jest.fn() }),
  useRoutines: () => ({ data: mockRoutines }),
  useCreateRoutine: () => ({ mutate: mockCreate, isPending: false }),
  useUpdateRoutine: () => ({ mutate: mockUpdate, isPending: false }),
  useDeleteRoutine: () => ({ mutate: jest.fn() }),
}));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => null),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
// The builder's Add exercise list is the phone's own: ids are `ex_` + random.
jest.mock('../db/workoutDb', () => ({
  getAllExercises: jest.fn(async () => [
    { id: 'ex_k3j2a', name: 'Barbell Bench Press', muscle: 'chest', equipment: 'Barbell' },
    { id: 'ex_q9w8e', name: 'Back Squat', muscle: 'legs', equipment: 'Barbell' },
    { id: 'ex_z7x6c', name: 'Towel Curl', muscle: 'biceps', equipment: 'Towel' },
  ]),
}));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(), settleQueuedWorkout: jest.fn(), releaseQueuedWorkout: jest.fn(),
  triggerSync: jest.fn(async () => undefined),
}));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-video', () => ({
  useVideoPlayer: () => ({ addListener: () => ({ remove: jest.fn() }) }),
  VideoView: jest.requireActual('react-native').View,
}));
const mockGet = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
}));

import RoutineBuilderScreen from '../screens/client/RoutineBuilderScreen';
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import { routineToSessionExercises, type ApiRoutine } from '../utils/workout/workoutLogging';

const item = (id: string, slug: string, name: string, instruction: string) => ({
  id, slug, name, primaryMuscle: 'chest', category: 'strength', difficulty: '',
  secondaryMuscles: [], equipment: ['barbell'], instructions: [instruction],
  playbackUrl: null, gifUrl: null,
});
const LIBRARY = [
  item(LIB_PRESS, 'barbell-bench-press', 'Barbell Bench Press', 'Lower the bar to mid chest.'),
  item(LIB_ROW, 'seated-cable-row', 'Seated Cable Row', 'Pull to the belly.'),
  item(LIB_SQUAT, 'back-squat', 'Back Squat', 'Sit between the heels.'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockRoutines = [];
  // GET /exercise-catalog/:idOrSlug matches id or slug exactly; anything else 404s.
  mockGet.mockImplementation(async (path: string) => {
    const key = decodeURIComponent(path.replace(/^\/exercise-catalog\//, ''));
    const hit = path.startsWith('/exercise-catalog/') && LIBRARY.find((e) => e.id === key || e.slug === key);
    if (hit) return { data: hit };
    throw { response: { status: 404 } };
  });
});

async function addFromLibrary(view: Awaited<ReturnType<typeof render>>, name: string) {
  await act(async () => { fireEvent.press(view.getByLabelText('Add exercise')); });
  await waitFor(() => expect(view.getByLabelText(`Add ${name}`)).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByLabelText(`Add ${name}`)); });
}

// What the server stores and returns on GET /routines for a saved body.
function savedRoutine(id: string, body: { name: string; exercises: Array<Record<string, unknown>> }): ApiRoutine {
  return {
    id, name: body.name,
    exercises: body.exercises.map((e, i) => ({
      id: `row-${i}`,
      exercise_name: String(e.exercise_name),
      muscle_group: String(e.muscle_group),
      default_sets: Number(e.default_sets),
      default_reps: Number(e.default_reps),
      default_rest_seconds: Number(e.default_rest_seconds),
      catalog_exercise_id: (e.catalog_exercise_id as string | undefined) ?? null,
    })),
  };
}

it('EXID-M: an exercise added from the library, saved and loaded again, opens its Watch video and instructions by id after a rename', async () => {
  const builder = await render(<RoutineBuilderScreen />);
  await act(async () => { fireEvent.changeText(builder.getByLabelText('Routine name'), 'Push day'); });
  await addFromLibrary(builder, 'Barbell Bench Press');
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/exercise-catalog/barbell-bench-press'));
  await act(async () => { fireEvent.press(builder.getByLabelText('Save routine')); });
  expect(mockCreate).toHaveBeenCalledTimes(1);
  const body = mockCreate.mock.calls[0][0];
  expect(body.exercises).toEqual([expect.objectContaining({
    exercise_name: 'Barbell Bench Press', catalog_exercise_id: LIB_PRESS,
  })]);
  await builder.unmount();

  // Loaded again, with the exercise renamed on the routine since.
  const routine = savedRoutine('routine-fixture', body);
  routine.exercises[0].exercise_name = 'Bench (heavy)';
  mockParams = { routineName: routine.name, exercises: JSON.stringify(routineToSessionExercises(routine)) };
  const live = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(live.getByLabelText('Watch video for Bench (heavy)')).toBeTruthy());
  await act(async () => { fireEvent.press(live.getByLabelText('Watch video for Bench (heavy)')); });
  expect(mockNavigate).toHaveBeenCalledWith('ExerciseDetail', expect.objectContaining({ idOrSlug: LIB_PRESS }));
  const params = mockNavigate.mock.calls[0][1];
  await live.unmount();

  mockGet.mockClear();
  const detail = await render(<ExerciseDetailScreen {...{
    route: { key: 'detail', name: 'ExerciseDetail', params },
    navigation: {},
  } as unknown as React.ComponentProps<typeof ExerciseDetailScreen>} />);
  await waitFor(() => expect(detail.queryByTestId('exercise-detail-loading')).toBeNull());
  expect(mockGet).toHaveBeenCalledWith(`/exercise-catalog/${LIB_PRESS}`);
  expect(detail.getByText('Lower the bar to mid chest.')).toBeTruthy();
});

it('EXID-M: editing keeps each kept id, a replaced exercise takes the new one, one the library lacks sends none', async () => {
  mockRoutines = [{
    id: 'routine-fixture', name: 'Upper',
    exercises: [
      { id: 'row-0', exercise_name: 'Bench (heavy)', muscle_group: 'CHEST', default_sets: 3, default_reps: 8, default_rest_seconds: 90, catalog_exercise_id: LIB_PRESS },
      { id: 'row-1', exercise_name: 'Seated Cable Row', muscle_group: 'BACK', default_sets: 3, default_reps: 10, default_rest_seconds: 60, catalog_exercise_id: LIB_ROW },
      { id: 'row-2', exercise_name: 'Old curl', muscle_group: 'BICEPS', default_sets: 2, default_reps: 12, default_rest_seconds: 45 },
    ],
  }];
  mockParams = { routineId: 'routine-fixture' };
  const builder = await render(<RoutineBuilderScreen />);
  await waitFor(() => expect(builder.getByLabelText('Routine name').props.value).toBe('Upper'));
  await act(async () => { fireEvent.press(builder.getByLabelText('Remove Seated Cable Row, exercise 2')); });
  await addFromLibrary(builder, 'Back Squat');
  await addFromLibrary(builder, 'Towel Curl');
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/exercise-catalog/towel-curl'));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/exercise-catalog/back-squat'));
  await act(async () => { fireEvent.press(builder.getByLabelText('Save routine')); });
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  const sent = mockUpdate.mock.calls[0][0].data.exercises as Array<Record<string, unknown>>;
  expect(sent.map((e) => [e.exercise_name, e.catalog_exercise_id])).toEqual([
    ['Bench (heavy)', LIB_PRESS],
    ['Old curl', undefined],
    ['Back Squat', LIB_SQUAT],
    ['Towel Curl', undefined],
  ]);
  // No row ever sends the phone's own id, or the routine row's id, as a library id.
  for (const e of sent) expect(Object.keys(e)).not.toContain('exerciseId');
  expect(JSON.stringify(sent)).not.toMatch(/ex_|row-/);
});
