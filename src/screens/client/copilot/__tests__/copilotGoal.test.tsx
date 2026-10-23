import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { openOrResumeSession, RomanApiError, sendMessage } from '../../../../api/romanApi';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';

const mockText = (t: string) => <Text>{t}</Text>;
let mockNeedsCoach = false;
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../../../api/romanApi', () => {
  class RomanApiError extends Error {
    readonly kind: string;
    readonly turnStored: boolean;
    constructor(mockKind: string, message: string, _r?: number, _f?: unknown, stored = false) { super(message); this.kind = mockKind; this.turnStored = stored; }
  }
  class RomanWireError extends Error {}
  return { ROMAN_MESSAGE_MAX_LENGTH: 4000, RomanApiError, RomanWireError, openOrResumeSession: jest.fn(), sendMessage: jest.fn() };
});
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../../../../api/schedulingApi', () => ({ resolveClientTimezone: () => 'UTC' }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ name: 'Alex Rivera' }] }) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }), useRoute: () => ({ params: undefined }), NavigationContext: jest.requireActual('react').createContext(null),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../../components/roman/RomanTypingIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/roman/RomanCrisisActions', () => ({ __esModule: true, default: () => mockText('crisis buttons') }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({
  __esModule: true, default: ({ title }: { title: string }) => mockText(title), useClientNeedsCoach: () => mockNeedsCoach,
  ROMAN_LOCK_TITLE: 'Roman works with a coach', ROMAN_LOCK_BODY: 'lock body',
}));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1', role: 'student' }) }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

const get = jest.mocked(api.get);
const open = jest.mocked(openOrResumeSession);
const send = jest.mocked(sendMessage);
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const WEEK = { number: 3, coach_first_name: 'Alex', target: { kcal: 2150, from: new Date().toISOString(), previous_kcal: 2300 }, workouts: { done: 1, total: 4 }, last_check_in: '2026-10-18' };
const FACTS = [
  { n: 1, kind: 'plan', label: 'Target 2,150 kcal from Mon 19 Oct, set by Alex', detail: 'Was 2,300 kcal' },
  { n: 2, kind: 'check_in', label: '71.4 kg on Sun 18 Oct', detail: '71.6 kg on Sun 4 Oct' },
];

beforeEach(() => {
  jest.resetAllMocks();
  mockNeedsCoach = false;
  open.mockResolvedValue({ id: 'sess-1' } as never);
});

// GOAL style A (Opus B-G1..B-G4, Sol B-851-G2/G3 on m#851): quick chips after an answer, limits inline, the composer.

test('after an answer the starters not asked yet stay as chips; the disclaimer sits in the page, not under the field', async () => {
  get.mockResolvedValue({ data: { week: { ...WEEK, target: { ...WEEK.target, from: '2020-01-06T00:00:00Z' } }, suggestions: [] } } as never);
  send.mockResolvedValueOnce({ text: 'Your target is 2,150 kcal [1]. It held this week.', messageId: 'm1', interrupted: false,
    copilot: { sources: FACTS, suggestion: null } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect((await s.findByTestId('copilot-footer')).props.children).toBe('Workout and food guidance only. Not medical advice.');
  expect(s.queryByTestId('roman-composer-footer')).toBeNull();
  expect(s.queryByTestId('copilot-more')).toBeNull();
  await act(async () => fireEvent.press(s.getByText('Explain my targets')));
  // No change offered: the full answer, serif lead and facts (frame 03).
  expect(s.getByTestId('copilot-lead').props.children).toBe('Your target is 2,150 kcal.');
  expect(s.getByText('From your data')).toBeTruthy();
  expect(s.getByTestId('copilot-more-0')).toBeTruthy();
  expect(s.queryByTestId('copilot-more-1')).toBeNull();
  send.mockResolvedValueOnce({ text: 'A good week.', messageId: 'm2', interrupted: false, copilot: { sources: [], suggestion: null } } as never);
  await act(async () => fireEvent.press(s.getByText('How was my week')));
  expect(send).toHaveBeenLastCalledWith('sess-1', 'How was my week', { copilot: true });
  expect(s.queryByTestId('copilot-more')).toBeNull();
});

test('the daily cap is an inline card with main\u2019s words; credits out is one plain line; neither leaves chips, both keep the composer', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  const resetsAt = new Date(Date.now() + 60 * 60 * 1000);
  send.mockRejectedValueOnce(Object.assign(new RomanApiError('dailyCap', 'cap'), { dailyCap: { resetsAt } }));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getByTestId('copilot-turn-dailyCap-title').props.children).toBe("You've used your maximum AI allotment today.");
  expect(s.getByText(/^AI help resets (today|tomorrow) at /)).toBeTruthy();
  expect(s.queryByText('OK')).toBeNull();
  expect(s.queryByTestId('copilot-more')).toBeNull();
  // Crisis turns skip the server's limits, so the composer stays (aiDailyCap.ts header; roman.controller assertCoachPoolOpen).
  expect(s.getByPlaceholderText('Ask Roman anything.')).toBeTruthy();
  send.mockRejectedValueOnce(new RomanApiError('poolEmpty', 'pool'));
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'And next week?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByText(/^Your coach's AI credits for this month are used up/)).toBeTruthy();
  expect(s.queryByTestId('copilot-turn-poolEmpty-title')).toBeNull();
  expect(s.queryByTestId('copilot-more')).toBeNull();
  expect(s.queryByText('Try again')).toBeNull();
});

test('AI help off is Roman\u2019s card with main\u2019s words and the full Allow AI help action', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  send.mockRejectedValueOnce(Object.assign(new RomanApiError('aiRefused', 'refused'), { refusal: { kind: 'consent_required' } }));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getByTestId('copilot-ai-refusal-title').props.children).toBe('AI help is off');
  expect(s.getByText(/^Roman cannot use your information because AI help is not on for your account\./)).toBeTruthy();
  expect(s.getByTestId('copilot-ai-refusal-allow')).toBeTruthy();
  expect(s.queryByTestId('copilot-more')).toBeNull();
});
