/** AIB-FINISH-127 job 6 "Template to client": the client's copy, Ask AI with client_id, and Assign after the adjustment. */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { lightTokens } from '../../../../theme/tokens';
import { WorkoutsTab } from '../../../../screens/coach/client-detail/WorkoutsTab';
import { copyWorkoutForClient } from '../AdjustForClient';
import { ClientCopyBar } from '../ClientCopyBar';
import AiBuilderSheet from '../../ai-builder/AiBuilderSheet';
import { useAiBuilder } from '../../ai-builder/useAiBuilder';

const mockApi = { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn() };
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockApi.get(...a), post: (...a: unknown[]) => mockApi.post(...a), put: (...a: unknown[]) => mockApi.put(...a), patch: (...a: unknown[]) => mockApi.patch(...a) },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined), selectionAsync: jest.fn(async () => undefined), notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('../../../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: jest.requireActual('../../../../theme/tokens').lightTokens }) }));
let mockAutosaveFlag = true;
jest.mock('../../../../config/featureFlags', () => {
  const actual = jest.requireActual('../../../../config/featureFlags');
  const featureFlags = Object.defineProperty({ ...actual.featureFlags }, 'mwbAutosave', { get: () => mockAutosaveFlag }); // live, not read once
  return { ...actual, featureFlags };
});
function mockSavedWorkouts() { // a declaration, so the hoisted factory can reach it
  const saved = { id: 'w1', name: 'Push day', type: 'strength', duration_estimate_minutes: 45, exercise_count: 2, updated_at: '2026-10-06T00:00:00Z' };
  return { data: { pages: [{ items: [saved], next_cursor: null }] }, isLoading: false, error: null };
}
jest.mock('../../../../hooks/usePrograms', () => ({ useSavedWorkouts: () => mockSavedWorkouts() }));
const mockAssign = jest.fn();
jest.mock('../../../../hooks/useWorkoutBuilder', () => ({ useAssignWorkoutPlan: () => ({ mutateAsync: mockAssign, isPending: false }) }));

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data: {} } });
const STATUS_ON = { state: 'on', create: true, edit: true, credits: { remaining_pct: 80, resets_at: null }, label: 'AI-suggested, coach-approved' };
const row = (id: string, order: number, extra: object = {}) => ({
  id, workout_plan_id: 'w1', exercise_external_id: `ex-${id}`, order, sets: 3, reps_or_duration_seconds: 8, weight_lbs: null, rest_seconds: 90, superset_group_id: null, notes: null, ...extra,
});
const PLAN = { id: 'w1', coach_id: 'coach-1', name: 'Push day', type: 'strength', duration_estimate_minutes: 45, created_at: '', updated_at: '', archived_at: null,
  exercises: [row('b', 2, { weight_lbs: 95, notes: 'Pause at the bottom' }), row('a', 1)] };
type Screen = Awaited<ReturnType<typeof render>>;
const press = (s: Screen, id: string) => act(async () => { fireEvent.press(s.getByTestId(id)); });
const fake = <T,>(v: unknown): T => v as T; // test seam: proxies stand in for theme colors and styles
type TabProps = Parameters<typeof WorkoutsTab>[0];
const renderTab = (onOpenClientCopy?: (id: string) => void) => render(
  <WorkoutsTab workoutSessions={[]} clientName="Sam Lee" onOpenClientCopy={onOpenClientCopy}
    colors={fake<TabProps['colors']>(new Proxy({}, { get: () => '#123456' }))} styles={fake<TabProps['styles']>(new Proxy({}, { get: () => ({}) }))} />,
);

beforeEach(() => {
  [jest.clearAllMocks(), (mockAutosaveFlag = true)];
  mockApi.get.mockImplementation((url: string) => Promise.resolve({ data: url.includes('workout-builder/status') ? STATUS_ON : PLAN }));
  mockApi.post.mockResolvedValue({ data: { ...PLAN, id: 'copy-1', exercises: [] } });
  mockApi.put.mockResolvedValue({ data: [] });
});

