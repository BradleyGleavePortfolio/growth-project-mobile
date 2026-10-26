import React from 'react';
import { ScrollView, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { openOrResumeSession, RomanApiError, RomanWireError, sendMessage } from '../../../../api/romanApi';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';
import { romanChatsEvents } from '../../../settings/romanChatsEvents';
import { ROMAN_AI_ON_ASK_AGAIN } from '../../../../components/roman/romanVoice';

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
  ROMAN_LOCK_TITLE: 'Roman works with a coach', ROMAN_LOCK_BODY: 'lock body', JOIN_A_COACH: 'Join a coach',
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
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'Can I move Thursday?'));
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
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'And next week?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByText('Roman works with a coach')).toBeTruthy();
  await s.unmount();
  mockNeedsCoach = true;
  const c = await render(wrap(<ClientPathCopilotScreen />));
  expect(c.getByText('Roman works with a coach')).toBeTruthy();
  expect(open).toHaveBeenCalledTimes(1);
});

test('a question the server already stored is never re-sent: main\u2019s stored line, no Try again, the question back in the composer', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  send.mockRejectedValueOnce(new RomanApiError('generic', 'stream cut', undefined, undefined, true));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.changeText(await s.findByPlaceholderText('Ask Roman anything.'), 'Can I swap Friday?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByText('Your message is saved above, but I could not answer it. Tap Send again to ask once more.')).toBeTruthy();
  expect(s.queryByText('Try again')).toBeNull();
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe('Can I swap Friday?');
  expect(send).toHaveBeenCalledTimes(1);
  send.mockRejectedValueOnce(new RomanWireError('bad frame'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getAllByText('Your message is saved above, but I could not answer it. Tap Send again to ask once more.')).toHaveLength(2);
  expect(s.queryByText('Try again')).toBeNull();
});

test('a follow-up scrolls its question to the top, keeps following its answer, and a suggestion under an answer is not listed twice', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  const pending = { ...SUGGESTED, id: 's10', status: 'pending', sent_at: '2026-10-21T21:34:00Z' };
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [pending] } } as never);
  send.mockResolvedValueOnce({ text: 'First.', messageId: 'm5', interrupted: false, copilot: { sources: [], suggestion: pending } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  const sv = await s.findByTestId('copilot-scroll');
  await act(async () => fireEvent(sv, 'layout', { nativeEvent: { layout: { height: 600 } } }));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getAllByText('Awaiting coach approval')).toHaveLength(1);
  let answer: (v: unknown) => void = () => undefined;
  send.mockReturnValueOnce(new Promise((r) => { answer = r; }) as never);
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'And next week?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  const turns = s.getAllByTestId('copilot-turn');
  expect(turns).toHaveLength(2);
  await act(async () => fireEvent(sv, 'contentSizeChange', 390, 1400));
  await act(async () => fireEvent(turns[1], 'layout', { nativeEvent: { layout: { y: 900 } } }));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 800, animated: true });
  await act(async () => fireEvent(sv, 'contentSizeChange', 390, 2000));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 888, animated: true });
  await act(async () => answer({ text: 'Next week.', messageId: 'm6', interrupted: false, copilot: { sources: [], suggestion: null } }));
  await act(async () => fireEvent(sv, 'contentSizeChange', 390, 2400));
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 888, animated: true });
  const calls = scrollTo.mock.calls.length;
  await act(async () => fireEvent(sv, 'contentSizeChange', 390, 2600));
  expect(scrollTo).toHaveBeenCalledTimes(calls);
  scrollTo.mockRestore();
});

const ANSWER = (text: string) => ({ text, messageId: text, interrupted: false, copilot: { sources: [], suggestion: null } }) as never;

