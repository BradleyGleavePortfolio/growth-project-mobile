/** Real assignment adapter, live SetLogger and outgoing save payload. */
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

it.each([
  { scenario: 'a positive coach load', target: 15, typeZero: false, expected: 15 },
  { scenario: 'an unprescribed previous-set default', target: null, typeZero: false, expected: 20 },
  { scenario: 'a client explicitly entering zero', target: null, typeZero: true, expected: 0 },
  { scenario: 'a coach-prescribed zero load', target: 0, typeZero: false, expected: 0 },
])('B-LS-WORKOUT-5 keeps $scenario in the saved set', async ({ target, typeZero, expected }) => {
  const exercises = buildActiveWorkoutExercises({ exercises: [{
    exercise_external_id: 'seed:pull-001', order: 0, sets: 1,
    reps_or_duration_seconds: 8, weight_lbs: target, rest_seconds: 0,
    superset_group_id: null, notes: null,
  }] }).map((exercise) => ({
    ...exercise,
    // The real detail/Train entry resolves this exact catalog name before Start.
    exerciseName: 'Pull Up',
  }));
  mockParams = { ...mockParams, exercises: JSON.stringify(exercises) };
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByLabelText('Use previous set 1: 20 pounds, 8 reps')).toBeTruthy());
  if (typeZero) {
    await fireEvent.changeText(view.getByTestId('set-weight-0-0'), '0');
  }
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  await fireEvent.press(view.getByLabelText('Finish workout'));
  const finish = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Finish workout?');
  expect(finish).toBeTruthy();
  await act(async () => {
    await finish[2].find((button: { text: string }) => button.text === 'Finish').onPress();
  });
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate.mock.calls[0][0].exercises[0]).toMatchObject({
    exercise_name: 'Pull Up', sets_completed: 1, reps_per_set: [8], weight_per_set: [expected],
  });
});
