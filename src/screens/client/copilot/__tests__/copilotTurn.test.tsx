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
    constructor(public kind: string, message: string) { super(message); }
  }
  return { ROMAN_MESSAGE_MAX_LENGTH: 4000, RomanApiError, openOrResumeSession: jest.fn(), sendMessage: jest.fn() };
});
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../../../../api/schedulingApi', () => ({ resolveClientTimezone: () => 'UTC' }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ name: 'Alex Rivera' }] }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../../components/roman/RomanTypingIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/roman/RomanCrisisActions', () => ({ __esModule: true, default: () => mockText('crisis buttons') }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({
  __esModule: true, default: ({ title }: { title: string }) => mockText(title), useClientNeedsCoach: () => mockNeedsCoach,
  ROMAN_LOCK_TITLE: 'Roman works with a coach', ROMAN_LOCK_BODY: 'lock body',
}));
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

const get = jest.mocked(api.get);
const open = jest.mocked(openOrResumeSession);
const send = jest.mocked(sendMessage);
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const WEEK = { number: 3, coach_first_name: 'Alex', target: { kcal: 2150, from: new Date().toISOString(), previous_kcal: 2300 }, workouts: { done: 1, total: 4 }, last_check_in: '2026-10-18' };
const MOVE = { kind: 'move_session', assignment_id: 'a1', workout: 'Lower body B', from_at: '2026-10-22T17:00:00Z', to_at: '2026-10-23T17:00:00Z',
  sources: [{ n: 1, kind: 'plan', label: 'Lower body B on Thu 22 Oct', detail: null }] };
const SUGGESTED = { id: 's9', status: 'suggested', change: MOVE, reason: 'Friday is a rest day.', note: null, sent_at: null, decided_at: null };
const FACTS = [
  { n: 1, kind: 'plan', label: 'Target 2,150 kcal from Mon 19 Oct, set by Alex', detail: 'Was 2,300 kcal' },
  { n: 2, kind: 'check_in', label: '71.4 kg on Sun 18 Oct', detail: '71.6 kg on Sun 4 Oct' },
];

beforeEach(() => {
  jest.resetAllMocks();
  mockNeedsCoach = false;
  open.mockResolvedValue({ id: 'sess-1' } as never);
});

test('the week block draws the server week, and a change this week offers its own question', async () => {
  get.mockResolvedValueOnce({ data: { week: WEEK, suggestions: [] } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByText('Week 3 with Alex')).toBeTruthy();
  expect(s.getByText('2,150')).toBeTruthy();
  expect(s.getByText(/^Changed \w{3}$/)).toBeTruthy();
  expect(s.getByText('1 of 4')).toBeTruthy();
  expect(s.getByText('18 Oct')).toBeTruthy();
  expect(s.getByText('Why did my calories change this week?')).toBeTruthy();
  expect(s.getByText('Roman answers from your plan, check-ins and logs. Changes go to Alex first.')).toBeTruthy();
});

test('a question goes through Roman with the Copilot header; the answer shows its facts and the suggestion card', async () => {
  get.mockResolvedValue({ data: { week: { ...WEEK, target: { ...WEEK.target, from: '2020-01-06T00:00:00Z' } }, suggestions: [] } } as never);
  send.mockResolvedValueOnce({ text: 'Friday works [1]. Saturday trains other muscles [2].', messageId: 'm1', interrupted: false,
    copilot: { sources: FACTS, suggestion: SUGGESTED } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByText('Explain my targets')).toBeTruthy();
  expect(s.queryByText('Why did my calories change this week?')).toBeNull();
  await act(async () => fireEvent.press(s.getByText('Explain my targets')));
  expect(open).toHaveBeenCalledWith('client');
  expect(send).toHaveBeenCalledWith('sess-1', 'Explain my targets', { copilot: true });
  expect(s.getByTestId('copilot-lead').props.children).toBe('Friday works.');
  expect(s.getByText('Saturday trains other muscles.')).toBeTruthy();
  expect(s.getByText('From your data')).toBeTruthy();
  expect(s.getByText(FACTS[1].label)).toBeTruthy();
  expect(s.getByText('Check-in')).toBeTruthy();
  expect(s.getByText('Send to Alex')).toBeTruthy();
  expect(s.getByTestId('copilot-suggestion-tags')).toBeTruthy();
  expect(s.getByText('2,150 kcal target')).toBeTruthy();
  expect(s.queryByTestId('copilot-ask')).toBeNull();
});

test('an older server (404, no copilot field) shows the plain Roman reply; a sent suggestion shows its status line', async () => {
  get.mockRejectedValue(Object.assign(new Error('http'), { response: { status: 404, data: {} } }));
  send.mockResolvedValueOnce({ text: 'Your target is 2,150 kcal [1].', messageId: 'm2', interrupted: false } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('How was my week')));
  expect(s.getByText('Your target is 2,150 kcal [1].')).toBeTruthy();
  expect(s.queryByText('From your data')).toBeNull();
  expect(s.queryByTestId('copilot-week')).toBeNull();
  send.mockResolvedValueOnce({ text: 'Sent.', messageId: 'm3', interrupted: false, copilot: { sources: [], suggestion: { ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' } } } as never);
  fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'Can I move Thursday?');
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByText('Awaiting coach approval')).toBeTruthy();
  expect(s.queryByText('Send to Alex')).toBeNull();
});

test('a failed turn keeps the question and Try again asks it once more; no coach means Roman\u2019s lock', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  send.mockRejectedValueOnce(new RomanApiError('offline', 'offline'));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getByText('I cannot reach the service.')).toBeTruthy();
  expect(s.getByText('Explain my targets')).toBeTruthy();
  send.mockResolvedValueOnce({ text: 'Here it is.', messageId: 'm4', interrupted: false, copilot: { sources: [], suggestion: null } } as never);
  await act(async () => fireEvent.press(s.getByText('Try again')));
  expect(send).toHaveBeenNthCalledWith(2, 'sess-1', 'Explain my targets', { copilot: true });
  expect(s.getByText('Here it is.')).toBeTruthy();
  send.mockRejectedValueOnce(new RomanApiError('requiresCoach', 'no coach'));
  fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'And next week?');
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByText('Roman works with a coach')).toBeTruthy();
  await s.unmount();
  mockNeedsCoach = true;
  const c = await render(wrap(<ClientPathCopilotScreen />));
  expect(c.getByText('Roman works with a coach')).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(1);
});
