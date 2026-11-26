/**
 * FIX-974R1 (m#974 @ dacc80b0, LS-974R1 B1 and C2-C5, LO-974R1 C1-C4): the summary page is the whole screen, and what it
 * says stays still while it is open. The setup is workoutSummaryC5.screen.test.tsx's: the real screen, queue and sync
 * engine; storage, transport, navigation and haptics faked. Fictional client and coach.
 */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
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
let mockQueueFails = false;
type Row = { id: string; user_id: string; payload: string; client_key: string; assignment_json: string | null; sync_status: string; server_id: string | null };
const mockRows: Row[] = [];
const mockDb = {
  runAsync: jest.fn(async (raw: string, args: unknown[]) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('INSERT INTO workout_logs')) {
      if (mockQueueFails) throw new Error('database or disk is full');
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
const stored = (assignmentId?: string, open = false) => ({
  version: 1, startedAtMs: START, updatedAtMs: Date.now(), pausedMs: 0, routineName: 'Upper body A', exercisesJson: '[]',
  assignmentId, idempotencyKey: assignmentId ? '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f' : '', workoutNotes: '',
  sessionExercises: [
    { exerciseId: 'ex-bench', exerciseName: 'Bench press', muscleGroup: 'chest', restSec: open ? 90 : 0,
      sets: [done(155, 6, 1), done(155, 6, 2), ...(open ? [{ weight: 155, reps: 6, completed: false }] : [])] },
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

async function openScreen(assignment: string | null = ASSIGNMENT, open = false) {
  const assignmentId = assignment ?? undefined;
  mockParams = { routineName: 'Upper body A', exercises: '[]', resume: true, ...(assignmentId ? { assignmentId } : {}) };
  mockStore.set(mockUser.id, stored(assignmentId, open));
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

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.length = 0;
  mockStore.clear();
  mockServer.workouts = []; mockServer.keys = new Map(); mockServer.completions = [];
  mockSaveAnswer = 'ok'; mockCompleteAnswer = 'ok'; mockWeekFails = false; mockRelease = null; mockQueueFails = false;
  mockFlags.clientTrainV2 = true; mockFlags.romanChat = false; mockCoachless = false;
  mockAssignments.mockImplementation(async () => { if (mockWeekFails) throw new Error('Network Error'); return weekRows(); });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());
const totals = (view: Awaited<ReturnType<typeof openScreen>>) => {
  const kids = view.getByTestId('summary-totals').props.children;
  return Array.isArray(kids) ? kids.join('') : String(kids);
};
const minutesOf = (line: string) => Number(/^([\d,]+) min/.exec(line)?.[1].replace(/,/g, ''));

describe('LS-974R1 B1: the summary page is the whole screen', () => {
  it('the tab bar hides while the summary is open (route param summary) and comes back on the logger', async () => {
    const view = await openScreen();
    expect(mockNav.setParams).not.toHaveBeenCalled();
    await openSummary(view);
    expect(mockNav.setParams).toHaveBeenLastCalledWith({ summary: true });
    await press(view, 'summary-back');
    await waitFor(() => expect(view.getByText('Finish workout')).toBeTruthy());
    expect(mockNav.setParams).toHaveBeenLastCalledWith({ summary: false });
  });
  it('with the week drawn, back sits beside the ring and takes no row of its own (C2_summary draws none)', async () => {
    const view = await openScreen();
    await openSummary(view);
    await waitFor(() => expect(view.getByTestId('summary-ring')).toBeTruthy());
    expect(StyleSheet.flatten(view.getByTestId('summary-back').props.style)).toMatchObject({ position: 'absolute' });
  });
});

describe('LO-974R1 C2 / LS-974R1 C4: the minutes stop at Finish workout', () => {
  it('the summary\'s minutes do not move while it is open, and Send saves those minutes', async () => {
    const view = await openScreen();
    await openSummary(view);
    const shown = totals(view);
    // Ten minutes on the summary page (the clock ticks once a second).
    const later = Date.now() + 10 * 60_000;
    jest.spyOn(Date, 'now').mockImplementation(() => later);
    await act(async () => { await new Promise((r) => setTimeout(r, 1300)); });
    expect(totals(view)).toBe(shown);
    await press(view, 'send-to-coach');
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ duration_minutes: minutesOf(shown) });
  });
});

describe('LS-974R1 C2: the rest timer ends when the summary opens', () => {
  it('a rest running at Finish workout is gone on the summary and back on the logger', async () => {
    const view = await openScreen(ASSIGNMENT, true);
    await press(view, 'set-done-0-2');
    await waitFor(() => expect(view.getByTestId('rest-timer')).toBeTruthy());
    await openSummary(view);
    await press(view, 'summary-back');
    await waitFor(() => expect(view.getByText('Finish workout')).toBeTruthy());
    expect(view.queryByTestId('rest-timer')).toBeNull();
  });
});

describe('LO-974R1 C3: back while Send is saving', () => {
  it('the back control does nothing while the save is on its way; the page leaves once it answers', async () => {
    mockSaveAnswer = 'hold';
    const view = await openScreen();
    await openSummary(view);
    await press(view, 'send-to-coach');
    await waitFor(() => expect(mockRelease).not.toBeNull());
    await press(view, 'summary-back');
    expect(view.getByTestId('workout-summary-c5')).toBeTruthy();
    expect(view.queryByText('Finish workout')).toBeNull();
    expect(mockNav.goBack).not.toHaveBeenCalled();
    await act(async () => { mockRelease?.(); });
    await waitFor(() => expect(mockNav.goBack).toHaveBeenCalledTimes(1));
  });
});

describe('LS-974R1 C5: the phone could not store the workout, the server answers', () => {
  it('the direct completion carries the rating and the note', async () => {
    mockQueueFails = true;
    const view = await openScreen();
    await openSummary(view);
    await press(view, 'effort-8');
    await act(async () => { fireEvent.changeText(view.getByTestId('coach-note'), 'Squats felt strong.'); });
    await press(view, 'send-to-coach');
    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockRows).toHaveLength(0);
    expect(mockComplete.mock.calls[0][1]).toMatchObject({ post_rpe: 8, post_notes: 'Squats felt strong.' });
  });
});
