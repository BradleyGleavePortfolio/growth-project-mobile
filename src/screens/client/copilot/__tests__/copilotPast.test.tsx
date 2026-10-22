import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { COPILOT_PATHS, copilotApi } from '../../../../api/copilotApi';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';
import { queryClient } from '../../../../services/queryClient';
import { romanChatsEvents } from '../../../settings/romanChatsEvents';
import { COPILOT_QUESTIONS_KEY } from '../PastQuestions';
import { copilotAnswerKey, dropErasedCopilot } from '../copilotErasure';

const mockPush = jest.fn();
const mockDispatch = jest.fn();
let mockParams: Record<string, unknown> | undefined;
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../../../api/romanApi', () => ({ ROMAN_MESSAGE_MAX_LENGTH: 4000, RomanApiError: class extends Error {}, openOrResumeSession: jest.fn(), sendMessage: jest.fn() }));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../../../../api/schedulingApi', () => ({ resolveClientTimezone: () => 'UTC' }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ name: 'Alex Rivera' }] }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn(), push: mockPush, dispatch: mockDispatch }), useRoute: () => ({ key: 'answer-1', params: mockParams }),
  CommonActions: { reset: (s: unknown) => ({ type: 'RESET', payload: s }), goBack: () => ({ type: 'GO_BACK' }) } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// resetAllMocks empties the native AccessibilityInfo probe; the shared hook is not what these tests read.
jest.mock('../../wearables/components/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({ __esModule: true, default: () => null, useClientNeedsCoach: () => false }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

const get = jest.mocked(api.get);
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const Q = (id: string, question: string | null, asked_at: string, outcome: string | null = null) => ({ question, asked_at, session_id: 'sess-1', message_id: id, outcome });
const PAGE1 = { total: 186, since: '2025-10-02T09:00:00Z', next_cursor: 'c2', items: [
  Q('m1', 'Why did my weight go up after Saturday?', '2026-10-18T09:00:00Z'),
  Q('m2', 'Can I swap Thursday for Friday?', '2026-10-15T09:00:00Z', 'approved'),
  Q('m3', 'Should I add a fifth day?', '2026-09-29T09:00:00Z', 'rejected'),
  Q('m4', null, '2026-09-28T09:00:00Z'),
  { question: 'broken', asked_at: 'never' },
] };
const PAGE2 = { total: 186, since: PAGE1.since, next_cursor: null, items: [Q('m9', 'How was my week', '2026-08-23T09:00:00Z')] };
const route = (pages: unknown[], other: unknown = { data: { week: null, suggestions: [] } }) =>
  get.mockImplementation((async (url: string, cfg?: { params?: { cursor?: string } }) =>
    (url === COPILOT_PATHS.questions ? { data: pages[cfg?.params?.cursor ? 1 : 0] } : other)) as never);

beforeEach(() => { jest.resetAllMocks(); mockParams = undefined; });

test('the reads: past questions page by cursor, an older server (404) is null, and one answer comes back with its facts', async () => {
  route([PAGE1, PAGE2]);
  const p = await copilotApi.questions();
  expect(p).toMatchObject({ total: 186, since: PAGE1.since, nextCursor: 'c2' });
  expect(p?.items.map((i) => [i.messageId, i.outcome])).toEqual([['m1', null], ['m2', 'approved'], ['m3', 'rejected'], ['m4', null]]);
  expect((await copilotApi.questions('c2'))?.nextCursor).toBeNull();
  expect(get).toHaveBeenLastCalledWith(COPILOT_PATHS.questions, { params: { cursor: 'c2' } });
  get.mockRejectedValueOnce(Object.assign(new Error('http'), { response: { status: 404, data: {} } }));
  expect(await copilotApi.questions()).toBeNull();
  get.mockResolvedValueOnce({ data: { messages: [{ id: 'm2', role: 'assistant', content: 'Friday works [1].', copilot: { sources: [{ n: 1, kind: 'plan', label: 'Rest day on Fri 23 Oct' }], suggestion: null } }] } } as never);
  expect(await copilotApi.answer('sess-1', 'm2')).toEqual({ text: 'Friday works [1].', reply: { sources: [{ n: 1, kind: 'plan', label: 'Rest day on Fri 23 Oct', detail: null }], suggestion: null } });
  expect(get).toHaveBeenLastCalledWith('/roman/sessions/sess-1/messages', { params: { limit: 100 }, headers: { 'x-roman-copilot': '1' } });
  get.mockResolvedValueOnce({ data: { messages: [] } } as never);
  expect(await copilotApi.answer('sess-1', 'gone')).toBeNull();
});

test('Your path shows the Past questions row with the total, and it opens the list', async () => {
  route([PAGE1]);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByText('Past questions')).toBeTruthy();
  expect(s.getByText('186')).toBeTruthy();
  await act(async () => fireEvent.press(s.getByTestId('copilot-past-row')));
  expect(mockPush).toHaveBeenCalledWith('Copilot', { view: 'questions' });
});

