import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { buildActiveWorkoutExercises } from '../utils/workout/buildActiveWorkout';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'member', role: 'student', coach_id: 'coach' }),
}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
let mockParams = { routineName: 'Assigned sets', assignmentId: 'assignment', exercises: '[]' };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: mockParams }),
}));
// Keep the real readback component and copy; only replace its asset renderer.
jest.mock('../components/roman/RomanAvatar', () => () => null);
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
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: () => ({ isPending: false, mutate: jest.fn() }),
}));
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: jest.fn(async () => ({})) },
}));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(), settleQueuedWorkout: jest.fn(),
  releaseQueuedWorkout: jest.fn(), triggerSync: jest.fn(),
}));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => ({
      data: {
        id: decodeURIComponent(url.replace(/^\/exercises\//, '')),
        name: 'exercise',
        equipment: url.includes('core') ? 'body weight' : 'barbell',
      },
    })),
  },
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

function start(unit: 'reps' | 'seconds', count: number, weight: number) {
  const exercises = buildActiveWorkoutExercises({
    exercises: [{
      exercise_external_id: unit === 'seconds' ? 'seed:core-001' : 'seed:legs-001',
      order: 1, sets: 1, reps_or_duration_seconds: count, unit,
      weight_lbs: weight, rest_seconds: 0, superset_group_id: null, notes: null,
    }],
  } as never).map((exercise) => ({ ...exercise, exerciseName: 'Exercise' }));
  mockParams = { ...mockParams, exercises: JSON.stringify(exercises) };
  return render(<QueryClientProvider client={client}><ActiveWorkoutScreen /></QueryClientProvider>);
}

it('retains the ordinary weighted-rep readback with the Roman flag on', async () => {
  const view = await start('reps', 5, 135);
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  await waitFor(() => expect(view.getByText('135 pounds, 5 reps.')).toBeTruthy());
});

it('does not read a known 60-second timed set back as 60 reps', async () => {
  const view = await start('seconds', 60, 0);
  await waitFor(() => expect(view.getByLabelText('Set 1 seconds')).toBeTruthy());
  await fireEvent.press(view.getByTestId('set-done-0-0'));
  await waitFor(() => expect(view.getByTestId('roman-voicelog-card')).toBeTruthy());
  expect(view.queryByText('0 pounds, 60 reps.')).toBeNull();
  expect(view.getByText(/60 seconds/)).toBeTruthy();
});
