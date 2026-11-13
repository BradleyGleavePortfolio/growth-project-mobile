/**
 * WORKOUT-SUMMARY-M (C1 Style C v2, frame C5): the workout summary of a coach-set workout, with featureFlags.clientTrainV2
 * on. The real screen, the real offline queue and the real sync engine; only native storage, transport, navigation and
 * the haptics are faked (as lsWorkoutAssignmentRetry187.screen.test.tsx does). The fake server keeps one workout per
 * Idempotency-Key and one completion per assignment, as the backend does (workout-builder.service.ts:852-955).
 * Cases S1 to S4, S6 to S10, S12 and S15 of the job text.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFlags = { romanChat: false, shareSheetV2: false, clientTrainV2: true };
jest.mock('../config/featureFlags', () => ({ get featureFlags() { return mockFlags; } }));
const mockUser = { id: 'client-c5', role: 'student', coach_id: 'coach-sam' };
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
let mockCoachless = false;
jest.mock('../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => mockCoachless }));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
const mockHaptic = { success: jest.fn(), error: jest.fn(), selection: jest.fn(), softImpact: jest.fn(), lightImpact: jest.fn(), mediumImpact: jest.fn(), heavyImpact: jest.fn(), warning: jest.fn() };
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: new Proxy({}, { get: (_t, k: string) => (mockHaptic as Record<string, jest.Mock>)[k] ?? jest.fn() }) }));
const mockNav = { goBack: jest.fn(), dispatch: jest.fn(), navigate: jest.fn(), setParams: jest.fn() };
const mockListeners: Record<string, (e: unknown) => void> = {};
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({
      ...mockNav,
      addListener: (name: string, cb: (e: unknown) => void) => { mockListeners[name] = cb; return () => undefined; },
    }),
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void | (() => void)) => ReactLib.useEffect(() => cb(), [cb]),
  };
});
jest.mock('../components/roman/RomanVoiceLogReadback', () => () => null);
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
const mockStore = new Map<string, unknown>();
jest.mock('../storage/activeWorkoutSession', () => ({
  loadActiveWorkoutSession: jest.fn(async (id: string) => (mockStore.has(id) ? { session: mockStore.get(id), isStale: false } : null)),
  saveActiveWorkoutSession: jest.fn(async (id: string, s: Record<string, unknown>) => { mockStore.set(id, { version: 1, updatedAtMs: Date.now(), ...s }); }),
  clearActiveWorkoutSession: jest.fn(async (id: string) => { mockStore.delete(id); }),
}));
jest.mock('../components/tutorial/TutorialTarget', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../components/HapticPressable', () => ({ __esModule: true, default: jest.requireActual('react-native').Pressable }));
jest.mock('../components/share/ShareSheet', () => ({ __esModule: true, default: () => null, ShareLink: () => null }));
jest.mock('../db/workoutDb', () => ({ getAllExercises: jest.fn(async () => []) }));
jest.mock('../hooks/useBodyWeightExercises', () => ({ useBodyWeightExercises: () => ({}) }));

// ── Fake server ───────────────────────────────────────────────────────────────
const mockServer = { workouts: [] as Array<Record<string, unknown>>, keys: new Map<string, string>(), completions: [] as Array<{ id: string; input: Record<string, unknown> }> };
let mockSaveAnswer: 'ok' | 'lost' | 'offline' | 'refused' | 'hold' = 'ok';
let mockRelease: (() => void) | null = null;
const mockCreate = jest.fn(async (body: Record<string, unknown>, key?: string | null) => {
  if (mockSaveAnswer === 'offline') throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
  if (mockSaveAnswer === 'refused') throw Object.assign(new Error('HTTP 400'), { response: { status: 400, data: { message: 'Bad workout' } } });
  if (mockSaveAnswer === 'hold') await new Promise<void>((resolve) => { mockRelease = resolve; });
  let id = key ? mockServer.keys.get(key) : undefined;
  if (!id) {
    id = `srv-${mockServer.workouts.length + 1}`;
    mockServer.workouts.push({ id, ...body });
    if (key) mockServer.keys.set(key, id);
  }
  if (mockSaveAnswer === 'lost') { mockSaveAnswer = 'ok'; throw Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }); }
  return { id };
});
jest.mock('../hooks/useApi', () => ({
  useCreateWorkout: (saveKey?: () => string) => ({
    isPending: false,
    mutate: async (payload: Record<string, unknown>, options: { onSuccess: (v: unknown) => void; onError: (e: unknown) => void }) => {
      try { options.onSuccess(await mockCreate(payload, saveKey?.())); } catch (error) { options.onError(error); }
    },
  }),
}));
let mockCompleteAnswer: 'ok' | 'conflict' = 'ok';
const mockComplete = jest.fn(async (id: string, input: Record<string, unknown>) => {
  if (mockCompleteAnswer === 'conflict') throw Object.assign(new Error('HTTP 409'), { response: { status: 409 } });
  if (!mockServer.completions.some((c) => c.id === id)) mockServer.completions.push({ id, input });
  return { data: {} };
});
let mockWeekFails = false;
const mockAssignments = jest.fn();
jest.mock('../api/workoutBuilderApi', () => ({
  workoutBuilderApi: {
    completeMyAssignment: (id: string, input: Record<string, unknown>) => mockComplete(id, input),
    listMyAssignments: () => mockAssignments(),
  },
}));
const mockHistory = jest.fn(async () => ({ data: [] as unknown[] }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => (String(url).includes('/scheduling/my-coaches')
      ? { data: [{ coach_id: 'coach-sam', name: 'Sam Rivers' }] }
      : { data: [] })),
    post: jest.fn(async () => ({ data: {} })),
  },
  workoutApi: {
    getAll: () => mockHistory(),
    create: (body: Record<string, unknown>, config?: { headers?: Record<string, string> }) =>
      mockCreate(body, config?.headers?.['Idempotency-Key']).then((data) => ({ data })),
  },
}));
jest.mock('../lib/userCache', () => ({ readUserCacheSync: jest.fn(() => mockUser), readUserCache: jest.fn(async () => mockUser) }));
jest.mock('../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn(async () => undefined) } }));
jest.mock('../services/sentry', () => ({ captureError: jest.fn(), captureErrorWithoutPii: jest.fn() }));

// ── Fake phone database (the queue's one table) ───────────────────────────────
type Row = { id: string; user_id: string; payload: string; client_key: string; assignment_json: string | null; sync_status: string; server_id: string | null };
const mockRows: Row[] = [];
const mockDb = {
  runAsync: jest.fn(async (raw: string, args: unknown[]) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('INSERT INTO workout_logs')) {
      mockRows.push({ id: String(args[0]), user_id: String(args[4]), payload: String(args[5]), client_key: String(args[6]),
        assignment_json: args[7] as string | null, sync_status: 'pending', server_id: null });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE workout_logs SET payload = ?, assignment_json = ?, sync_status = 'pending'")) {
      const r = mockRows.find((x) => x.id === args[4]);
      if (r) Object.assign(r, { payload: args[0], assignment_json: args[1], sync_status: 'pending' });
      return { changes: r ? 1 : 0 };
    }
    if (sql === "UPDATE workout_logs SET sync_status = 'synced', server_id = ? WHERE id = ?") {
      const r = mockRows.find((x) => x.id === args[1]);
      if (r) Object.assign(r, { sync_status: 'synced', server_id: args[0] });
      return { changes: r ? 1 : 0 };
    }
    if (sql === 'UPDATE workout_logs SET assignment_json = NULL WHERE id = ?') {
      const r = mockRows.find((x) => x.id === args[0]);
      if (r) r.assignment_json = null;
      return { changes: r ? 1 : 0 };
    }
    if (sql === "UPDATE workout_logs SET sync_status = 'dead_letter' WHERE client_key = ? AND sync_status = 'pending'") {
      const r = mockRows.find((x) => x.client_key === args[0] && x.sync_status === 'pending');
      if (r) r.sync_status = 'dead_letter';
      return { changes: r ? 1 : 0 };
    }
    if (/^UPDATE workout_logs SET sync_status = '(dead_letter|conflict)' WHERE id = \?$/.test(sql)) {
      const r = mockRows.find((x) => x.id === args[0]);
      if (r) r.sync_status = /dead_letter/.test(sql) ? 'dead_letter' : 'conflict';
      return { changes: r ? 1 : 0 };
    }
    if (sql === 'UPDATE workout_logs SET server_id = ? WHERE id = ?') {
      const r = mockRows.find((x) => x.id === args[1]);
      if (r) r.server_id = String(args[0]);
      return { changes: r ? 1 : 0 };
    }
    throw new Error(`Unmodelled SQL in fixture: ${sql}`);
  }),
  getAllAsync: jest.fn(async (raw: string, args: unknown[]) => {
    const sql = raw.replace(/\s+/g, ' ');
    if (sql.includes('PRAGMA')) return [];
    return mockRows.filter((r) => r.user_id === args[0] && (sql.includes('assignment_json IS NOT NULL')
      ? r.sync_status === 'synced' && r.assignment_json !== null
      : r.sync_status === 'pending')).map((r) => ({ ...r }));
  }),
  getFirstAsync: jest.fn(async (raw: string, args: unknown[]) => {
    if (/COUNT/.test(raw)) return { n: mockRows.filter((r) => r.sync_status === 'pending').length };
    const r = mockRows.find((x) => x.client_key === args[0]);
    return r ? { ...r } : null;
  }),
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
import { getTodayString } from '../utils/date';

// ── Fixtures (fictional) ──────────────────────────────────────────────────────
const ASSIGNMENT = 'asg-today';
const START = Date.UTC(2026, 10, 11, 17, 0, 0);
const done = (weight: number, reps: number, order: number) => ({ weight, reps, completed: true, doneOrder: order });
const stored = (assignmentId?: string) => ({
  version: 1, startedAtMs: START, updatedAtMs: Date.now(), pausedMs: 0, routineName: 'Upper body A', exercisesJson: '[]',
  assignmentId, idempotencyKey: assignmentId ? '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f' : '', workoutNotes: '',
  sessionExercises: [
    { exerciseId: 'ex-bench', exerciseName: 'Bench press', muscleGroup: 'chest', restSec: 0, sets: [done(155, 6, 1), done(155, 6, 2)] },
  ],
});
const today = getTodayString();
const plusDays = (n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
const weekRow = (id: string, day: string, completed: boolean) => ({
  id, workout_plan_id: 'plan-1', client_id: mockUser.id, assigned_by_coach_id: 'coach-sam', scheduled_for: `${day}T12:00:00.000Z`,
  completed_at: completed ? `${day}T18:00:00.000Z` : null, post_rpe: null, post_notes: null,
  workout_plan: { id: 'plan-1', coach_id: 'coach-sam', name: 'Upper body A', type: 'strength', duration_estimate_minutes: 45, created_at: '', updated_at: '', archived_at: null, exercises: [] },
});
const weekRows = (todayDone = false) => {
  const monday = -((new Date(`${today}T12:00:00.000Z`).getUTCDay() + 6) % 7);
  const others = [weekRow('asg-mon', plusDays(monday), true), weekRow('asg-sun', plusDays(monday + 6), false)]
    .filter((r) => r.scheduled_for.slice(0, 10) !== today);
  return [...others, weekRow(ASSIGNMENT, today, todayDone)];
};

async function openScreen(assignment: string | null = ASSIGNMENT) {
  const assignmentId = assignment ?? undefined;
  mockParams = { routineName: 'Upper body A', exercises: '[]', resume: true, ...(assignmentId ? { assignmentId } : {}) };
  mockStore.set(mockUser.id, stored(assignmentId));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = await render(<QueryClientProvider client={client}><ActiveWorkoutScreen /></QueryClientProvider>);
  await waitFor(() => expect(view.getByText('Finish workout')).toBeTruthy());
  return Object.assign(view, { client });
}
async function openSummary(view: Awaited<ReturnType<typeof openScreen>>) {
  await act(async () => { fireEvent.press(view.getByTestId('finish-workout')); });
  await waitFor(() => expect(view.getByTestId('workout-summary-c5')).toBeTruthy());
  // The coach's name comes from its own read (useMyCoaches): wait for it, so no case races it.
  await waitFor(() => expect(view.getByText('Send to Sam')).toBeTruthy());
}
async function press(view: Awaited<ReturnType<typeof openScreen>>, testID: string) {
  await act(async () => { fireEvent.press(view.getByTestId(testID)); });
}
// The completion as the queue stored it (the engine clears it once the server answers).
const queuedInput = () => {
  const writes = mockDb.runAsync.mock.calls.filter(([sql]) => /INSERT INTO workout_logs|SET payload = \?, assignment_json = \?/.test(String(sql)));
  const [sql, args] = writes[writes.length - 1] ?? [];
  const json = sql == null ? null : /INSERT/.test(String(sql)) ? (args as unknown[])[7] : (args as unknown[])[1];
  return JSON.parse(String(json ?? 'null'))?.input as Record<string, unknown> | undefined;
};
const alertTitles = () => (Alert.alert as jest.Mock).mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.length = 0;
  mockStore.clear();
  mockServer.workouts = []; mockServer.keys = new Map(); mockServer.completions = [];
  mockSaveAnswer = 'ok'; mockCompleteAnswer = 'ok'; mockWeekFails = false; mockRelease = null;
  mockFlags.clientTrainV2 = true; mockFlags.romanChat = false; mockCoachless = false;
  mockAssignments.mockImplementation(async () => { if (mockWeekFails) throw new Error('Network Error'); return weekRows(); });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('S1: Finish workout opens the summary and saves nothing', () => {
  it('no POST, no queue row, no completion; the saved session stays; back returns to the logger as it was', async () => {
    const view = await openScreen();
    await openSummary(view);
    expect(alertTitles()).not.toContain('Finish workout?');
    expect(view.getByText('Workout complete.')).toBeTruthy();
    expect(view.getByText('Send to Sam')).toBeTruthy();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRows).toHaveLength(0);
    expect(mockComplete).not.toHaveBeenCalled();
    // A fresh load still finds the workout.
    expect(mockStore.get(mockUser.id)).toBeTruthy();
    // Android back (beforeRemove) returns to the logger, every set as it was.
    const preventDefault = jest.fn();
    await act(async () => { mockListeners.beforeRemove({ preventDefault, data: { action: { type: 'GO_BACK' } } }); });
    expect(preventDefault).toHaveBeenCalled();
    expect(view.queryByTestId('workout-summary-c5')).toBeNull();
    expect(view.getByTestId('finish-workout')).toBeTruthy();
    expect(mockNav.goBack).not.toHaveBeenCalled();
    expect(alertTitles()).not.toContain('Log this workout?');
    // The masthead back control does the same.
    await openSummary(view);
    await press(view, 'summary-back');
    expect(view.queryByTestId('workout-summary-c5')).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockStore.get(mockUser.id)).toMatchObject({ sessionExercises: [{ sets: [{ weight: 155, reps: 6, completed: true }, { weight: 155, reps: 6, completed: true }] }] });
  });

  it('"Finish and log" on the leave question opens the summary, with no save before Send', async () => {
    const view = await openScreen();
    await act(async () => { mockListeners.beforeRemove({ preventDefault: jest.fn(), data: { action: { type: 'GO_BACK' } } }); });
    const ask = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Log this workout?');
    expect(ask).toBeTruthy();
    await act(async () => { ask[2].find((b: { text: string }) => b.text === 'Finish and log').onPress(); });
    await waitFor(() => expect(view.getByTestId('workout-summary-c5')).toBeTruthy());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRows).toHaveLength(0);
  });
});

describe('S2 and S3: Send carries the rating and note in the one completion', () => {
  it('S2: 8 and a note ride the queued completion and the one PATCH; the workout body is main\'s byte for byte', async () => {
    // Main's body, from the switch-off finish of the same session.
    mockFlags.clientTrainV2 = false;
    const off = await openScreen();
    await act(async () => { fireEvent.press(off.getByTestId('finish-workout')); });
    const finish = (Alert.alert as jest.Mock).mock.calls.find((c) => c[0] === 'Finish workout?');
    await act(async () => { await finish[2].find((b: { text: string }) => b.text === 'Finish').onPress(); });
    const mainBody = JSON.stringify(mockCreate.mock.calls[0][0]);
    await off.unmount();
    jest.clearAllMocks();
    mockRows.length = 0; mockServer.workouts = []; mockServer.keys = new Map(); mockServer.completions = [];
    (Alert.alert as jest.Mock).mockClear();

    mockFlags.clientTrainV2 = true;
    const view = await openScreen();
    await openSummary(view);
    await press(view, 'effort-8');
    await act(async () => { fireEvent.changeText(view.getByTestId('coach-note'), '  Squats felt strong.  '); });
    await press(view, 'send-to-coach');
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));

    expect(mockRows).toHaveLength(1);
    expect(queuedInput()).toEqual(expect.objectContaining({
      post_rpe: 8, post_notes: 'Squats felt strong.', completion_payload: expect.any(Object),
      idempotency_key: '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f', started_at: new Date(START).toISOString(),
    }));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockCreate.mock.calls[0][0])).toBe(mainBody);
    expect(mockComplete).toHaveBeenCalledWith(ASSIGNMENT, expect.objectContaining({ post_rpe: 8, post_notes: 'Squats felt strong.' }));
    expect(mockServer.completions).toHaveLength(1);
    expect(mockHaptic.success).toHaveBeenCalledTimes(1);
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
  });

  it('S3: no number and a blank note send neither key (the server stores null), never 0 or ""', async () => {
    const view = await openScreen();
    await openSummary(view);
    await act(async () => { fireEvent.changeText(view.getByTestId('coach-note'), '   '); });
    await press(view, 'send-to-coach');
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    const sent = mockComplete.mock.calls[0][1];
    expect(sent).not.toHaveProperty('post_rpe');
    expect(sent).not.toHaveProperty('post_notes');
    expect(sent).toHaveProperty('completion_payload');
  });
});

describe('S4 and S15: the effort scale and the note box', () => {
  it('a radio group named "How hard, 1 to 10", ten radios 1 to 10, each at least 44 pt, the chosen one announced', async () => {
    const view = await openScreen();
    await openSummary(view);
    const group = view.getByTestId('effort-meter');
    expect(group.props.accessibilityRole).toBe('radiogroup');
    expect(group.props.accessibilityLabel).toBe('How hard, 1 to 10');
    const radios = view.getAllByRole('radio');
    expect(radios.map((r) => r.props.accessibilityLabel)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    for (const n of [1, 10]) {
      const flat = [view.getByTestId(`effort-${n}`).props.style].flat(Infinity).filter(Boolean)
        .reduce((a: Record<string, unknown>, s: Record<string, unknown>) => ({ ...a, ...s }), {});
      expect(Number(flat.minHeight)).toBeGreaterThanOrEqual(44);
      expect(Number(flat.minWidth ?? 44)).toBeGreaterThanOrEqual(44);
    }
    await press(view, 'effort-8');
    expect(view.getByTestId('effort-8').props.accessibilityState).toMatchObject({ checked: true });
    expect(view.getByTestId('effort-7').props.accessibilityState).toMatchObject({ checked: false });
    const note = view.getByTestId('coach-note');
    expect(note.props.maxLength).toBe(1000);
    expect(note.props.accessibilityLabel).toBe('Note for Sam');
    // The ring keeps its text label.
    expect(view.getByTestId('summary-ring').props.accessibilityLabel).toMatch(/^\d+ of \d+ done$/);
  });
});

describe('S6: the server refuses the workout', () => {
  it('main\'s "Workout not saved yet" words, back on the logger; the not-sent card never shows; no completion', async () => {
    mockSaveAnswer = 'refused';
    const view = await openScreen();
    await openSummary(view);
    await press(view, 'effort-8');
    await press(view, 'send-to-coach');
    await waitFor(() => expect(alertTitles()).toContain('Workout not saved yet'));
    expect(view.queryByText('Not sent to Sam yet')).toBeNull();
    expect(view.queryByTestId('workout-summary-c5')).toBeNull();
    expect(view.getByTestId('finish-workout')).toBeTruthy();
    expect(mockComplete).not.toHaveBeenCalled();
    expect(mockNav.goBack).not.toHaveBeenCalled();
  });
});

describe('S7: one row, one workout, one completion', () => {
  it('Send tapped twice fast saves once', async () => {
    const view = await openScreen();
    await openSummary(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('send-to-coach'));
      fireEvent.press(view.getByTestId('send-to-coach'));
    });
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockRows).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('no answer: the not-sent card; a number tap does nothing; Try again sends the stored 8 under the same key, once', async () => {
    mockSaveAnswer = 'lost';
    const view = await openScreen();
    await openSummary(view);
    await press(view, 'effort-8');
    await press(view, 'send-to-coach');
    await waitFor(() => expect(view.getByText('Not sent to Sam yet')).toBeTruthy());
    expect(view.getByText('Your sets are safe on this phone. They go to Sam when the connection is back, or you can try now.')).toBeTruthy();
    expect(alertTitles()).not.toContain('Saved on this phone');
    expect(mockNav.goBack).not.toHaveBeenCalled();
    expect(view.queryByTestId('coach-note')).toBeNull();
    await press(view, 'effort-5');
    expect(view.getByTestId('effort-8').props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(view.getByTestId('effort-5').props.accessibilityState).toMatchObject({ checked: false, disabled: true });
    await press(view, 'summary-try-again');
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockRows).toHaveLength(1);
    expect(mockServer.workouts).toHaveLength(1);
    expect(mockComplete.mock.calls[0][1]).toMatchObject({ post_rpe: 8 });
    await act(async () => { await pushQueuedWorkouts(); });
    expect(mockServer.workouts).toHaveLength(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('leaving the not-sent page goes back as main\'s "Saved on this phone" did, and the engine sends it once', async () => {
    mockSaveAnswer = 'offline';
    const view = await openScreen();
    await openSummary(view);
    await press(view, 'effort-6');
    await press(view, 'send-to-coach');
    await waitFor(() => expect(view.getByText('Not sent to Sam yet')).toBeTruthy());
    expect(mockHaptic.error).toHaveBeenCalledTimes(1);
    expect(mockHaptic.success).not.toHaveBeenCalled();
    await press(view, 'summary-back');
    expect(mockNav.goBack).toHaveBeenCalledTimes(1);
    mockSaveAnswer = 'ok';
    await act(async () => { await pushQueuedWorkouts(); });
    expect(mockServer.workouts).toHaveLength(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockComplete.mock.calls[0][1]).toMatchObject({ post_rpe: 6 });
  });
});

describe('S8: the completion was already answered under another key (409)', () => {
  it('no second completion with the rating; the workout stays saved', async () => {
    mockCompleteAnswer = 'conflict';
    const view = await openScreen();
    await openSummary(view);
    await press(view, 'effort-8');
    await press(view, 'send-to-coach');
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockRows[0].assignment_json).toBeNull());
    await act(async () => { await pushQueuedWorkouts(); });
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(mockServer.workouts).toHaveLength(1);
    expect(mockRows[0]).toMatchObject({ sync_status: 'synced' });
  });
});

describe('S9 and S10: main\'s finish where the summary does not apply', () => {
  const mainFinish = async (view: Awaited<ReturnType<typeof openScreen>>) => {
    expect(view.getByTestId('workout-finish-summary')).toBeTruthy();
    expect(view.getByText('Session summary')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('finish-workout')); });
    expect(alertTitles()).toContain('Finish workout?');
    expect(view.queryByTestId('workout-summary-c5')).toBeNull();
    expect(view.queryByText('How hard, 1 to 10')).toBeNull();
  };
  it('S9: switch off', async () => {
    mockFlags.clientTrainV2 = false;
    await mainFinish(await openScreen());
  });
  it('S10: a self-started workout (no assignment)', async () => {
    await mainFinish(await openScreen(null));
  });
  it('S10: a coachless client', async () => {
    mockCoachless = true;
    await mainFinish(await openScreen());
  });
});

describe('S12: the week ring', () => {
  it('counts this workout done at Send, once, also after the read refreshes', async () => {
    mockSaveAnswer = 'hold';
    const view = await openScreen();
    await openSummary(view);
    await waitFor(() => expect(view.getByTestId('summary-ring')).toBeTruthy());
    const before = view.getByTestId('summary-ring').props.accessibilityLabel as string;
    const [n, total] = before.match(/\d+/g)!.map(Number);
    await press(view, 'send-to-coach');
    await waitFor(() => expect(view.getByTestId('summary-ring').props.accessibilityLabel).toBe(`${n + 1} of ${total} done`));
    mockAssignments.mockImplementation(async () => weekRows(true));
    await act(async () => { await view.client.invalidateQueries({ queryKey: ['assignments'] }); });
    expect(view.getByTestId('summary-ring').props.accessibilityLabel).toBe(`${n + 1} of ${total} done`);
    await act(async () => { mockRelease?.(); });
  });
  it('a failed week read: the masthead without the ring and strip, "Workout complete." and the totals', async () => {
    mockWeekFails = true;
    const view = await openScreen();
    await openSummary(view);
    await waitFor(() => expect(mockAssignments).toHaveBeenCalled());
    expect(view.queryByTestId('summary-ring')).toBeNull();
    expect(view.getByText('Workout complete.')).toBeTruthy();
    expect(view.getByTestId('summary-totals')).toBeTruthy();
  });
});
