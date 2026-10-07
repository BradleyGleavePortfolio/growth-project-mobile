/**
 * AIB-5 Ask AI in the workout builder: API client, copy, sheet + hook.
 * Plan section 6 (AIB-5). Screen-level entry and undo: coachWorkoutBuilderUndo.test.tsx.
 */
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
  default: {
    get: (...a: unknown[]) => mockApi.get(...a),
    post: (...a: unknown[]) => mockApi.post(...a),
    patch: (...a: unknown[]) => mockApi.patch(...a),
  },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
let mockReduceMotion = false;
jest.mock('../../../../screens/client/wearables/components/useReduceMotion', () => ({
  useReduceMotion: () => mockReduceMotion,
}));

function httpError(status: number, data: unknown = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status, data } });
}

const STATUS_ON = {
  state: 'on',
  create: true,
  edit: true,
  credits: { remaining_pct: 80, resets_at: '2026-11-01T00:00:00.000Z' },
  label: 'AI-suggested, coach-approved',
};
const PROPOSAL = {
  draft_id: 'draft-1',
  summary: '2 changes. Knee-friendly swaps, same weekly volume.',
  changes: [
    {
      change_id: 'c1',
      kind: 'changed',
      op: { op: 'update_exercise' },
      before: { sets: 3, reps_or_duration_seconds: 8, weight_lbs: 135 },
      after: { sets: 3, reps_or_duration_seconds: 10, weight_lbs: 115 },
      exercise: { id: 'goblet-squat', name: 'Goblet squat', thumbnail_url: null },
      reason: 'Less knee flexion under load.',
      warnings: [],
    },
    {
      change_id: 'c2',
      kind: 'added',
      op: { op: 'add_exercise' },
      after: { sets: 2, reps_or_duration_seconds: 12 },
      exercise: { id: 'glute-bridge', name: 'Glute bridge', thumbnail_url: null },
      reason: 'Keeps hip volume.',
      warnings: ['Loads the hip.'],
    },
  ],
  dropped: [{ reason: 'not in your exercise library.' }],
  context_used: ['goal', 'equipment'],
  screening_flag: false,
  credits_remaining_pct: 78,
};

const mockPrepare = jest.fn();
const mockOnApplied = jest.fn();
function Harness() {
  const ai = useAiBuilder({ planId: 'plan-1', isBlank: false, prepare: mockPrepare, onApplied: mockOnApplied });
  return <AiBuilderSheet open onClose={jest.fn()} ai={ai} isBlank={false} sc={lightTokens} />;
}

