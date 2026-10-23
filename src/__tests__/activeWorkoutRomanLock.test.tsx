// ROMAN-LOCK-REST (owner 139-15: "coachless clients have no access to roman at all"): the live
// workout reads the last ticked set back in Roman's voice beside his face. A client with no coach
// logs the same workout without that line; a coached client keeps it.
import React from 'react';
import { AppState } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import type { CurrentUser } from '../hooks/useCurrentUser';

jest.mock('../config/featureFlags', () => ({ featureFlags: { coachBrief: true, romanChat: true } }));
let mockUser: CurrentUser;
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../lib/userCache', () => ({ ...jest.requireActual('../lib/userCache'), readUserCacheSync: () => null }));
const mockNavigation = {
  navigate: jest.fn(), goBack: jest.fn(), setParams: jest.fn(), dispatch: jest.fn(),
  addListener: jest.fn(() => () => undefined),
};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
  useRoute: () => ({ params: { routineName: 'Upper Body A', exercises: '[]', resume: true } }),
}));
jest.mock('../hooks/useApi', () => ({ useCreateWorkout: () => ({ mutate: jest.fn() }) }));
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async () => ({
    isStale: false,
    session: {
      version: 1, startedAtMs: Date.now() - 20 * 60_000, updatedAtMs: Date.now(), routineName: 'Upper Body A',
      exercisesJson: '[]', idempotencyKey: '0b6f2a3e-4b1c-4d2e-9f00-1a2b3c4d5e6f',
      sessionExercises: [{ exerciseId: 'ex-1', exerciseName: 'Bench Press', restSec: 90, sets: [{ weight: 95, reps: 8, completed: true }] }],
    },
  })),
  saveActiveWorkoutSession: jest.fn(async () => undefined),
  clearActiveWorkoutSession: jest.fn(async () => undefined),
}));
jest.mock('../services/api', () => ({ workoutApi: { getAll: jest.fn(async () => ({ data: [] })) } }));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
jest.mock('../api/workoutBuilderApi', () => ({ workoutBuilderApi: { completeMyAssignment: jest.fn(async () => undefined) } }));
jest.mock('../offline', () => ({
  queueWorkout: jest.fn(), settleQueuedWorkout: jest.fn(), releaseQueuedWorkout: jest.fn(), triggerSync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestPermissionsAsync: jest.fn(), scheduleNotificationAsync: jest.fn(), cancelScheduledNotificationAsync: jest.fn(),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2, MIN: 1 },
  setNotificationHandler: jest.fn(), setNotificationChannelAsync: jest.fn(async () => undefined),
}));
jest.mock('../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: () => jest.fn() }),
}));
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';

const STUDENT: CurrentUser = { id: 'c1', email: 'c1@example.test', role: 'student' };

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: () => undefined }));
});
afterEach(() => jest.restoreAllMocks());

async function open() {
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByText('Bench Press')).toBeTruthy());
  return view;
}

describe('live workout: Roman\'s set readback (139-15)', () => {
  it('a client with no coach logs the set with no Roman readback', async () => {
    mockUser = STUDENT;
    const view = await open();
    expect(view.getByText('1 of 1 sets completed')).toBeTruthy();
    expect(view.queryByTestId('roman-voicelog-card')).toBeNull();
  });

  it('a coached client keeps the readback', async () => {
    mockUser = { ...STUDENT, coach_id: 'coach-1' };
    const view = await open();
    expect(view.getByTestId('roman-voicelog-card')).toBeTruthy();
  });
});