test.each([
  ['Delete on its row', () => romanChatsEvents.emitErased({ id: 'sess-1' })],
  ['Delete in its transcript', () => romanChatsEvents.emitGone({ ownerId: 'u1', epoch: 1, id: 'sess-1' })],
  ['Delete all', () => romanChatsEvents.emitErased({ id: null })],
])('%s erases the held chat from Your path; the next question opens a fresh chat (B-851-R2-S1)', async (_name, erase) => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  open.mockResolvedValueOnce({ id: 'sess-1' } as never).mockResolvedValueOnce({ id: 'sess-2' } as never);
  send.mockResolvedValueOnce(ANSWER('Your target is 2,150 kcal.'));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  send.mockRejectedValueOnce(new RomanApiError('generic', 'stream cut', undefined, undefined, true));
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'Can I swap Friday?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe('Can I swap Friday?');
  await act(async () => romanChatsEvents.emitErased({ id: 'another-chat' }));
  expect(s.getByText('Your target is 2,150 kcal.')).toBeTruthy();
  await act(async () => erase());
  expect(s.queryByText('Your target is 2,150 kcal.')).toBeNull();
  expect(s.queryByText('Can I swap Friday?')).toBeNull();
  expect(s.queryAllByTestId('copilot-turn')).toHaveLength(0);
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe('');
  expect(s.getByTestId('copilot-ask')).toBeTruthy();
  send.mockResolvedValueOnce(ANSWER('A fresh answer.'));
  await act(async () => fireEvent.press(s.getByText('Explain my targets')));
  expect(open).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenLastCalledWith('sess-2', 'Explain my targets', { copilot: true });
  expect(s.getByText('A fresh answer.')).toBeTruthy();
  expect(s.getAllByTestId('copilot-turn')).toHaveLength(1);
});

test('a wait, a daily cap or used-up credits offer no Try again: the question goes back in the composer; list lines get bullets', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  send.mockRejectedValueOnce(Object.assign(new RomanApiError('rateLimited', '429'), { retryAfterSeconds: 30 }));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getByText('A moment, if you would. Send your next message in about 30 seconds.')).toBeTruthy();
  expect(s.queryByText('Try again')).toBeNull();
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe('Explain my targets');
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), ''));
  send.mockRejectedValueOnce(new RomanApiError('dailyCap', 'cap'));
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'And next week?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe('And next week?');
  send.mockResolvedValueOnce({ text: 'Two things.\n- Eat more protein.\n* Sleep by 11.', messageId: 'm9', interrupted: false } as never);
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByText(/^Two things\.\s+\u2022 Eat more protein\.\s+\u2022 Sleep by 11\.$/)).toBeTruthy();
  expect(send).toHaveBeenCalledTimes(3);
});

test('a stored question refused for AI help: the real Allow grant shows the ask-again line, sends nothing more, and keeps the question', async () => {
  const copy = { version: 'v6', paragraph: { text: 'Consent words.', sha256: 'a'.repeat(64) }, box_label: { text: 'Allow AI help', sha256: 'b'.repeat(64) }, sha256: 'c'.repeat(64) };
  const off = { granted: false, state: 'not_granted', version: null, granted_at: null, withdrawn_at: null, current_version: 'v6', needs_reconsent: false, copy };
  get.mockImplementation(async (url: string) => ({ data: url === '/me/ai-consent' ? off : { week: WEEK, suggestions: [] } }) as never);
  jest.mocked(api.post).mockResolvedValue({ data: { ...off, granted: true, state: 'granted', version: 'v6', granted_at: '2026-10-22T21:41:00Z' } } as never);
  send.mockRejectedValueOnce(Object.assign(new RomanApiError('aiRefused', 'refused', undefined, undefined, true), { refusal: { kind: 'consent_required' } }));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.changeText(await s.findByPlaceholderText('Ask Roman anything.'), 'Can I swap Friday?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  await act(async () => fireEvent.press(s.getByTestId('copilot-ai-refusal-allow')));
  await act(async () => fireEvent.press(await s.findByTestId('copilot-ai-refusal-consent-sheet-allow')));
  expect(jest.mocked(api.post)).toHaveBeenCalledWith('/me/ai-consent/roman', expect.anything(), expect.anything());
  expect(await s.findByText(ROMAN_AI_ON_ASK_AGAIN)).toBeTruthy();
  expect(s.queryByTestId('copilot-ai-refusal')).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe('Can I swap Friday?');
});
