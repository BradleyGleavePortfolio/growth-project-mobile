/**
 * B-TEST LS-928R2-B1: the real live screen must not relabel or reuse a prior
 * count in a different unit after a coach changes Count by for an exercise.
 * Native/navigation/network boundaries are stubbed; history mapping, plan
 * mapping, ExerciseCard, SetLogger and workout payload construction are real.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'member-unit-change', role: 'student', coach_id: 'coach-fixture' }),
}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let mockParams = { routineName: 'Carry', assignmentId: 'assigned-carry', exercises: '[]' };
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
  queueWorkout: jest.fn(async () => ({ id: 'queued-unit-change', alreadySynced: false })),
  settleQueuedWorkout: jest.fn(async () => undefined),
  releaseQueuedWorkout: jest.fn(), triggerSync: jest.fn(async () => undefined),
}));
let mockHistory: unknown[] = [];
const mockGetHistory = jest.fn(async (..._args: unknown[]) => ({ data: mockHistory }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async () => ({
      data: { id: 'seed:carry-001', name: 'farmer carry', equipment: 'dumbbell' },
    })),
  },
  workoutApi: { getAll: (...args: unknown[]) => mockGetHistory(...args) },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockCreate.mockResolvedValue({ id: 'saved-unit-change' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  await cleanup();
  qc.clear();
  jest.restoreAllMocks();
});

function start(current: 'seconds' | 'reps', prior: 'seconds' | 'reps' | null) {
  mockHistory = [{
    id: 'previous-carry',
    exercises: [{
      exercise_name: 'Farmer Carry', muscle_group: 'full_body', sets_completed: 1,
      weight_per_set: [25], reps_per_set: [prior === 'seconds' ? 45 : 10],
      ...(prior ? { asked_unit: prior } : {}),
    }],
  }];
  const exercises = buildActiveWorkoutExercises({
    exercises: [{
      exercise_external_id: 'seed:carry-001', order: 1, sets: 1,
      reps_or_duration_seconds: current === 'seconds' ? 60 : 8, unit: current,
      weight_lbs: 25, rest_seconds: 0, superset_group_id: null, notes: null,
    }],
  } as never).map((exercise) => ({ ...exercise, exerciseName: 'Farmer Carry' }));
  mockParams = { ...mockParams, exercises: JSON.stringify(exercises) };
  return render(<QueryClientProvider client={qc}><ActiveWorkoutScreen /></QueryClientProvider>);
}

it.each([
  ['seconds', 'reps', 'Use previous set 1: 25 pounds, 10 seconds'],
  ['reps', 'seconds', 'Use previous set 1: 25 pounds, 45 reps'],
] as const)('current %s must not reinterpret previous %s', async (current, prior, wrongLabel) => {
  const view = await start(current, prior);
  await waitFor(() => expect(mockGetHistory).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  expect(view.queryByLabelText(wrongLabel)).toBeNull();
});

it('a prior rep count cannot be copied into and saved as today’s seconds', async () => {
  const view = await start('seconds', 'reps');
  await waitFor(() => expect(mockGetHistory).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  const wrongPrevious = view.queryByLabelText('Use previous set 1: 25 pounds, 10 seconds');
  if (wrongPrevious) await fireEvent.press(wrongPrevious);
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  await fireEvent.press(view.getByLabelText('Finish workout'));
  const finish = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Finish workout?');
  expect(finish).toBeTruthy();
  await act(async () => {
    await finish[2].find((button: { text: string }) => button.text === 'Finish').onPress();
  });
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate.mock.calls[0][0].exercises[0].reps_per_set).toEqual([60]);
});

it.each([
  ['seconds', 'seconds', 'Use previous set 1: 25 pounds, 45 seconds'],
  ['reps', 'reps', 'Use previous set 1: 25 pounds, 10 reps'],
  ['reps', null, 'Use previous set 1: 25 pounds, 10 reps'],
] as const)('compatible %s / %s keeps Previous', async (current, prior, label) => {
  const view = await start(current, prior);
  await waitFor(() => expect(view.getByLabelText(label)).toBeTruthy());
});
