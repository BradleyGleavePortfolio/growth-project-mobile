/**
 * WK-1-M R1 (LO-WORKOUT B1, class-first): every workout save the phone makes
 * and the key it sends. One key per intended save, made once at Finish: the
 * Finish POST and every queued retry carry the same Idempotency-Key. Uses the
 * real screen, queue and retry code (harness of lsWorkoutAssignmentRetry187);
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
  routineName: 'Bench',
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
    useCreateWorkout: (saveKey?: () => string) => {
      const [isPending, setPending] = ReactLib.useState(false);
      return {
        isPending,
        mutate: async (payload: unknown, options: { onSuccess: (v: unknown) => void; onError: (e: unknown) => void }) => {
          setPending(true);
          try { options.onSuccess(await mockCreate(payload, saveKey?.())); }
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

import { renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ActiveWorkoutScreen from '../screens/client/ActiveWorkoutScreen';
import { pushQueuedWorkouts } from '../offline/sync/sync-engine';
import { createWorkoutOnce, workoutSaveKeyConfig } from '../offline/sync/workoutSaveKey';

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = [];
  mockPost.mockResolvedValue({ data: { id: 'saved-log' } });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

async function finish(view: Awaited<ReturnType<typeof render>>) {
  await waitFor(() => expect(view.getByTestId('set-done-0-0')).toBeTruthy());
  await act(async () => { fireEvent.press(view.getByTestId('set-done-0-0')); });
  fireEvent.press(view.getByLabelText('Finish workout'));
  const finishAlert = (Alert.alert as jest.Mock).mock.calls.find((args) => args[0] === 'Finish workout?');
  await act(async () => {
    await finishAlert[2].find((button: { text: string }) => button.text === 'Finish').onPress();
  });
}

it('WK-1-M R1: useCreateWorkout sends the key the screen gives it, read when the save is sent', async () => {
  const { useCreateWorkout } = jest.requireActual('../hooks/useApi') as typeof import('../hooks/useApi');
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  let key = '';
  const { result } = await renderHook(() => useCreateWorkout(() => key), { wrapper });
  key = 'client-1:1761867000000';
  await act(async () => { await result.current.mutateAsync({ workout_name: 'Bench' }); });
  expect(mockPost).toHaveBeenCalledWith({ workout_name: 'Bench' }, { headers: { 'Idempotency-Key': 'client-1:1761867000000' } });
});

it('WK-1-M R1: the Finish save and the queued retry after a lost answer send the same Idempotency-Key', async () => {
  // The Finish POST reaches the server but its answer is lost.
  mockCreate.mockRejectedValue(Object.assign(new Error('Network Error'), { request: {} }));
  const view = await render(<ActiveWorkoutScreen />);
  await finish(view);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  expect(mockRows).toHaveLength(1);
  const key = mockRows[0].client_key;
  expect(key).toMatch(/^client-ls-workout:\d+$/);
  // The screen's own POST carried the queue key...
  expect(mockCreate.mock.calls[0][1]).toBe(key);
  // ...and the background retry of the queued row sends that same key.
  await act(async () => { await pushQueuedWorkouts(); });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(mockPost.mock.calls[0][1]).toEqual({ headers: { 'Idempotency-Key': key } });
  expect(mockPost.mock.calls[0][0]).toEqual(JSON.parse(mockRows[0].payload));
  await view.unmount();
});

// Every place the phone saves a workout and the key it sends. The screen and
// queue rows above prove the first two end to end; the legacy row is the
// same createWorkoutOnce call with the row's own id. An edit of a saved
// workout is PUT /workouts/:id, which replaces in place and needs no key.
describe.each([
  ['Finish save (ActiveWorkoutScreen -> useCreateWorkout)', 'client-1:1761867000000', true],
  ['queued retry (sync-engine pushQueuedRow, row.client_key)', 'local:1761867000000', true],
  ['legacy queued row (sync-engine pushPending, row id)', 'mgx2k1a9f3c2b1d0', true],
  ['no key', undefined, false],
  ['blank key', '   ', false],
  ['too short for the server rule', 'k:1', false],
  ['a character the server refuses (400 would park the workout)', 'client 1:1761867000000', false],
  ['longer than 128', 'k'.repeat(129), false],
])('%s', (_label, key, sent) => {
  it(sent ? 'sends Idempotency-Key' : 'sends no Idempotency-Key', async () => {
    await createWorkoutOnce({ workout_name: 'Bench' }, key as string | undefined);
    expect(workoutSaveKeyConfig(key as string | undefined)).toEqual(sent ? { headers: { 'Idempotency-Key': String(key).trim() } } : undefined);
    expect(mockPost.mock.calls[0]).toEqual(sent
      ? [{ workout_name: 'Bench' }, { headers: { 'Idempotency-Key': key } }]
      : [{ workout_name: 'Bench' }]);
  });
});
