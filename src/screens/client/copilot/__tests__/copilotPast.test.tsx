import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { COPILOT_PATHS, copilotApi } from '../../../../api/copilotApi';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';
import { queryClient } from '../../../../services/queryClient';
import { romanChatsEvents } from '../../../settings/romanChatsEvents';
import { COPILOT_QUESTIONS_KEY } from '../PastQuestions';
import { copilotAnswerKey, dropErasedCopilot } from '../copilotErasure';
import { AnswerCard } from '../AnswerCard';

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

test('a failed Show older says so under the list, where the link was, and Try again reads that page again (Opus C1)', async () => {
  mockParams = { view: 'questions' };
  get.mockImplementation((async (url: string, cfg?: { params?: { cursor?: string } }) => {
    if (url !== COPILOT_PATHS.questions) return { data: { week: null, suggestions: [] } };
    if (cfg?.params?.cursor) throw Object.assign(new Error('Network Error'), { isAxiosError: true });
    return { data: PAGE1 };
  }) as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByText('186 questions since Oct 2025')).toBeTruthy();
  await act(async () => fireEvent.press(s.getByText('Show older questions')));
  const err = await s.findByTestId('copilot-past-error');
  expect(s.queryByText('Show older questions')).toBeNull();
  // Drawn after the last row, not above the list.
  type Node = { props?: { testID?: string }; children?: (Node | string)[] | null };
  const ids = (n: Node | string | null): string[] =>
    !n || typeof n === 'string' ? [] : [...(n.props?.testID ? [n.props.testID] : []), ...(n.children ?? []).flatMap(ids)];
  const order = ([] as (Node | string)[]).concat((s.toJSON() as never) ?? []).flatMap(ids);
  expect(order).toContain('copilot-past-m3');
  expect(order.indexOf('copilot-past-error')).toBeGreaterThan(order.indexOf('copilot-past-m3'));
  expect(err).toBeTruthy();
  route([PAGE1, PAGE2]);
  await act(async () => fireEvent.press(s.getByText('Try again')));
  expect(await s.findByText('How was my week')).toBeTruthy();
  expect(get).toHaveBeenLastCalledWith(COPILOT_PATHS.questions, { params: { cursor: 'c2' } });
  expect(s.queryByTestId('copilot-past-error')).toBeNull();
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

// B-852-G1: one Forest ledger card (white, cool hairline) for the row, the month groups and the answer.
const card = (el: { props: { style?: unknown } } | null) => StyleSheet.flatten(el?.props.style as never) as { backgroundColor?: string; borderColor?: string };
const LEDGER = { backgroundColor: '#FFFFFF', borderColor: '#E6E9DF' };

test('the Past questions row sits on the white Forest ledger card with the cool hairline', async () => {
  route([PAGE1]);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(card(await s.findByTestId('copilot-past-row'))).toMatchObject(LEDGER);
});

test('the month groups of past questions sit on the same white Forest ledger card', async () => {
  route([PAGE1]);
  mockParams = { view: 'questions' };
  const s = await render(wrap(<ClientPathCopilotScreen />));
  // The month group: the nearest View above its first row that paints a surface.
  let group = (await s.findByTestId('copilot-past-m1')).parent;
  while (group && !card(group).backgroundColor) group = group.parent;
  expect(card(group)).toMatchObject(LEDGER);
  expect(card(s.getByTestId('copilot-past-m2'))).toMatchObject({ borderColor: LEDGER.borderColor });
});

test('an answer and its facts sit on the same white Forest ledger card', async () => {
  const reply = { sources: [{ n: 1, kind: 'workout_log' as const, label: '7 of 8 sessions done' }], suggestion: null };
  const s = await render(<AnswerCard text="A steady week [1]." reply={reply as never} />);
  expect(card(s.getByTestId('copilot-answer'))).toMatchObject(LEDGER);
  expect(card(s.getByTestId('copilot-facts'))).toMatchObject({ borderColor: LEDGER.borderColor });
});

test('Send from a past answer reads Your path and the answer again, as a turn\'s Send does', async () => {
  mockParams = { view: 'answer', item: ITEM };
  const unsent = { id: 'sg2', status: 'suggested', change: { kind: 'set_calorie_target', target_id: 't1', from_kcal: 2600, to_kcal: 2450 }, reason: 'r', note: null, sent_at: null, decided_at: null };
  get.mockResolvedValue({ data: { messages: [{ id: 'm2', content: 'Fewer calories.', copilot: { sources: [], suggestion: unsent } }] } } as never);
  jest.mocked(api.post).mockResolvedValueOnce({ data: { ...unsent, status: 'pending', sent_at: '2026-10-21T21:41:00Z' } } as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = jest.spyOn(qc, 'invalidateQueries');
  const s = await render(<QueryClientProvider client={qc}>{<ClientPathCopilotScreen />}</QueryClientProvider>);
  await act(async () => fireEvent.press(await s.findByTestId('copilot-send')));
  expect(api.post).toHaveBeenCalledWith(COPILOT_PATHS.send('sg2'));
  expect(spy).toHaveBeenCalledWith({ queryKey: ['copilot'] });
});

// #852 round 3, B-H1: the history in style A's type and sizes (GOAL .mhs, .nav, .mhs .mini, .hist .m, .hrow, .ot).
const flat = (el: { props: { style?: unknown } } | null) => StyleSheet.flatten(el?.props.style as never) as Record<string, unknown>;

test('past questions use style A: compact forest masthead, month headings, 60-high rows and quiet outcome chips', async () => {
  route([PAGE1]);
  mockParams = { view: 'questions' };
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await s.findByTestId('copilot-past-m1');
  expect(flat(s.getByTestId('copilot-mast'))).toMatchObject({ paddingBottom: 14, borderBottomLeftRadius: 24 });
  expect(flat(s.getByTestId('copilot-mast-title'))).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 25, lineHeight: 32 });
  expect(flat(s.getByText('Your path'))).toMatchObject({ fontSize: 16, color: '#B8CCBF' });
  expect(flat(s.getByTestId('copilot-past-since'))).toMatchObject({ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.08)' });
  expect(flat(s.getByText('186 questions since Oct 2025'))).toMatchObject({ fontSize: 12.5 });
  expect(flat(s.getByText('October 2026'))).toMatchObject({ fontSize: 13, fontWeight: '600', color: '#5A5A56', paddingBottom: 8 });
  expect(flat(s.getByText('September 2026'))).toMatchObject({ paddingTop: 18 });
  expect(flat(s.getByTestId('copilot-past-m1'))).toMatchObject({ minHeight: 60, paddingVertical: 11, paddingHorizontal: 16 });
  expect(flat(s.getByText('Why did my weight go up after Saturday?'))).toMatchObject({ fontSize: 15, lineHeight: 20 });
  expect(flat(s.getByText('Sun 18 Oct'))).toMatchObject({ fontSize: 12.5, color: '#5A5A56' });
  expect(flat(s.getByTestId('copilot-past-m2-outcome'))).toMatchObject({ fontSize: 12, fontWeight: '600', borderRadius: 6, backgroundColor: '#EEF4E0', color: '#2C4A36' });
  expect(flat(s.getByTestId('copilot-past-m3-outcome'))).toMatchObject({ backgroundColor: '#F2F2EE', color: '#5A5A56' });
});

// #852 round 3, B-H2: every history read that fails is Roman's white ledger notice with a filled Try again.
const NET = () => Object.assign(new Error('Network Error'), { isAxiosError: true });
const notice = (s: { getByTestId: (id: string) => { props: { style?: unknown } } }, id: string) => {
  expect(flat(s.getByTestId(id))).toMatchObject({ backgroundColor: '#FFFFFF', borderColor: '#E6E9DF', borderRadius: 16, paddingVertical: 20, paddingHorizontal: 18 });
  expect(s.getByTestId(`${id}-roman`)).toBeTruthy();
  expect(flat(s.getByTestId(`${id}-retry`))).toMatchObject({ backgroundColor: '#2C4A36', borderRadius: 12 });
};

test('a failed first page of past questions is Roman\'s notice card, and its Try again reads the list again', async () => {
  mockParams = { view: 'questions' };
  get.mockRejectedValueOnce(NET());
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await s.findByTestId('copilot-past-error');
  notice(s as never, 'copilot-past-error');
  route([PAGE1]);
  await act(async () => fireEvent.press(s.getByTestId('copilot-past-error-retry')));
  expect(await s.findByText('Why did my weight go up after Saturday?')).toBeTruthy();
  expect(s.queryByTestId('copilot-past-error')).toBeNull();
});

test('a failed Show older is the same notice card under the rows it keeps', async () => {
  mockParams = { view: 'questions' };
  get.mockImplementation((async (url: string, cfg?: { params?: { cursor?: string } }) => {
    if (cfg?.params?.cursor) throw NET();
    return { data: url === COPILOT_PATHS.questions ? PAGE1 : { week: null, suggestions: [] } };
  }) as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Show older questions')));
  await s.findByTestId('copilot-past-error');
  notice(s as never, 'copilot-past-error');
  expect(s.getByTestId('copilot-past-m1')).toBeTruthy();
});

test('a past answer that fails to load is the same notice card', async () => {
  mockParams = { view: 'answer', item: ITEM };
  get.mockRejectedValueOnce(NET());
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await s.findByTestId('copilot-answer-error');
  notice(s as never, 'copilot-answer-error');
});