test('the list groups by month with outcomes, pages older questions, and a row opens its answer', async () => {
  mockParams = { view: 'questions' };
  route([PAGE1, PAGE2]);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByText('186 questions since Oct 2025')).toBeTruthy();
  expect(s.getByText('October 2026')).toBeTruthy();
  expect(s.getByText('September 2026')).toBeTruthy();
  expect(s.getByText('Approved by your coach')).toBeTruthy();
  // The server does not say who declined, and it may have been an earlier coach: never today's coach by name (C1).
  expect(s.getByText('Your coach kept your plan as it is')).toBeTruthy();
  expect(s.queryByText('Alex kept your plan as it is')).toBeNull();
  expect(s.queryByText('broken')).toBeNull();
  await act(async () => fireEvent.press(s.getByText('Show older questions')));
  expect(await s.findByText('How was my week')).toBeTruthy();
  expect(s.queryByText('Show older questions')).toBeNull();
  await act(async () => fireEvent.press(s.getByText('Can I swap Thursday for Friday?')));
  expect(mockPush).toHaveBeenCalledWith('Copilot', { view: 'answer', item: expect.objectContaining({ sessionId: 'sess-1', messageId: 'm2' }) });
});

test('one past answer reads back from its chat with the facts Roman used', async () => {
  mockParams = { view: 'answer', item: { question: 'Can I swap Thursday for Friday?', askedAt: '2026-10-15T14:33:00Z', sessionId: 'sess-1', messageId: 'm2', outcome: 'approved' } };
  get.mockResolvedValueOnce({ data: { messages: [{ id: 'm2', content: 'Friday works [1]. Saturday trains other muscles.', copilot: { sources: [{ n: 1, kind: 'workout_log', label: '7 of 8 sessions done' }], suggestion: null } }] } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByText('Friday works.')).toBeTruthy();
  expect(s.getByText('Can I swap Thursday for Friday?')).toBeTruthy();
  expect(s.getByText('You asked · Thu 15 Oct, 2:33 PM')).toBeTruthy();
  expect(s.getByText('Workout log')).toBeTruthy();
});

const ITEM = { question: 'Can I swap Thursday for Friday?', askedAt: '2026-10-15T14:33:00Z', sessionId: 'sess-1', messageId: 'm2', outcome: 'rejected' };
const ANSWER = { text: 'Friday works.', reply: null };

test('an erased chat leaves the cache: its answers go, other chats stay, Delete all takes every answer, the list reads again', () => {
  const qc = new QueryClient();
  qc.setQueryData(copilotAnswerKey('sess-1', 'm2'), ANSWER);
  qc.setQueryData(copilotAnswerKey('sess-2', 'm7'), ANSWER);
  qc.setQueryData(COPILOT_QUESTIONS_KEY, { pages: [PAGE1], pageParams: [undefined] });
  dropErasedCopilot(qc, 'sess-1');
  expect(qc.getQueryData(copilotAnswerKey('sess-1', 'm2'))).toBeUndefined();
  expect(qc.getQueryData(copilotAnswerKey('sess-2', 'm7'))).toEqual(ANSWER);
  expect(qc.getQueryData(COPILOT_QUESTIONS_KEY)).toBeUndefined();
  dropErasedCopilot(qc, null);
  expect(qc.getQueryData(copilotAnswerKey('sess-2', 'm7'))).toBeUndefined();
});

test('Settings erasing a chat clears the app cache with no Copilot screen open (Delete, Delete all, and gone)', () => {
  queryClient.setQueryData(copilotAnswerKey('sess-1', 'm2'), ANSWER);
  queryClient.setQueryData(copilotAnswerKey('sess-2', 'm7'), ANSWER);
  queryClient.setQueryData(COPILOT_QUESTIONS_KEY, { pages: [PAGE1], pageParams: [undefined] });
  romanChatsEvents.emitErased({ id: 'sess-1' });
  expect(queryClient.getQueryData(copilotAnswerKey('sess-1', 'm2'))).toBeUndefined();
  expect(queryClient.getQueryData(copilotAnswerKey('sess-2', 'm7'))).toEqual(ANSWER);
  expect(queryClient.getQueryData(COPILOT_QUESTIONS_KEY)).toBeUndefined();
  romanChatsEvents.emitGone({ ownerId: 'u1', epoch: 1, id: 'sess-2' });
  expect(queryClient.getQueryData(copilotAnswerKey('sess-2', 'm7'))).toBeUndefined();
  queryClient.setQueryData(copilotAnswerKey('sess-3', 'm8'), ANSWER);
  romanChatsEvents.emitErased({ id: null });
  expect(queryClient.getQueryData(copilotAnswerKey('sess-3', 'm8'))).toBeUndefined();
  queryClient.clear();
});

test('an open past answer takes only its own route off the stack when its chat is erased, and is never saved to the phone', async () => {
  mockParams = { view: 'answer', item: ITEM };
  get.mockResolvedValueOnce({ data: { messages: [{ id: 'm2', content: 'Friday works.', copilot: { sources: [], suggestion: null } }] } } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const s = await render(<QueryClientProvider client={qc}>{<ClientPathCopilotScreen />}</QueryClientProvider>);
  expect(await s.findByText('Friday works.')).toBeTruthy();
  expect(qc.getQueryCache().find({ queryKey: copilotAnswerKey('sess-1', 'm2') })?.meta).toEqual({ persist: false });
  await act(async () => romanChatsEvents.emitErased({ id: 'sess-other' }));
  expect(mockDispatch).not.toHaveBeenCalled();
  await act(async () => romanChatsEvents.emitErased({ id: 'sess-1' }));
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  const stack = { key: 'more', index: 3, routes: [{ key: 'path' }, { key: 'questions' }, { key: 'answer-1' }, { key: 'settings' }] };
  const action = mockDispatch.mock.calls[0][0](stack);
  expect(action).toEqual({ type: 'RESET', payload: { ...stack, index: 2, routes: [{ key: 'path' }, { key: 'questions' }, { key: 'settings' }] } });
  await act(async () => romanChatsEvents.emitErased({ id: null }));
  expect(mockDispatch).toHaveBeenCalledTimes(2);
});

test('a past answer the server no longer has (404) is not drawn, and a declined change there never names today\'s coach', async () => {
  mockParams = { view: 'answer', item: ITEM };
  get.mockRejectedValueOnce(Object.assign(new Error('http'), { response: { status: 404, data: {} } }));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByTestId('copilot-answer-error')).toBeTruthy();
  expect(s.queryByText('Friday works.')).toBeNull();
  const declined = { id: 'sg1', status: 'rejected', change: { kind: 'set_calorie_target', target_id: 't1', from_kcal: 2600, to_kcal: 2450 }, reason: 'r', note: null, sent_at: '2026-10-15T14:34:00Z', decided_at: '2026-10-16T10:00:00Z' };
  get.mockResolvedValueOnce({ data: { messages: [{ id: 'm2', content: 'Fewer calories.', copilot: { sources: [], suggestion: declined } }] } } as never);
  const t = await render(wrap(<ClientPathCopilotScreen />));
  expect(await t.findByText('Your coach kept your plan as it is')).toBeTruthy();
  expect(t.queryByText(/Alex/)).toBeNull();
});
