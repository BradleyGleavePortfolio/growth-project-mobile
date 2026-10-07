/** AIB-5 Ask AI: API client, copy, sheet + hook (plan section 6). Screen entry + undo: coachWorkoutBuilderUndo.test.tsx. */
import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { aiBuilderApi, toAiBuilderError } from '../../../../api/aiBuilderApi';
import { lightTokens } from '../../../../theme/tokens';
import AiBuilderSheet from '../AiBuilderSheet';
import { useAiBuilder } from '../useAiBuilder';
import { describeAiBuilderError, PAUSED_COPY } from '../aiBuilderCopy';

const mockApi = { get: jest.fn(), post: jest.fn(), patch: jest.fn() };
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockApi.get(...a), post: (...a: unknown[]) => mockApi.post(...a), patch: (...a: unknown[]) => mockApi.patch(...a) },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined), selectionAsync: jest.fn(async () => undefined), notificationAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' }, NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
let mockReduceMotion = false;
jest.mock('../../../../screens/client/wearables/components/useReduceMotion', () => ({ useReduceMotion: () => mockReduceMotion }));

const httpError = (status: number, data: unknown = {}) => Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
const STATUS_ON = { state: 'on', create: true, edit: true, credits: { remaining_pct: 80, resets_at: null }, label: 'AI-suggested, coach-approved' };
const change = (id: string, kind: string, name: string, extra: object) => ({
  change_id: id, kind, op: {}, exercise: { id: name, name, thumbnail_url: null }, reason: `Reason ${id}.`, warnings: [], ...extra,
});
const PROPOSAL = {
  draft_id: 'draft-1', summary: '2 changes. Knee-friendly swaps.', dropped: [{ reason: 'not in your exercise library.' }], context_used: ['goal'], screening_flag: false,
  changes: [
    change('c1', 'changed', 'Goblet squat', { before: { sets: 3, reps_or_duration_seconds: 8, weight_lbs: 135 }, after: { sets: 3, reps_or_duration_seconds: 10, weight_lbs: 115 } }),
    change('c2', 'added', 'Glute bridge', { after: { sets: 2, reps_or_duration_seconds: 12 }, warnings: ['Loads the hip.'] }),
  ],
};

const mockPrepare = jest.fn();
const mockOnApplied = jest.fn();
function Harness() {
  const ai = useAiBuilder({ planId: 'plan-1', isBlank: false, prepare: mockPrepare, onApplied: mockOnApplied });
  return <AiBuilderSheet open onClose={jest.fn()} ai={ai} isBlank={false} sc={lightTokens} />;
}
type Screen = Awaited<ReturnType<typeof render>>;
const press = (s: Screen, id: string) => act(async () => { fireEvent.press(s.getByTestId(id)); });
async function proposeFromInput(s: Screen) {
  await act(async () => { fireEvent.changeText(s.getByTestId('ai-builder-input'), 'swap squats for something knee-friendly'); });
  await press(s, 'ai-builder-send');
}
const proposeCall = (fields: object) => expect(mockApi.post).toHaveBeenCalledWith('/ai/gateway/workout-builder/propose', expect.objectContaining(fields), expect.anything());

beforeEach(() => {
  [jest.clearAllMocks(), (mockReduceMotion = false), mockOnApplied.mockResolvedValue(undefined), mockApi.get.mockResolvedValue({ data: STATUS_ON })];
  mockPrepare.mockResolvedValue({ ok: true, lockToken: 'abcdefabcdefabcd' });
});

describe('aiBuilderApi + copy', () => {
  it('status 404 (current production backend) is null, so the entry hides', async () => {
    mockApi.get.mockRejectedValueOnce(httpError(404));
    await expect(aiBuilderApi.getStatus()).resolves.toBeNull();
  });

  it('maps every refusal to one specific code and line; never first person, an exclamation or purchase wording', () => {
    expect(toAiBuilderError(httpError(402, { code: 'COACH_AI_BUDGET_EXHAUSTED', budget: { period_end: '2026-11-01' } }))).toEqual(
      expect.objectContaining({ code: 'no_credits', resetsAt: '2026-11-01' }),
    );
    const cases: [number, object, string][] = [
      [403, { code: 'COACH_AI_BUDGET_EXHAUSTED' }, 'no_credits'], [403, { code: 'ai_consent_required' }, 'consent_required'],
      [409, {}, 'stale'], [422, {}, 'no_safe_proposal'], [429, {}, 'rate_limited'], [503, { code: 'AI_PAUSED' }, 'paused'],
    ];
    for (const [status, body, code] of cases) expect(toAiBuilderError(httpError(status, body)).code).toBe(code);
    expect(toAiBuilderError(new Error('socket')).code).toBe('network');
    for (const c of ['no_credits', 'consent_required', 'stale', 'no_safe_proposal', 'paused', 'rate_limited', 'forbidden', 'network', 'contract', 'server'] as const) {
      expect(describeAiBuilderError(c, null)).not.toMatch(/!|\b(I|we|We|my|our)\b|Something went wrong|top up|buy|purchase/);
    }
  });
});

