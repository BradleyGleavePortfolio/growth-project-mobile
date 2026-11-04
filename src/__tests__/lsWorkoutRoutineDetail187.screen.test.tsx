/**
 * B-LS-WORKOUT-2: follow the actual saved-routine -> live-workout -> detail
 * action, keeping the real API adapter and both real screens.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockRoutine = {
  id: 'routine-fixture', name: 'My push routine',
  exercises: [{
    id: 'routine-exercise-fixture', exercise_name: 'Barbell Bench Press',
    muscle_group: 'chest', default_sets: 3, default_reps: 8,
    default_rest_seconds: 60,
  }],
};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate, goBack: jest.fn(), dispatch: jest.fn(),
    addListener: () => () => undefined,
  }),
  useRoute: () => ({ params: {
    routineName: mockRoutine.name,
    exercises: JSON.stringify(jest.requireActual('../utils/workout/workoutLogging').routineToSessionExercises(mockRoutine)),
  } }),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-fixture', role: 'student', coach_id: 'coach-fixture' }),
}));
jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, clientTrainV2: true },
}));
jest.mock('../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../hooks/useApi', () => ({ useCreateWorkout: () => ({ mutate: jest.fn() }) }));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => null),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
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

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import { exerciseCatalogApi } from '../api/exerciseCatalog';

const seed = {
  id: 'seed:push-001', name: 'Barbell Bench Press', bodyPart: 'chest',
  target: 'pectorals', equipment: 'barbell', secondaryMuscles: ['triceps'],
  instructions: ['Lower under control.'], gifUrl: '', video_url: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  // Reflect the backend contracts: catalog matches exact id/slug/source_ref,
  // the seed library matches seed:push-001; neither accepts a routine row id.
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/exercises/seed%3Apush-001') return { data: seed };
    if (path.startsWith('/exercises/search?')) {
      return { data: { items: [seed], total: 1, nextCursor: null } };
    }
    if (path === '/exercise-catalog/barbell-bench-press') {
      return { data: {
        id: seed.id, slug: 'barbell-bench-press', name: seed.name,
        primaryMuscle: 'pectorals', category: 'strength', difficulty: '',
        secondaryMuscles: seed.secondaryMuscles, equipment: ['barbell'],
        instructions: seed.instructions, playbackUrl: null, gifUrl: null,
      } };
    }
    throw { response: { status: 404 } };
  });
});

it('B-LS-WORKOUT-2 opens the existing exercise instructions from a saved routine video action', async () => {
  // Control: the same exercise is available through the existing real adapter.
  expect((await exerciseCatalogApi.getDetail(seed.id)).data.instructions)
    .toEqual(['Lower under control.']);
  const live = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(live.getByLabelText('Watch video for Barbell Bench Press')).toBeTruthy());
  await act(async () => { fireEvent.press(live.getByLabelText('Watch video for Barbell Bench Press')); });
  expect(mockNavigate).toHaveBeenCalledTimes(1);
  const [screen, params] = mockNavigate.mock.calls[0];
  expect(screen).toBe('ExerciseDetail');
  await live.unmount();
  const detail = await render(<ExerciseDetailScreen {...{
    route: { key: 'detail', name: 'ExerciseDetail', params },
    navigation: {},
  } as unknown as React.ComponentProps<typeof ExerciseDetailScreen>} />);
  await waitFor(() => expect(detail.queryByTestId('exercise-detail-loading')).toBeNull());
  expect(detail.getByText('Lower under control.')).toBeTruthy();
});
