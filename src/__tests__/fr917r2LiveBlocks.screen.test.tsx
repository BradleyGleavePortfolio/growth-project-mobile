/** FR-917R2 B4 (LS-917R2 B4, owner #190-E8): the live workout in the C1 v2 look
 * (MOCKUP3/C1/style-c-v2/C2_logger): lettered blocks that fold when done, the
 * sage card for the exercise in progress, one-tap "As planned" on each set.
 * Harness copied from lsWorkoutZeroPrescription188.screen.test.tsx. */
import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
const mockUser = { id: 'member-zero-load', role: 'student', coach_id: 'coach-fixture' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let mockParams = { routineName: 'Assigned pull ups', assignmentId: 'assigned-pull-ups', exercises: '[]' };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => null),
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
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(async () => ({ id: 'queued-zero-load', alreadySynced: false })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(),
  triggerSync: jest.fn(async () => undefined),
}));
const mockHistory = [{
  id: 'previous-weighted-pull-up',
  exercises: [{
    exercise_name: 'Pull Up', muscle_group: 'back', sets_completed: 1,
    weight_per_set: [20], reps_per_set: [8],
  }],
}];
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: [] })) },
  workoutApi: { getAll: jest.fn(async () => ({ data: mockHistory })) },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'saved-zero-load' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

const plan = (sets: number, weight: number | null, reps = 8) => ({
  exercise_external_id: 'seed:x', order: 0, sets, reps_or_duration_seconds: reps, weight_lbs: weight,
  rest_seconds: 0, superset_group_id: null, notes: null,
});
async function start(rows: Array<[name: string, sets: number, weight: number | null]>) {
  const exercises = rows.flatMap(([name, sets, weight]) =>
    buildActiveWorkoutExercises({ exercises: [plan(sets, weight)] }).map((e) => ({ ...e, exerciseName: name })));
  mockParams = { ...mockParams, exercises: JSON.stringify(exercises) };
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByLabelText('Use previous set 1: 20 pounds, 8 reps')).toBeTruthy());
  return view;
}
async function finishPayload(view: Awaited<ReturnType<typeof start>>) {
  await fireEvent.press(view.getByLabelText('Finish workout'));
  const finish = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Finish workout?');
  await act(async () => {
    await finish[2].find((button: { text: string }) => button.text === 'Finish').onPress();
  });
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  return mockCreate.mock.calls[0][0].exercises;
}

it('each set still to do has "As planned"; one tap saves the planned numbers', async () => {
  const view = await start([['Pull Up', 3, 15]]);
  expect(view.getAllByText('As planned')).toHaveLength(3);
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  expect(view.getAllByText('As planned')).toHaveLength(2);
  expect(view.getByTestId('set-done-0-0').props.accessibilityState).toMatchObject({ checked: true });
  const saved = await finishPayload(view);
  expect(saved[0]).toMatchObject({ sets_completed: 1, reps_per_set: [8], weight_per_set: [15] });
});

it('the exercise in progress is the open sage block; a done block folds and opens again', async () => {
  const view = await start([['Pull Up', 1, 15], ['Bench press', 2, 95]]);
  expect(view.getByTestId('exercise-active-0')).toBeTruthy();
  expect(view.queryByTestId('exercise-folded-0')).toBeNull();
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  // A is done; it stays open (its numbers and Add set at hand) while its set is the last one ticked.
  expect(view.queryByTestId('exercise-folded-0')).toBeNull();
  expect(view.getByTestId('set-row-0-0')).toBeTruthy();
  expect(view.getByTestId('exercise-active-1')).toBeTruthy();
  await fireEvent.press(view.getByTestId('set-done-1-0'));
  // A set in B is ticked: A folds (its sets are hidden), B is still in progress.
  expect(view.getByTestId('exercise-folded-0')).toBeTruthy();
  expect(view.getByText('A · Pull Up')).toBeTruthy();
  expect(view.queryByTestId('set-row-0-0')).toBeNull();
  expect(view.getByTestId('exercise-active-1')).toBeTruthy();
  await fireEvent.press(view.getByTestId('exercise-folded-0'));
  expect(view.getByTestId('set-row-0-0')).toBeTruthy();
});

it('control: when every block is done nothing folds, so the last sets stay on screen', async () => {
  const view = await start([['Pull Up', 1, 15]]);
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  expect(view.queryByTestId('exercise-folded-0')).toBeNull();
  expect(view.getByTestId('set-row-0-0')).toBeTruthy();
  expect(view.queryAllByText('As planned')).toHaveLength(0);
});
