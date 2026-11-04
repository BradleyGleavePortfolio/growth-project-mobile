/**
 * Fresh floor re-audit: a saved routine's Watch video path must not wait
 * for the exercise library browse or the local picker to finish loading.
 * Real library/live/detail screens and both adapters; transport, navigation,
 * session storage and native video are fixtures, not a native-device test.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const PRESS = '3f1c2b9e-8d4a-4c1b-9e2f-0a1b2c3d4e5f';
const ROW = '7a6b5c4d-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const mockNavigate = jest.fn();
const mockGet = jest.fn();
const mockLocalRead = jest.fn(() => new Promise(() => undefined));
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate, goBack: jest.fn(), dispatch: jest.fn(),
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
}));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => null),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../db/workoutDb', () => ({
  getAllExercises: () => mockLocalRead(),
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
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
  workoutApi: { getAll: jest.fn(async () => ({ data: [] })) },
}));

import ExerciseLibraryScreen from '../screens/client/ExerciseLibraryScreen';
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import ExerciseDetailScreen from '../screens/client/ExerciseDetailScreen';
import { routineToSessionExercises, type ApiRoutine } from '../utils/workout/workoutLogging';

type Reply = {
  url: string;
  resolve: (value: unknown) => void;
  reject: (value: unknown) => void;
};
let browse: Reply;
let browseSettled = false;
const replies: Reply[] = [];
const response = (key: string) => ({
  data: {
    id: key, slug: 'fixture-exercise', name: 'Library exercise',
    primaryMuscle: 'chest', category: 'strength', difficulty: '',
    secondaryMuscles: [], equipment: ['barbell'],
    instructions: [`Guidance for ${key}`], playbackUrl: null, gifUrl: null,
  },
});
beforeEach(() => {
  jest.clearAllMocks();
  replies.length = 0;
  browseSettled = false;
  mockParams = {};
  mockGet.mockImplementation((url: string) => new Promise((resolve, reject) => {
    if (url === '/exercises/search') {
      browse = {
        url,
        resolve: (value) => { browseSettled = true; resolve(value); },
        reject: (value) => { browseSettled = true; reject(value); },
      };
    } else if (url.startsWith('/exercise-catalog/')) {
      replies.push({ url, resolve, reject });
    } else {
      reject(new Error(`Unexpected fixture request: ${url}`));
    }
  }));
});
const catalogCalls = () => mockGet.mock.calls
  .map((call) => String(call[0])).filter((url) => url.startsWith('/exercise-catalog/'));
async function finishBrowse() {
  await act(async () => {
    browse.resolve({ data: { items: [], total: 0, nextCursor: null } });
  });
}

async function coldWatch(which: 'saved UUID' | 'second saved UUID' | 'legacy name') {
  const library = await render(<ExerciseLibraryScreen {...{
    navigation: { navigate: mockNavigate },
    route: { key: 'library', name: 'ExerciseLibrary' },
  } as unknown as React.ComponentProps<typeof ExerciseLibraryScreen>} />);
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/exercises/search'));
  expect(browseSettled).toBe(false);
  expect(library.getByTestId('exercise-library-list').props.data).toEqual([]);

  const row = (name: string, id?: string) => ({
    id: `row-${name}`, exercise_name: name, muscle_group: 'CHEST',
    default_sets: 3, default_reps: 8, default_rest_seconds: 60,
    ...(id ? { catalog_exercise_id: id } : {}),
  });
  const routine: ApiRoutine = {
    id: 'saved-routine', name: 'Upper',
    exercises: which === 'legacy name'
      ? [row('Barbell Bench Press')]
      : [row('Bench renamed', PRESS), row('Row renamed', ROW)],
  };
  const name = which === 'legacy name' ? 'Barbell Bench Press'
    : which === 'second saved UUID' ? 'Row renamed' : 'Bench renamed';
  const key = which === 'legacy name' ? 'barbell-bench-press'
    : which === 'second saved UUID' ? ROW : PRESS;
  mockParams = { routineName: routine.name, exercises: JSON.stringify(routineToSessionExercises(routine)) };
  const live = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(live.getByLabelText(`Watch video for ${name}`)).toBeTruthy());
  await fireEvent.press(live.getByLabelText(`Watch video for ${name}`));
  expect(mockNavigate).toHaveBeenCalledWith('ExerciseDetail', { idOrSlug: key });
  expect(mockLocalRead).not.toHaveBeenCalled();
  expect(browseSettled).toBe(false);
  await live.unmount();

  const detail = await render(<ExerciseDetailScreen {...{
    route: { key: 'detail', name: 'ExerciseDetail', params: mockNavigate.mock.calls[0][1] },
    navigation: {},
  } as unknown as React.ComponentProps<typeof ExerciseDetailScreen>} />);
  await waitFor(() => expect(replies).toHaveLength(1));
  expect(replies[0].url).toBe(`/exercise-catalog/${key}`);
  expect(detail.getByTestId('exercise-detail-loading')).toBeTruthy();
  expect(browseSettled).toBe(false);
  return { library, detail, key };
}

it.each(['saved UUID', 'second saved UUID', 'legacy name'] as const)(
  '%s opens the right detail before the library loads, and a late list cannot change it',
  async (which) => {
    const { detail, key } = await coldWatch(which);
    await act(async () => { replies[0].resolve(response(key)); });
    expect(detail.getByText(`Guidance for ${key}`)).toBeTruthy();
    expect(browseSettled).toBe(false);
    expect(mockLocalRead).not.toHaveBeenCalled();
    await finishBrowse();
    expect(detail.getByText(`Guidance for ${key}`)).toBeTruthy();
    expect(catalogCalls()).toEqual([`/exercise-catalog/${key}`]);
  },
);

it('a saved UUID 404 shows exact W3 without Retry or seed fallback while the library is still loading', async () => {
  const { detail, key } = await coldWatch('saved UUID');
  await act(async () => { replies[0].reject({ response: { status: 404 } }); });
  expect(detail.getByText('No details for this exercise yet.')).toBeTruthy();
  expect(detail.queryByRole('button', { name: 'Retry' })).toBeNull();
  expect(browseSettled).toBe(false);
  expect(mockGet.mock.calls.map((call) => String(call[0]))).toEqual([
    '/exercises/search', `/exercise-catalog/${key}`,
  ]);
  await finishBrowse();
  expect(detail.getByText('No details for this exercise yet.')).toBeTruthy();
});

it.each(['503', 'network'] as const)('%s can retry the same UUID without waiting for library load', async (failure) => {
  const { detail, key } = await coldWatch('saved UUID');
  await act(async () => {
    replies[0].reject(failure === '503' ? { response: { status: 503 } } : { message: 'Network Error' });
  });
  expect(detail.getByRole('button', { name: 'Retry' })).toBeTruthy();
  expect(browseSettled).toBe(false);
  await fireEvent.press(detail.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(replies).toHaveLength(2));
  expect(replies[1].url).toBe(`/exercise-catalog/${key}`);
  await act(async () => { replies[1].resolve(response(key)); });
  expect(detail.getByText(`Guidance for ${key}`)).toBeTruthy();
  expect(browseSettled).toBe(false);
  expect(catalogCalls()).toEqual([`/exercise-catalog/${key}`, `/exercise-catalog/${key}`]);
  await finishBrowse();
});

it('a concurrent library-load failure does not cancel or replace the saved UUID detail', async () => {
  const { library, detail, key } = await coldWatch('saved UUID');
  await act(async () => { browse.reject({ message: 'Network Error' }); });
  expect(library.getByText('Exercises did not load. Check your connection and try again.')).toBeTruthy();
  expect(detail.getByTestId('exercise-detail-loading')).toBeTruthy();
  await act(async () => { replies[0].resolve(response(key)); });
  expect(detail.getByText(`Guidance for ${key}`)).toBeTruthy();
  expect(catalogCalls()).toEqual([`/exercise-catalog/${key}`]);
  expect(mockLocalRead).not.toHaveBeenCalled();
});