describe('Adjust a saved workout for <first name>', () => {
  it('the copy is by value: same details and rows in order, named for the client; the saved workout is not written', async () => {
    await expect(copyWorkoutForClient('w1', 'Sam')).resolves.toBe('copy-1');
    expect(mockApi.post).toHaveBeenCalledWith('/workout-plans', { name: 'Push day for Sam', type: 'strength', duration_estimate_minutes: 45 });
    expect(mockApi.put).toHaveBeenCalledWith('/workout-plans/copy-1/exercises', [
      expect.objectContaining({ exercise_external_id: 'ex-a', order: 1, sets: 3, rest_seconds: 90, weight_lbs: undefined }),
      expect.objectContaining({ exercise_external_id: 'ex-b', order: 2, weight_lbs: 95, notes: 'Pause at the bottom' }),
    ]);
    expect(mockApi.put.mock.calls.map((c) => c[0])).not.toContain('/workout-plans/w1/exercises');
  });

  it('the Workouts tab offers it by first name; picking a saved workout copies it and opens the copy', async () => {
    const onOpen = jest.fn();
    const s = await renderTab(onOpen);
    await waitFor(() => expect(s.getByText('Adjust a saved workout for Sam')).toBeTruthy());
    await press(s, 'workouts-adjust-with-ai');
    expect(s.getByLabelText('Adjust Push day for Sam')).toBeTruthy();
    await press(s, 'adjust-for-client-w1');
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('copy-1'));
  });

  it('a failed copy says so, keeps the sheet open and opens nothing', async () => {
    mockApi.post.mockRejectedValueOnce(httpError(500));
    const onOpen = jest.fn();
    const s = await renderTab(onOpen);
    await waitFor(() => expect(s.getByTestId('workouts-adjust-with-ai')).toBeTruthy());
    await press(s, 'workouts-adjust-with-ai');
    await press(s, 'adjust-for-client-w1');
    await waitFor(() => expect(s.getByTestId('adjust-for-client-error').props.children).toMatch(/^The copy was not made\. The saved workout is unchanged\./));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it.each([
    ['the backend has no Ask AI (status 404)', () => mockApi.get.mockRejectedValue(httpError(404))],
    ['the build has no builder autosave', () => { mockAutosaveFlag = false; }],
  ])('hidden when %s', async (_label, arrange) => {
    arrange();
    const s = await renderTab(jest.fn());
    await act(async () => {});
    expect(s.queryByTestId('workouts-adjust-with-ai')).toBeNull();
  });
});

describe('Ask AI on the client copy', () => {
  function Harness({ prepare }: { prepare: () => Promise<{ ok: boolean }> }) {
    const ai = useAiBuilder({ planId: 'copy-1', isBlank: false, prepare, onApplied: jest.fn(), clientId: 'client-1' });
    return <AiBuilderSheet open onClose={jest.fn()} ai={ai} isBlank={false} sc={lightTokens} clientFirst="Sam" />;
  }
  const send = async (s: Screen) => {
    await waitFor(() => expect(s.getByTestId('ai-builder-input')).toBeTruthy());
    await act(async () => { fireEvent.changeText(s.getByTestId('ai-builder-input'), 'fit this to Sam'); });
    await press(s, 'ai-builder-send');
  };

  it('sends client_id, says the client limits are checked, and names the context as the client\'s', async () => {
    let finish!: (v: unknown) => void;
    mockApi.post.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })); // held in the thinking state, released below
    const s = await render(<Harness prepare={async () => ({ ok: true })} />);
    await send(s);
    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/ai/gateway/workout-builder/propose', expect.objectContaining({ client_id: 'client-1', plan_id: 'copy-1', mode: 'edit' }), expect.anything()));
    expect(s.getByText(/Checking limits and injuries$/)).toBeTruthy();
    await act(async () => { finish({ data: { draft_id: 'd1', summary: '0 changes.', dropped: [], context_used: ['exercise_library', 'goal', 'injuries'], screening_flag: false, changes: [] } }); });
    await waitFor(() => expect(s.getByText("Using your exercise library, Sam's goal, injuries")).toBeTruthy());
  });
});

describe('Assign the adjusted copy', () => {
  const bar = (prepare: () => Promise<{ ok: boolean }>) => render(<ClientCopyBar planId="copy-1" clientId="client-1" firstName="Sam" prepare={prepare} />);

  it('saves the last edit first, then assigns the copy to the client for today', async () => {
    const prepare = jest.fn(async () => ({ ok: true }));
    mockAssign.mockResolvedValueOnce({ id: 'asg-1' });
    const s = await bar(prepare);
    expect(s.getByText(/^Sam's copy\. .* Sam gets it when you assign it\.$/)).toBeTruthy();
    await press(s, 'client-copy-assign');
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(mockAssign).toHaveBeenCalledWith({ planId: 'copy-1', input: { client_id: 'client-1', scheduled_for: expect.any(String) } });
    expect(s.getByTestId('client-copy-note').props.children).toBe('Assigned to Sam for today.');
    expect(s.getByTestId('client-copy-assign').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('an unsaved edit blocks the assign with its own copy', async () => {
    const s = await bar(async () => ({ ok: false }));
    await press(s, 'client-copy-assign');
    [expect(mockAssign).not.toHaveBeenCalled(), expect(s.getByTestId('client-copy-note').props.children).toMatch(/^Your last edit is still saving\./)];
  });

  it('a failed assign names the client and stays retryable', async () => {
    mockAssign.mockRejectedValueOnce(httpError(500));
    const s = await bar(async () => ({ ok: true }));
    await press(s, 'client-copy-assign');
    expect(s.getByTestId('client-copy-note').props.children).toMatch(/^The workout was not assigned to Sam\./);
    expect(s.getByTestId('client-copy-assign').props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
  });
});
