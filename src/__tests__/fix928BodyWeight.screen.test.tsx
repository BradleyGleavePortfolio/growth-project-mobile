/**
 * FIX-928-BW (agent 197, owner #197-E10): the real live workout reads a
 * body-weight exercise's set rows as BW. The screen learns body-weight from
 * the catalog read GET /exercises/:id (equipment "body weight"), the same read
 * that names the exercise; a weighted exercise at 0 keeps "0 lb".
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
  id: 'previous-pull-up',
  exercises: [{
    exercise_name: 'Pull Up', muscle_group: 'back', sets_completed: 1,
    weight_per_set: [20], reps_per_set: [8],
  }],
}];
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      const id = decodeURIComponent(url.replace(/^\/exercises\//, ''));
      if (id === 'seed:pull-001') return { data: { id, name: 'pull up', equipment: 'body weight' } };
      if (id === 'seed:core-001') return { data: { id, name: 'plank', equipment: 'body weight' } };
      if (id === 'seed:legs-001') return { data: { id, name: 'back squat', equipment: 'barbell' } };
      return { data: [] };
    }),
  },
  workoutApi: { getAll: jest.fn(async () => ({ data: mockHistory })) },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  mockCreate.mockResolvedValue({ id: 'saved-bw' });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

function start(rows: Array<{ id: string; name: string; reps: number; weight: number | null; unit?: 'reps' | 'seconds' }>) {
  const exercises = buildActiveWorkoutExercises({ exercises: rows.map((r, i) => ({
    exercise_external_id: r.id, order: i + 1, sets: 3, reps_or_duration_seconds: r.reps,
    ...(r.unit ? { unit: r.unit } : {}), weight_lbs: r.weight, rest_seconds: 0, superset_group_id: null, notes: null,
  })) as never }).map((exercise, i) => ({ ...exercise, exerciseName: rows[i].name }));
  mockParams = { ...mockParams, exercises: JSON.stringify(exercises) };
  return render(<QueryClientProvider client={qc}><ActiveWorkoutScreen /></QueryClientProvider>);
}

it('a body-weight rep exercise reads "BW × 8" and speaks "body weight"', async () => {
  const view = await start([{ id: 'seed:pull-001', name: 'Pull Up', reps: 8, weight: 0 }]);
  await waitFor(() => expect(view.getAllByText('BW × 8').length).toBeGreaterThan(0));
  expect(view.getByLabelText('Set 2, body weight, 8 reps. Change the numbers')).toBeTruthy();
  expect(view.queryByText('0 lb × 8')).toBeNull();
});

it('a body-weight timed exercise reads "BW × 60 sec"; a weighted exercise at 0 keeps "0 lb"', async () => {
  const view = await start([
    { id: 'seed:core-001', name: 'Plank', reps: 60, weight: 0, unit: 'seconds' },
    { id: 'seed:legs-001', name: 'Back Squat', reps: 5, weight: 0 },
  ]);
  await waitFor(() => expect(view.getAllByText('BW × 60 sec').length).toBeGreaterThan(0));
  expect(view.getByLabelText('Set 2, body weight, 60 seconds. Change the numbers')).toBeTruthy();
  expect(view.queryByText('0 lb × 60 sec')).toBeNull();
  // The squat block waits as one plan line until tapped: a weighted 0 stays "0 lb".
  expect(view.getByText('3 × 5 · 0 lb')).toBeTruthy();
});

it('a coach\'s body-weight 0 is still saved as 0', async () => {
  const view = await start([{ id: 'seed:pull-001', name: 'Pull Up', reps: 8, weight: 0 }]);
  await waitFor(() => expect(view.getAllByText('BW × 8').length).toBeGreaterThan(0));
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  await fireEvent.press(view.getByLabelText('Finish workout'));
  const finish = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Finish workout?');
  expect(finish).toBeTruthy();
  await act(async () => {
    await finish[2].find((button: { text: string }) => button.text === 'Finish').onPress();
  });
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockCreate.mock.calls[0][0].exercises[0]).toMatchObject({ exercise_name: 'Pull Up', sets_completed: 1, weight_per_set: [0] });
});
