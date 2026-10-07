/** Ask AI fun layer: spring reveal of change cards, coach win moment, momentum line, haptics, Reduce Motion. */
import React from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { lightTokens } from '../../../../theme/tokens';
import AiBuilderSheet from '../AiBuilderSheet';
import { useAiBuilder } from '../useAiBuilder';
import { AI_SPRING, AiMomentumLine, AiWinToast, momentumLine } from '../AiFunLayer';

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

const STATUS_ON = { state: 'on', create: true, edit: true, credits: { remaining_pct: 80, resets_at: null }, label: 'AI-suggested, coach-approved' };
const card = (id: string) => ({ change_id: id, kind: 'changed', op: {}, exercise: { id, name: `Lift ${id}`, thumbnail_url: null }, reason: `Reason ${id}.`, warnings: [], after: { sets: 3 } });
const PROPOSAL = { draft_id: 'draft-1', summary: '3 changes.', dropped: [], context_used: [], screening_flag: false, changes: [card('c1'), card('c2'), card('c3')] };

function Harness() {
  const ai = useAiBuilder({ planId: 'plan-1', isBlank: false, prepare: async () => ({ ok: true }), onApplied: jest.fn() });
  return <AiBuilderSheet open onClose={jest.fn()} ai={ai} isBlank={false} sc={lightTokens} />;
}
type Screen = Awaited<ReturnType<typeof render>>;
async function propose(s: Screen) {
  await act(async () => { fireEvent.changeText(s.getByTestId('ai-builder-input'), 'progress this'); });
  await act(async () => { fireEvent.press(s.getByTestId('ai-builder-send')); });
  await waitFor(() => expect(s.getByTestId('ai-change-c3')).toBeTruthy());
}
const springDelays = (spy: jest.SpyInstance) => spy.mock.calls.map(([, cfg]) => (cfg as { delay?: number }).delay ?? 0);

beforeEach(() => {
  [jest.clearAllMocks(), (mockReduceMotion = false), mockApi.get.mockResolvedValue({ data: STATUS_ON }), mockApi.post.mockResolvedValue({ data: PROPOSAL })];
});
afterEach(() => jest.restoreAllMocks());

describe('change cards: staged spring reveal', () => {
  it('each card springs in (damping 18) on a 60 ms stagger; send is a medium haptic and card landings tick light', async () => {
    const spring = jest.spyOn(Animated, 'spring');
    const s = await render(<Harness />);
    await waitFor(() => expect(s.getByTestId('ai-builder-input')).toBeTruthy());
    await propose(s);
    expect(springDelays(spring)).toEqual(expect.arrayContaining([0, 60, 120]));
    expect(spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ damping: AI_SPRING.damping, delay: 120 }));
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
    await waitFor(() => expect((Haptics.impactAsync as jest.Mock).mock.calls.filter(([k]) => k === 'light').length).toBeGreaterThanOrEqual(3));
  });

  it('turning a card off keeps the text signal ("Not applied.") and the Apply count follows', async () => {
    const s = await render(<Harness />);
    await waitFor(() => expect(s.getByTestId('ai-builder-input')).toBeTruthy());
    await propose(s);
    await act(async () => { fireEvent(s.getByTestId('ai-keep-c2'), 'valueChange', false); });
    expect(s.getByText('Not applied.')).toBeTruthy();
    expect(s.getByText('Apply 2 changes')).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('warning');
  });

  it('Reduce Motion: no springs and no stagger; haptics stay', async () => {
    mockReduceMotion = true;
    const spring = jest.spyOn(Animated, 'spring');
    const timing = jest.spyOn(Animated, 'timing');
    const s = await render(<Harness />);
    await waitFor(() => expect(s.getByTestId('ai-builder-input')).toBeTruthy());
    await propose(s);
    await act(async () => { fireEvent(s.getByTestId('ai-keep-c2'), 'valueChange', false); });
    [expect(spring).not.toHaveBeenCalled(), expect(timing).not.toHaveBeenCalled()];
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
  });
});

describe('coach win moment', () => {
  it('springs up with the applied count and the coach-approved label, is announced, and Undo is a medium haptic', async () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const spring = jest.spyOn(Animated, 'spring');
    const onUndo = jest.fn();
    const s = await render(<AiWinToast text="Applied 3 changes." undo undoDisabled={false} onUndo={onUndo} sc={lightTokens} />);
    for (const t of ['Applied 3 changes.', 'AI-suggested, coach-approved']) expect(s.getByText(t)).toBeTruthy();
    expect(announce).toHaveBeenCalledWith('Applied 3 changes. AI-suggested, coach-approved.');
    expect(spring).toHaveBeenCalled();
    await act(async () => { fireEvent.press(s.getByTestId('ai-toast-undo')); });
    [expect(onUndo).toHaveBeenCalledTimes(1), expect(Haptics.impactAsync).toHaveBeenCalledWith('medium')];
  });

  it('Reduce Motion: a cross-fade only (no spring); no Undo button when the server copy was re-read', async () => {
    mockReduceMotion = true;
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const spring = jest.spyOn(Animated, 'spring');
    const timing = jest.spyOn(Animated, 'timing');
    const s = await render(<AiWinToast text="Applied 1 change." undo={false} undoDisabled={false} onUndo={jest.fn()} sc={lightTokens} />);
    [expect(spring).not.toHaveBeenCalled(), expect(timing).toHaveBeenCalledTimes(1), expect(s.queryByTestId('ai-toast-undo')).toBeNull()];
  });
});

describe('momentum line', () => {
  it('numbers first, singular and plural, applied count only once there is one; no first person or exclamation', () => {
    expect(momentumLine([], 0)).toBe('No exercises yet.');
    expect(momentumLine([{ sets: 1 }], 0)).toBe('1 exercise, 1 set.');
    expect(momentumLine([{ sets: 3 }, { sets: 4 }, { sets: null }], 1)).toBe('3 exercises, 7 sets. 1 change applied with Ask AI this session.');
    expect(momentumLine([{ sets: 3 }, { sets: 3 }], 5)).toBe('2 exercises, 6 sets. 5 changes applied with Ask AI this session.');
    for (const line of [momentumLine([], 2), momentumLine([{ sets: 2 }], 9)]) expect(line).not.toMatch(/!|\b(I|we|We|my|our)\b/);
  });

  it('pulses (spring) when an apply lands; Reduce Motion keeps the text change without the pulse', async () => {
    const spring = jest.spyOn(Animated, 'spring');
    const rows = [{ sets: 3 }];
    const s = await render(<AiMomentumLine rows={rows} applied={0} sc={lightTokens} />);
    expect(spring).not.toHaveBeenCalled();
    await s.rerender(<AiMomentumLine rows={rows} applied={2} sc={lightTokens} />);
    [expect(spring).toHaveBeenCalledTimes(1), expect(s.getByTestId('ai-momentum-line').props.children).toMatch(/2 changes applied/)];
    mockReduceMotion = true;
    await s.rerender(<AiMomentumLine rows={rows} applied={3} sc={lightTokens} />);
    [expect(spring).toHaveBeenCalledTimes(1), expect(s.getByLabelText('1 exercise, 3 sets. 3 changes applied with Ask AI this session.')).toBeTruthy()];
  });
});
