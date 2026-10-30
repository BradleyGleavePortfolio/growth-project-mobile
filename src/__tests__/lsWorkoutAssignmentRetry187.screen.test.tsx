/**
 * B-LS-WORKOUT-1: saving the log must not discard an unacknowledged
 * coach-assignment completion. Uses the real screen, queue and retry code;
 * only native storage, transport and navigation are replaced.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../config/featureFlags', () => ({
  featureFlags: { romanChat: true, romanP3Lock: true, shareSheetV2: true },
}));
const mockUser = { id: 'client-ls-workout', role: 'student', coach_id: 'coach-fixture' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
const mockNavigate = jest.fn();
const mockParams = {
  routineName: 'Assigned bench',
  assignmentId: 'assignment-ls-workout',
  exercises: JSON.stringify([{
    exerciseId: 'seed:push-001', exerciseName: 'Barbell Bench Press',
    sets: 1, reps: 8, weightLbs: 80, restSec: 0,
  }]),
};
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate, goBack: jest.fn(), dispatch: jest.fn(),
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
jest.mock('../hooks/useApi', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useCreateWorkout: () => {
      const [isPending, setPending] = ReactLib.useState(false);
      return {
        isPending,
        mutate: async (payload: unknown, options: { onSuccess: (v: unknown) => void; onError: (e: unknown) => void }) => {
          setPending(true);
          try { options.onSuccess(await mockCreate(payload)); }
          catch (error) { options.onError(error); }
          finally { setPending(false); }
        },
      };
    },
  };
});
const mockComplete = jest.fn();
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: { completeMyAssignment: (...args: unknown[]) => mockComplete(...args) },
}));
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockPost(...args), get: jest.fn(async () => ({ data: [] })) },
  workoutApi: {
    getAll: jest.fn(async () => ({ data: [] })),
    create: (...args: unknown[]) => mockPost(...args),
  },
}));
jest.mock('../lib/userCache', () => ({
  readUserCacheSync: jest.fn(() => mockUser),
  readUserCache: jest.fn(async () => mockUser),
}));

type Row = {
  id: string; user_id: string; payload: string; client_key: string;
  assignment_json: string | null; sync_status: string; server_id: string | null;
};
let mockRows: Row[] = [];
const mockDb = {
  runAsync: jest.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes('INSERT INTO workout_logs')) {
      mockRows.push({
        id: String(args[0]), user_id: String(args[4]), payload: String(args[5]),
        client_key: String(args[6]), assignment_json: args[7] as string | null,
        sync_status: 'pending', server_id: null,
      });
      return { changes: 1 };
    }
    if (sql.includes('assignment_json = NULL')) {
      const row = sql.includes('WHERE client_key')
        ? mockRows.find((r) => r.client_key === args[1])
        : mockRows.find((r) => r.id === args[0]);
      if (row) Object.assign(row, {
        ...(sql.includes('WHERE client_key') ? { server_id: args[0], sync_status: 'synced' } : {}),
        assignment_json: null,
      });
      return { changes: row ? 1 : 0 };
    }
    if (sql.includes("SET sync_status = 'synced'")) {
      const row = mockRows.find((r) => r.id === args[1]);
      if (row) Object.assign(row, { server_id: args[0], sync_status: 'synced' });
      return { changes: row ? 1 : 0 };
    }
    throw new Error(`Unmodelled SQL in fixture: ${sql}`);
  }),
  getAllAsync: jest.fn(async (sql: string, args: unknown[]) => mockRows.filter((r) =>
    r.user_id === args[0] && (sql.includes('assignment_json IS NOT NULL')
      ? r.sync_status === 'synced' && r.assignment_json !== null
      : r.sync_status === 'pending'))),
  getFirstAsync: jest.fn(async (_sql: string, args: unknown[]) =>
    mockRows.find((r) => r.client_key === args[0]) ?? null),
};
jest.mock('../offline/database', () => ({
  getDatabase: jest.fn(async () => mockDb),
  getDatabaseIfInitialised: jest.fn(async () => mockDb),
}));
jest.mock('../offline', () => ({
  ...jest.requireActual('../offline/sync/sync-engine'),
  triggerSync: jest.fn(async () => undefined),
}));

import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import { pushQueuedWorkouts } from '../offline/sync/sync-engine';

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [];
  mockCreate.mockResolvedValue({ id: 'saved-log' });
  mockPost.mockResolvedValue({ data: { id: 'saved-log' } });
  mockComplete.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValue({});
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it('B-LS-WORKOUT-1 retries assignment completion after its first ordinary network failure, without reposting the saved workout', async () => {
  const view = await render(<ActiveWorkoutScreen />);
  await waitFor(() => expect(view.getByTestId('set-done-0-0')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); });
  fireEvent.press(view.getByLabelText('Finish workout'));
  const finishAlert = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Finish workout?');
  expect(finishAlert).toBeTruthy();
  await act(async () => {
    await finishAlert[2].find((button: { text: string }) => button.text === 'Finish').onPress();
  });
  await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockRows).toHaveLength(1);
  expect(JSON.parse(mockRows[0].payload).exercises[0]).toMatchObject({
    exercise_name: 'Barbell Bench Press', sets_completed: 1, weight_per_set: [80], reps_per_set: [8],
  });
  await act(async () => { await pushQueuedWorkouts(); });
  expect(mockPost).not.toHaveBeenCalled();
  expect(mockComplete).toHaveBeenCalledTimes(2);
});