async function proposeFromInput(screen: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('ai-builder-input'), 'swap squats for something knee-friendly');
  });
  await act(async () => {
    fireEvent.press(screen.getByTestId('ai-builder-send'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockReduceMotion = false;
  mockPrepare.mockResolvedValue({ ok: true, lockToken: 'abcdefabcdefabcd' });
  mockOnApplied.mockResolvedValue(undefined);
  mockApi.get.mockResolvedValue({ data: STATUS_ON });
});

describe('aiBuilderApi', () => {
  it('status 404 (current production backend) reads as not available, so the entry hides', async () => {
    mockApi.get.mockRejectedValueOnce(httpError(404));
    await expect(aiBuilderApi.getStatus()).resolves.toBeNull();
    mockApi.get.mockResolvedValueOnce({ data: { ...STATUS_ON, state: 'paused' } });
    await expect(aiBuilderApi.getStatus()).resolves.toEqual(expect.objectContaining({ state: 'paused' }));
  });

  it('maps every refusal to one specific code', () => {
    expect(toAiBuilderError(httpError(402, { code: 'COACH_AI_BUDGET_EXHAUSTED', budget: { period_end: '2026-11-01' } }))).toEqual(
      expect.objectContaining({ code: 'no_credits', resetsAt: '2026-11-01' }),
    );
    expect(toAiBuilderError(httpError(403, { code: 'COACH_AI_BUDGET_EXHAUSTED' })).code).toBe('no_credits');
    expect(toAiBuilderError(httpError(403, { code: 'ai_consent_required' })).code).toBe('consent_required');
    expect(toAiBuilderError(httpError(409)).code).toBe('stale');
    expect(toAiBuilderError(httpError(422)).code).toBe('no_safe_proposal');
    expect(toAiBuilderError(httpError(429)).code).toBe('rate_limited');
    expect(toAiBuilderError(httpError(503, { code: 'AI_PAUSED' })).code).toBe('paused');
    expect(toAiBuilderError(new Error('socket')).code).toBe('network');
  });

  it('copy is specific, never first person, never an exclamation', () => {
    const codes = ['no_credits', 'consent_required', 'stale', 'no_safe_proposal', 'paused', 'rate_limited', 'forbidden', 'network', 'contract', 'server'] as const;
    for (const c of codes) {
      const line = describeAiBuilderError(c, '2026-11-01T12:00:00.000Z');
      expect(line).not.toMatch(/!|\b(I|we|We|my|our)\b|Something went wrong/);
    }
    expect(describeAiBuilderError('no_credits', null)).toMatch(/^AI credits for this month are used up\./);
    expect(describeAiBuilderError('no_credits', 'x')).not.toMatch(/top up|buy|purchase/i);
  });
});

describe('AiBuilderSheet + useAiBuilder', () => {
  it('paused status keeps Ask AI visible with the paused copy and no prompt', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { ...STATUS_ON, state: 'paused' } });
    const screen = await render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('ai-builder-blocked')).toBeTruthy());
    expect(screen.getByText(PAUSED_COPY)).toBeTruthy();
    expect(screen.queryByTestId('ai-builder-input')).toBeNull();
  });

  it('renders change cards with kind, before -> after and reason; keep toggles drive the Apply count; Apply sends accepted ids', async () => {
    mockApi.post.mockResolvedValueOnce({ data: PROPOSAL });
    mockApi.patch.mockResolvedValueOnce({
      data: { status: 'approved', materialised_ref: { plan_id: 'plan-1', revision_index: 4, lock_token: 'abababababababab' } },
    });
    const screen = await render(<Harness />);
    await proposeFromInput(screen);
    await waitFor(() => expect(screen.getByTestId('ai-builder-review')).toBeTruthy());
    expect(mockApi.post).toHaveBeenCalledWith(
      '/ai/gateway/workout-builder/propose',
      expect.objectContaining({ mode: 'edit', plan_id: 'plan-1', lock_token: 'abcdefabcdefabcd' }),
      expect.anything(),
    );
    expect(screen.getByText('Changed')).toBeTruthy();
    expect(screen.getByText('Added')).toBeTruthy();
    expect(screen.getByText('3 x 8 @ 135 lb -> 3 x 10 @ 115 lb')).toBeTruthy();
    expect(screen.getByText('Less knee flexion under load.')).toBeTruthy();
    expect(screen.getByText('Warning: Loads the hip.')).toBeTruthy();
    expect(screen.getByText('1 suggestion removed: not in your exercise library.')).toBeTruthy();
    expect(screen.getByText('Apply 2 changes')).toBeTruthy();

    await act(async () => {
      fireEvent(screen.getByTestId('ai-keep-c2'), 'valueChange', false);
    });
    expect(screen.getByText('Apply 1 change')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');

    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-builder-apply'));
    });
    expect(mockApi.patch).toHaveBeenCalledWith('/ai/gateway/drafts/draft-1', {
      decision: 'approved',
      accepted_change_ids: ['c1'],
    });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    expect(mockOnApplied).toHaveBeenCalledWith({ plan_id: 'plan-1', revision_index: 4, lock_token: 'abababababababab' }, 1);
  });

  it('Discard rejects the draft with a warning haptic', async () => {
    mockApi.post.mockResolvedValueOnce({ data: PROPOSAL });
    mockApi.patch.mockResolvedValueOnce({ data: { status: 'rejected' } });
    const screen = await render(<Harness />);
    await proposeFromInput(screen);
    await waitFor(() => expect(screen.getByTestId('ai-builder-discard')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-builder-discard'));
    });
    expect(mockApi.patch).toHaveBeenCalledWith('/ai/gateway/drafts/draft-1', { decision: 'rejected' });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
  });

  it('a chip fires a light haptic and sends its quick action', async () => {
    mockApi.post.mockResolvedValue({ data: { ...PROPOSAL, changes: [], summary: 'Upper body push, 6 exercises.' } });
    const screen = await render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('ai-chip-deload')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-chip-deload'));
    });
    expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    expect(mockApi.post).toHaveBeenCalledWith(
      '/ai/gateway/workout-builder/propose',
      expect.objectContaining({ quick_action: 'deload' }),
      expect.anything(),
    );
    await waitFor(() => expect(screen.getByText('Upper body push, 6 exercises.')).toBeTruthy());
  });

  it('the injury chip asks for the area, then sends swap_for_injury with it', async () => {
    mockApi.post.mockResolvedValueOnce({ data: PROPOSAL });
    const screen = await render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('ai-chip-swap_for_injury')).toBeTruthy());
    expect(screen.queryByTestId('ai-injury-knee')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-chip-swap_for_injury'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('ai-injury-knee'));
    });
    expect(mockApi.post).toHaveBeenCalledWith(
      '/ai/gateway/workout-builder/propose',
      expect.objectContaining({ quick_action: 'swap_for_injury', injury_area: 'knee' }),
      expect.anything(),
    );
  });

  it.each([
    [httpError(402, { code: 'COACH_AI_BUDGET_EXHAUSTED' }), /^AI credits for this month are used up\./],
    [httpError(403, { code: 'ai_consent_required' }), /has not allowed AI to use their data/],
    [httpError(409), /changed on another screen/],
    [httpError(422, { code: 'AI_NO_SAFE_PROPOSAL' }), /No safe change found/],
  ])('a refused proposal shows its own copy and an error haptic (%#)', async (err, copy) => {
    mockApi.post.mockRejectedValueOnce(err);
    const screen = await render(<Harness />);
    await proposeFromInput(screen);
    await waitFor(() => expect(screen.getByTestId('ai-builder-error')).toBeTruthy());
    expect(screen.getByTestId('ai-builder-error').props.children).toMatch(copy);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('error');
  });

  it('Reduce Motion: cards appear at once, no stagger animation', async () => {
    mockReduceMotion = true;
    const timing = jest.spyOn(Animated, 'timing');
    mockApi.post.mockResolvedValueOnce({ data: PROPOSAL });
    const screen = await render(<Harness />);
    await proposeFromInput(screen);
    await waitFor(() => expect(screen.getByTestId('ai-change-c1')).toBeTruthy());
    expect(timing).not.toHaveBeenCalled();
    timing.mockRestore();
  });
});