describe('AiBuilderSheet + useAiBuilder', () => {
  it('paused status keeps Ask AI visible with the paused copy and no prompt', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { ...STATUS_ON, state: 'paused' } });
    const s = await render(<Harness />);
    await waitFor(() => expect(s.getByText(PAUSED_COPY)).toBeTruthy());
    expect(s.queryByTestId('ai-builder-input')).toBeNull();
  });

  it('cards show kind, before -> after, reason and warnings; keep toggles drive Apply N; Apply sends accepted ids with a success haptic', async () => {
    mockApi.post.mockResolvedValueOnce({ data: PROPOSAL });
    const ref = { plan_id: 'plan-1', revision_index: 4, lock_token: 'abababababababab' };
    mockApi.patch.mockResolvedValueOnce({ data: { status: 'approved', materialised_ref: ref } });
    const s = await render(<Harness />);
    await proposeFromInput(s);
    await waitFor(() => expect(s.getByTestId('ai-builder-review')).toBeTruthy());
    proposeCall({ mode: 'edit', plan_id: 'plan-1', lock_token: 'abcdefabcdefabcd' });
    for (const t of ['Changed', 'Added', '3 x 8 @ 135 lb -> 3 x 10 @ 115 lb', 'Reason c1.', 'Warning: Loads the hip.', '1 suggestion removed: not in your exercise library.', 'Apply 2 changes']) {
      expect(s.getByText(t)).toBeTruthy();
    }
    await act(async () => { fireEvent(s.getByTestId('ai-keep-c2'), 'valueChange', false); });
    expect(s.getByText('Apply 1 change')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
    await press(s, 'ai-builder-apply');
    expect(mockApi.patch).toHaveBeenCalledWith('/ai/gateway/drafts/draft-1', { decision: 'approved', accepted_change_ids: ['c1'] });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    expect(mockOnApplied).toHaveBeenCalledWith(ref, 1);
  });

  it('Discard rejects the draft with a warning haptic', async () => {
    [mockApi.post.mockResolvedValueOnce({ data: PROPOSAL }), mockApi.patch.mockResolvedValueOnce({ data: { status: 'rejected' } })];
    const s = await render(<Harness />);
    await proposeFromInput(s);
    await waitFor(() => expect(s.getByTestId('ai-builder-discard')).toBeTruthy());
    await press(s, 'ai-builder-discard');
    expect(mockApi.patch).toHaveBeenCalledWith('/ai/gateway/drafts/draft-1', { decision: 'rejected' });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
  });

  it('chips: light haptic + quick action; the injury chip asks for the area first', async () => {
    mockApi.post.mockResolvedValue({ data: { ...PROPOSAL, changes: [], summary: 'Upper body push, 6 exercises.' } });
    const s = await render(<Harness />);
    await waitFor(() => expect(s.getByTestId('ai-chip-deload')).toBeTruthy());
    expect(s.queryByTestId('ai-injury-knee')).toBeNull();
    await press(s, 'ai-chip-swap_for_injury');
    await press(s, 'ai-injury-knee');
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    proposeCall({ quick_action: 'swap_for_injury', injury_area: 'knee' });
    await waitFor(() => expect(s.getByText('Upper body push, 6 exercises.')).toBeTruthy());
  });

  it.each([
    [httpError(402, { code: 'COACH_AI_BUDGET_EXHAUSTED' }), /^AI credits for this month are used up\./],
    [httpError(403, { code: 'ai_consent_required' }), /has not allowed AI to use their data/],
    [httpError(409), /changed on another screen/],
    [httpError(422, { code: 'AI_NO_SAFE_PROPOSAL' }), /No safe change found/],
  ])('a refused proposal shows its own copy and an error haptic (%#)', async (err, copy) => {
    mockApi.post.mockRejectedValueOnce(err);
    const s = await render(<Harness />);
    await proposeFromInput(s);
    await waitFor(() => expect(s.getByTestId('ai-builder-error').props.children).toMatch(copy));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('Reduce Motion: cards appear at once, no stagger animation', async () => {
    mockReduceMotion = true;
    const timing = jest.spyOn(Animated, 'timing');
    mockApi.post.mockResolvedValueOnce({ data: PROPOSAL });
    const s = await render(<Harness />);
    await proposeFromInput(s);
    await waitFor(() => expect(s.getByTestId('ai-change-c1')).toBeTruthy());
    expect(timing).not.toHaveBeenCalled();
    timing.mockRestore();
  });
});
