/**
 * CoachBriefLightScreen (Concept A, behind coachBriefGate): every state renders
 * with a way out, every row opens the right place, haptics fire only on the
 * coach's own taps (and once more when a retry fails again), the brief is
 * marked read once, a preparing brief is announced once when it arrives, and
 * the reveal never lets an invisible row take a tap.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CoachBrief, CoachBriefActionItem } from '../../../../api/coachBriefApi';

jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { coachBrief: true, coachBriefGate: true, teamMode: false, romanChat: true },
}));
jest.mock('../../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'c1', email: 'j@x.io', firstName: 'Jordan' }),
}));
jest.mock('../../../../services/commandCenterApi', () => ({ __USING_MOCK_DATA: false }));
let mockReduced = true;
jest.mock('../../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => mockReduced }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { softImpact: jest.fn(), error: jest.fn(), selection: jest.fn() },
}));

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockTab = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, canGoBack: () => true, getParent: () => ({ navigate: mockTab }) }),
  useIsFocused: () => true,
}));

const mockToday = jest.fn();
const mockRegenerate = jest.fn();
const mockMarkRead = jest.fn();
jest.mock('../../../../api/coachBriefApi', () => ({
  coachBriefApi: { today: () => mockToday(), regenerate: () => mockRegenerate(), markRead: (id: string) => mockMarkRead(id) },
  CoachBriefApiError: class CoachBriefApiError extends Error {
    kind: string;
    constructor(kind: string) {
      super(kind);
      this.kind = kind;
    }
  },
}));

import CoachBriefLightScreen from '../CoachBriefLightScreen';
import { CoachBriefApiError } from '../../../../api/coachBriefApi';
import { HapticService } from '../../../../ui/haptics/haptics.service';

const BODY = '$1,240 came in from 4 payments since midnight. 3 messages are waiting for a reply.';
const NAMES = ['Sarah Lin', 'Dana Ortiz', 'Lee Park', 'Ana Silva', 'Ben Cole', 'Ivy Moss'];
const client = (type: string, n: number, name = NAMES[n]): CoachBriefActionItem => ({
  type, client_id: `${type}-${n}`, client_name: name, detail: `${type} ${n}`, priority: 1,
});
const six = (type: string) => NAMES.map((_, n) => client(type, n));

function brief(items: CoachBriefActionItem[], over: Partial<CoachBrief> = {}): CoachBrief {
  return {
    id: 'b-1',
    brief_date: '2026-10-13',
    status: 'generated',
    summary: { date: '2026-10-13', brief_mode: 'solo_coach', narrative: `Good morning, Jordan. ${BODY}`, generated_by: 'ai', action_items: items },
    ...over,
  };
}
const pending = (): CoachBrief => ({ id: 'b-1', brief_date: '2026-10-13', status: 'pending', summary: null });
const rowLabels = (s: Awaited<ReturnType<typeof render>>) =>
  s.queryAllByTestId(/^brief-row-/).map((r) => r.props.accessibilityLabel as string);

beforeEach(() => {
  jest.clearAllMocks();
  mockReduced = true;
  mockMarkRead.mockResolvedValue(undefined);
});
// No fake timers (they can deadlock React 19 here, see CreditPackCheckoutScreen.SuccessReceipt.test.tsx):
// hold timers of one length instead, the 5 s polls or the 16 ms that ends a native animation in jest.
const realSetTimeout = global.setTimeout;
let held: Array<() => void> = [];
function hold(ms: number) {
  held = [];
  const fake = (cb: () => void, wait?: number) => {
    if (wait === ms) {
      held.push(cb);
      return 0;
    }
    return realSetTimeout(cb, wait);
  };
  Object.assign(global, { setTimeout: fake });
}
async function nextPoll() {
  await waitFor(() => expect(held).toHaveLength(1));
  await act(async () => {
    held.shift()?.();
  });
}
const DOTS = { includeHiddenElements: true };
afterEach(() => Object.assign(global, { setTimeout: realSetTimeout }));

describe('CoachBriefLightScreen: busy', () => {
  it('one of each kind: messages and weight, then Thank you, Roman', async () => {
    mockToday.mockResolvedValue(brief([client('checkin_missing', 2), client('weight_flag', 0, 'Maya Chen'), client('message_unread', 0)]));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByText(BODY)).toBeTruthy());
    expect(s.getByText('Good morning, Jordan.').props.accessibilityRole).toBe('header');
    expect(s.getByText('Where would you like to start?')).toBeTruthy();
    expect(rowLabels(s)).toEqual(['Reply to Sarah', 'Review Maya\u2019s weight change', 'Thank you, Roman']);
    expect(s.getByTestId('brief-row-messages').props.accessibilityHint).toBe('Opens the screen for this item');
    expect(s.getByTestId('brief-row-out').props.accessibilityHint).toBe('Closes today\u2019s brief.');
    expect(s.getByTestId('brief-roman').props.accessibilityLabel).toMatch(/^Roman, \w+day, \w+ \d+$/);
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    expect(HapticService.softImpact).not.toHaveBeenCalled();

    await fireEvent.press(s.getByTestId('brief-row-messages'));
    expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockTab).toHaveBeenCalledWith('ClientsStack', {
      screen: 'ClientMessages', params: { clientId: 'message_unread-0', clientName: 'Sarah Lin' }, initial: false,
    });
  });

  it('six weight changes: one "See weight logs" row that opens all six', async () => {
    mockToday.mockResolvedValue(brief(six('weight_flag')));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByTestId('brief-row-weight')).toBeTruthy());
    expect(rowLabels(s)).toEqual(['See weight logs', 'Thank you, Roman']);
    expect(s.getByTestId('brief-row-weight').props.accessibilityHint).toBe('Opens the full list');
    await fireEvent.press(s.getByTestId('brief-row-weight'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachBriefList', { kind: 'weight', items: six('weight_flag') });
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('six messages and one weight change: "See messages", then Maya', async () => {
    mockToday.mockResolvedValue(brief([...six('message_unread'), client('weight_flag', 0, 'Maya Chen')]));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(rowLabels(s)).toEqual(['See messages', 'Review Maya\u2019s weight change', 'Thank you, Roman']));
    await fireEvent.press(s.getByTestId('brief-row-messages'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachBriefList', { kind: 'messages', items: six('message_unread') });
  });

  it('head coach: the business lines and the way out only', async () => {
    mockToday.mockResolvedValue(brief([{ type: 'dunning_queue', detail: '1 failed payment', priority: 1 }, { type: 'team_performance', detail: 'x', priority: 3 }]));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByText(BODY)).toBeTruthy());
    expect(rowLabels(s)).toEqual(['Thank you, Roman']);
    expect(s.queryByText('Where would you like to start?')).toBeNull();
  });
});

describe('CoachBriefLightScreen: quiet, preparing, failures', () => {
  it('quiet: the words and Thank you, Roman, which closes onto Home', async () => {
    mockToday.mockResolvedValue(brief([]));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByText(BODY)).toBeTruthy());
    expect(s.queryByText('Where would you like to start?')).toBeNull();
    expect(rowLabels(s)).toEqual(['Thank you, Roman']);
    await fireEvent.press(s.getByTestId('brief-row-out'));
    expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockTab).toHaveBeenCalledWith('ClientsStack', undefined);
  });

  it('preparing: checks every 5 s, then shows the brief and announces it once', async () => {
    hold(5_000);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    mockToday.mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending()).mockResolvedValue(brief([]));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByText('Today\u2019s brief is still being prepared. It appears here in a moment.')).toBeTruthy());
    expect(s.getByText('Good morning, Jordan.')).toBeTruthy();
    expect(s.getByTestId('brief-dots', DOTS)).toBeTruthy();
    expect(rowLabels(s)).toEqual(['Continue']);
    await nextPoll();
    await nextPoll();
    await waitFor(() => expect(s.getByText(BODY)).toBeTruthy());
    expect(mockToday).toHaveBeenCalledTimes(3);
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Today\u2019s brief is ready.');
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
  });

  it('preparing for over a minute: stops checking and offers Try again', async () => {
    hold(5_000);
    mockToday.mockResolvedValue(pending());
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByTestId('brief-dots', DOTS)).toBeTruthy());
    for (let i = 0; i < 12; i += 1) await nextPoll();
    await waitFor(() => expect(s.queryByTestId('brief-dots', DOTS)).toBeNull());
    expect(mockToday).toHaveBeenCalledTimes(12);
    expect(rowLabels(s)).toEqual(['Try again', 'Continue']);
  });

  it('could not load: Try again, and one error haptic only when it fails again', async () => {
    mockToday.mockRejectedValue(new Error('offline'));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByText('Today\u2019s brief could not load. Check the connection, then try again.')).toBeTruthy());
    expect(rowLabels(s)).toEqual(['Try again', 'Continue']);
    expect(HapticService.error).not.toHaveBeenCalled();
    await fireEvent.press(s.getByTestId('brief-row-retry'));
    expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(HapticService.error).toHaveBeenCalledTimes(1));
    expect(mockMarkRead).not.toHaveBeenCalled();
  });

  it('could not be prepared: Prepare again builds it', async () => {
    mockToday.mockResolvedValue(brief([], { status: 'failed', summary: null }));
    mockRegenerate.mockResolvedValue(brief([]));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByText('Today\u2019s brief could not be prepared. Tap Prepare again to build it from the latest activity.')).toBeTruthy());
    expect(rowLabels(s)).toEqual(['Prepare again', 'Continue']);
    await fireEvent.press(s.getByTestId('brief-row-prepare'));
    await waitFor(() => expect(s.getByText(BODY)).toBeTruthy());
    expect(HapticService.error).not.toHaveBeenCalled();
  });

  it('prepared too often this hour: says so and keeps a way out', async () => {
    mockToday.mockResolvedValue(brief([], { status: 'failed', summary: null }));
    mockRegenerate.mockRejectedValue(new CoachBriefApiError('throttled', 'limit'));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByTestId('brief-row-prepare')).toBeTruthy());
    await fireEvent.press(s.getByTestId('brief-row-prepare'));
    await waitFor(() => expect(s.getByText('Today\u2019s brief was prepared several times this hour. It can be prepared again within the hour.')).toBeTruthy());
    expect(rowLabels(s)).toEqual(['Try again', 'Continue']);
    expect(HapticService.error).toHaveBeenCalledTimes(1);
    await fireEvent.press(s.getByTestId('brief-row-out'));
    expect(mockTab).toHaveBeenCalledWith('ClientsStack', undefined);
  });
});

describe('CoachBriefLightScreen: reveal', () => {
  it('rows take no tap while hidden; a tap anywhere completes the reveal', async () => {
    hold(16);
    mockReduced = false;
    mockToday.mockResolvedValue(brief([client('message_unread', 0)]));
    const s = await render(<CoachBriefLightScreen />);
    await waitFor(() => expect(s.getByTestId('brief-row-messages')).toBeTruthy());
    await fireEvent.press(s.getByTestId('brief-row-messages'));
    expect(mockTab).not.toHaveBeenCalled();
    await fireEvent(s.getByTestId('brief-light'), 'touchStart');
    await fireEvent.press(s.getByTestId('brief-row-messages'));
    expect(mockTab).toHaveBeenCalledTimes(1);
  });
});
