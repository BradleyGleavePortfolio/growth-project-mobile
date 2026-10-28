/**
 * #852 fix round 5 / #878 fix round 3 (FR-852X): the Past questions entry and history rows, the saved answer's footer,
 * Roman's notice for a refused or failed Send, the GOAL haptics, motion and polite status lines, the tag at large text,
 * the Copilot button and link, and the masthead and body rhythm.
 */
import React from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { COPILOT_PATHS } from '../../../../api/copilotApi';
import { openOrResumeSession, sendMessage } from '../../../../api/romanApi';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';
import { HapticService } from '../../../../ui/haptics/haptics.service';
import { ROMAN_ROOM_FOOTER } from '../../../../components/roman/romanVoice';
import { lightTokens } from '../../../../theme/tokens';
import { SuggestionCard } from '../SuggestionCard';
import { SuggestionStatusList } from '../SuggestionStatusList';
import { SourceTag } from '../AnswerCard';
import { CalmIn, LedgerButton, LedgerLink } from '../RomanNotice';

let mockParams: Record<string, unknown> | undefined;
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));
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
  useNavigation: () => ({ goBack: jest.fn(), push: jest.fn(), dispatch: jest.fn() }), useRoute: () => ({ key: 'r-1', params: mockParams }),
  NavigationContext: jest.requireActual('react').createContext(null),
  CommonActions: { reset: (s: unknown) => ({ type: 'RESET', payload: s }), goBack: () => ({ type: 'GO_BACK' }) },
}));
jest.mock('@expo/vector-icons', () => {
  const { View: V } = jest.requireActual('react-native');
  return { Ionicons: (p: { testID?: string; size: number; color: string; name: string }) => <V testID={p.testID} accessibilityHint={`${p.name} ${p.size} ${p.color}`} /> };
});
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../../components/roman/RomanTypingIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => undefined }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({
  __esModule: true, default: () => null, useClientNeedsCoach: () => false,
  ROMAN_LOCK_TITLE: 'Roman works with a coach', ROMAN_LOCK_BODY: 'lock body', JOIN_A_COACH: 'Join a coach',
}));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1', role: 'student' }) }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const flat = (el: { props: { style?: unknown } } | null) => StyleSheet.flatten(el?.props.style as never) as Record<string, unknown>;
const hint = (el: { props: { accessibilityHint?: string } }) => el.props.accessibilityHint;
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const WEEK = { number: 3, coach_first_name: 'Alex', target: { kcal: 2150, from: '2026-10-19T00:00:00Z', previous_kcal: 2300 }, workouts: { done: 1, total: 4 }, last_check_in: '2026-10-18' };
const MOVE = { kind: 'move_session', assignment_id: 'a1', workout: 'Lower body B', from_at: '2026-10-22T17:00:00Z', to_at: '2026-10-23T17:00:00Z',
  sources: [{ n: 1, kind: 'plan', label: 'Lower body B on Thu 22 Oct', detail: null }] };
const SUGGESTED = { id: 's9', status: 'suggested', change: MOVE, reason: 'Friday is a rest day.', note: null, sent_at: null, decided_at: null };
const Q = (id: string, question: string, asked_at: string, outcome: string | null = null) => ({ question, asked_at, session_id: 'sess-1', message_id: id, outcome });
const PAGE = { total: 186, since: '2025-10-02T09:00:00Z', next_cursor: 'c2', items: [
  Q('m1', 'Why did my weight go up after Saturday?', '2026-10-18T09:00:00Z'),
  Q('m2', 'Can I swap Thursday for Friday?', '2026-10-15T09:00:00Z', 'approved'),
  Q('m5', 'Could I move my rest day?', '2026-10-12T09:00:00Z', 'pending'),
] };
let recent: unknown = { week: WEEK, suggestions: [] };
const routeGet = (messages: unknown[] = []) => get.mockImplementation((async (url: string) => {
  if (url === COPILOT_PATHS.questions) return { data: PAGE };
  if (url === '/client/copilot') return { data: recent };
  if (url.startsWith('/roman/sessions/')) return { data: { messages } };
  return { data: {} };
}) as never);
const NET = () => Object.assign(new Error('Network Error'), { isAxiosError: true });

beforeEach(() => {
  jest.resetAllMocks();
  mockParams = undefined;
  mockFontScale = 1;
  recent = { week: WEEK, suggestions: [] };
  jest.mocked(openOrResumeSession).mockResolvedValue({ id: 'sess-1' } as never);
});

test('B-852R3-1: Past questions on Your path is style A\'s ask row: 52 tall, 16/21, the count 14 grey, the moss chevron 6 beside it', async () => {
  routeGet();
  const s = await render(wrap(<ClientPathCopilotScreen />));
  const row = await s.findByTestId('copilot-past-row');
  expect(flat(row)).toMatchObject({ minHeight: 52, paddingVertical: 12, paddingHorizontal: 16, marginTop: -2, backgroundColor: '#FFFFFF', borderColor: '#E6E9DF' });
  expect(flat(s.getByText('Past questions'))).toMatchObject({ fontSize: 16, lineHeight: 21, color: lightTokens.textPrimary });
  expect(flat(s.getByTestId('copilot-past-row-count'))).toMatchObject({ fontSize: 14, color: '#5A5A56' });
  expect(s.getByTestId('copilot-past-row-count').props.children).toBe('186');
  expect(hint(s.getByTestId('copilot-past-row-chevron'))).toBe('chevron-forward 18 #4E7A3F');
  expect(flat(s.getByTestId('copilot-past-row-count').parent ?? null)).toMatchObject({ flexDirection: 'row', gap: 6 });
});

test('B-852R3-1, B-S1, C-852R3-2: history rows carry the 22 ink chevron and "day ·", waiting is the GOAL wash, Show older is the forest link', async () => {
  routeGet();
  mockParams = { view: 'questions' };
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await s.findByTestId('copilot-past-m1');
  expect(hint(s.getByTestId('copilot-past-m1-chevron'))).toBe(`chevron-forward 22 ${lightTokens.textPrimary}`);
  expect(s.getByText('Sun 18 Oct')).toBeTruthy();
  expect(s.getByText('Thu 15 Oct \u00B7')).toBeTruthy();
  expect(flat(s.getByTestId('copilot-past-m5-outcome'))).toMatchObject({ backgroundColor: '#F7EFD6' });
  const more = s.getByTestId('copilot-past-more');
  expect(flat(more)).toMatchObject({ minHeight: 44 });
  const words = flat(s.getByText('Show older questions'));
  expect(words).toMatchObject({ fontSize: 15, fontWeight: '500', color: '#2C4A36' });
  expect(words.textDecorationLine).toBeUndefined();
});

test('B-S2: a saved answer carries the room\'s footer, before and after Send', async () => {
  mockParams = { view: 'answer', item: { sessionId: 'sess-1', messageId: 'm2', question: 'Can I swap Thursday for Friday?', askedAt: '2026-10-15T09:00:00Z', outcome: null } };
  routeGet([{ id: 'm2', role: 'assistant', content: 'Friday works.', copilot: { sources: [], suggestion: SUGGESTED } }]);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  const foot = await s.findByTestId('copilot-answer-footer');
  expect(foot.props.children).toBe(ROMAN_ROOM_FOOTER);
  expect(flat(foot)).toMatchObject({ fontSize: 12, color: '#5A5A56', textAlign: 'center' });
  expect(s.getByTestId('copilot-send')).toBeTruthy();
});

test('B-S3: a failed Send is Roman\'s notice with no red; its Try again sends once more; the softImpact and success taps are GOAL\'s', async () => {
  const send = jest.fn().mockRejectedValueOnce(NET()).mockResolvedValueOnce({ ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' });
  const s = await render(<SuggestionCard suggestion={SUGGESTED as never} coach="Alex" send={send} onDismiss={() => undefined} />);
  await act(async () => fireEvent.press(s.getByTestId('copilot-send')));
  expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
  expect(HapticService.error).toHaveBeenCalledTimes(1);
  expect(HapticService.success).not.toHaveBeenCalled();
  expect(s.getByTestId('copilot-send-error-roman')).toBeTruthy();
  expect(flat(s.getByText('That did not go through. Try again.')).color).toBe('#2E2E2B');
  expect(s.queryByTestId('copilot-send')).toBeNull();
  await act(async () => fireEvent.press(s.getByTestId('copilot-send-retry')));
  expect(send).toHaveBeenCalledTimes(2);
  expect(HapticService.success).toHaveBeenCalledTimes(1);
  expect(s.getByTestId('copilot-sent')).toBeTruthy();
});

test('B-S3: AI help off on Send is Roman\'s AI help card; the grant brings Send back and sends nothing by itself', async () => {
  const copy = { version: 'v6', paragraph: { text: 'Consent words.', sha256: 'a'.repeat(64) }, box_label: { text: 'Allow AI help', sha256: 'b'.repeat(64) }, sha256: 'c'.repeat(64) };
  const off = { granted: false, state: 'not_granted', version: null, granted_at: null, withdrawn_at: null, current_version: 'v6', needs_reconsent: false, copy };
  get.mockResolvedValue({ data: off } as never);
  post.mockResolvedValue({ data: { ...off, granted: true, state: 'granted', version: 'v6', granted_at: '2026-10-22T21:41:00Z' } } as never);
  const send = jest.fn().mockRejectedValueOnce(Object.assign(new Error('http'), { response: { status: 403, data: { code: 'ai_consent_required' } } }));
  const s = await render(wrap(<SuggestionCard suggestion={SUGGESTED as never} coach="Alex" send={send} />));
  await act(async () => fireEvent.press(s.getByTestId('copilot-send')));
  expect(s.getByTestId('copilot-send-refusal-roman')).toBeTruthy();
  expect(s.queryByTestId('copilot-send')).toBeNull();
  await act(async () => fireEvent.press(s.getByTestId('copilot-send-refusal-allow')));
  await act(async () => fireEvent.press(await s.findByTestId('copilot-send-refusal-consent-sheet-allow')));
  expect(post.mock.calls.some(([url]) => url === '/me/ai-consent/roman')).toBe(true);
  expect(await s.findByTestId('copilot-send')).toBeTruthy();
  expect(s.queryByTestId('copilot-send-refusal')).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
});

test('B-878-G: the suggestion card\'s rhythm, the 16 spark, the Sent line 36 tall with 6 between, and the Copilot button 52 at 16/600', async () => {
  const send = jest.fn().mockResolvedValueOnce({ ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' });
  const s = await render(<SuggestionCard suggestion={SUGGESTED as never} coach="Alex" send={send} />);
  expect(flat(s.getByTestId('copilot-suggestion'))).toMatchObject({ padding: 16 });
  expect(flat(s.getByTestId('copilot-suggestion')).gap).toBeUndefined();
  expect(flat(s.getByTestId('copilot-suggestion-title'))).toMatchObject({ marginTop: 10 });
  expect(flat(s.getByTestId('copilot-suggestion-tags'))).toMatchObject({ marginTop: 12 });
  expect(flat(s.getByTestId('copilot-send'))).toMatchObject({ minHeight: 52, marginTop: 14 });
  expect(flat(s.getByText('Send to Alex'))).toMatchObject({ fontSize: 16, fontWeight: '600' });
  expect(hint(s.getByTestId('copilot-suggestion-spark'))).toMatch(/^sparkles-outline 16 /);
  await act(async () => fireEvent.press(s.getByTestId('copilot-send')));
  expect(flat(s.getByTestId('copilot-sent'))).toMatchObject({ gap: 6, minHeight: 36, borderRadius: 12, paddingHorizontal: 12 });
  expect(flat(s.getByTestId('copilot-sent')).paddingVertical).toBeUndefined();
  expect(s.getByTestId('copilot-sent').props.accessibilityLiveRegion).toBe('polite');
});

test('B-S4: a question chip ticks; a failed answer gives one error tap; an answer that fails after the screen closed gives none', async () => {
  routeGet();
  jest.mocked(sendMessage).mockRejectedValueOnce(NET());
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(HapticService.selection).toHaveBeenCalledTimes(1);
  expect(HapticService.error).toHaveBeenCalledTimes(1);
  await s.unmount();
  jest.mocked(HapticService.error).mockClear();
  let fail: (e: Error) => void = () => undefined;
  jest.mocked(sendMessage).mockImplementationOnce(() => new Promise((_ok, no) => { fail = no; }) as never);
  const t = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await t.findByText('Explain my targets')));
  await t.unmount();
  await act(async () => { fail(NET()); await Promise.resolve(); });
  expect(HapticService.error).not.toHaveBeenCalled();
});

test('B-S4: a status line is said once when it changes, never on the first draw or a repeat poll', async () => {
  const say = jest.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(() => undefined);
  const pending = { ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' };
  const s = await render(<SuggestionStatusList items={[pending] as never} coach="Alex" />);
  expect(say).not.toHaveBeenCalled();
  await s.rerender(<SuggestionStatusList items={[{ ...pending }] as never} coach="Alex" />);
  expect(say).not.toHaveBeenCalled();
  await s.rerender(<SuggestionStatusList items={[{ ...pending, status: 'approved', decided_at: '2026-10-22T09:00:00Z' }] as never} coach="Alex" />);
  expect(say).toHaveBeenCalledTimes(1);
  expect(say.mock.calls[0][0]).toMatch(/^Move Lower body B to Fri 23 Oct\. /);
  expect(flat(s.getByTestId('copilot-status-approved-line'))).toMatchObject({ marginTop: 3 });
  say.mockRestore();
});

test('B-S4: a sent change folds the newest turn to its question and Sent line; no question chips under a proposal', async () => {
  routeGet();
  jest.mocked(sendMessage).mockResolvedValueOnce({ text: 'Friday works.', messageId: 'm1', interrupted: false, copilot: { sources: [], suggestion: SUGGESTED } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getByTestId('copilot-answer')).toBeTruthy();
  expect(s.queryByTestId('copilot-more-0')).toBeNull();
  const pending = { ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' };
  recent = { week: WEEK, suggestions: [pending] };
  post.mockResolvedValueOnce({ data: pending } as never);
  await act(async () => fireEvent.press(s.getByTestId('copilot-send')));
  expect(await s.findByTestId('copilot-status-pending')).toBeTruthy();
  expect(s.getByTestId('copilot-sent')).toBeTruthy();
  expect(s.queryByTestId('copilot-answer')).toBeNull();
  expect(flat(s.getByTestId('copilot-status-list'))).toMatchObject({ marginTop: 6 });
});

test('B-878R3-2: a source tag is 74 wide at least in text units, so at 130% text it is 96.2', async () => {
  mockFontScale = 1.3;
  const s = await render(<SourceTag kind="plan" />);
  expect(flat(s.getByTestId('copilot-tag-plan')).minWidth).toBeCloseTo(96.2);
  mockFontScale = 1;
  await s.rerender(<SourceTag kind="plan" />);
  expect(flat(s.getByTestId('copilot-tag-plan')).minWidth).toBe(74);
});

test('B-878-G: the masthead rhythm (title 4 under Back, letter-spacing .2, the week 5 under it, the tiles 16 under that), the hint 12 and the moss starter chevron', async () => {
  routeGet();
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await s.findByText('Explain my targets');
  expect(flat(s.getByTestId('copilot-mast'))).toMatchObject({ paddingBottom: 20 });
  expect(flat(s.getByTestId('copilot-mast')).gap).toBeUndefined();
  expect(flat(s.getByTestId('copilot-mast-title'))).toMatchObject({ marginTop: 4, letterSpacing: 0.2 });
  expect(flat(s.getByTestId('copilot-hint'))).toMatchObject({ marginTop: 2 });
  expect(hint(s.getByTestId('copilot-starter-0-chevron'))).toBe('chevron-forward 18 #4E7A3F');
});

test('the Copilot button and link: 52 tall, 16/600 forest; the link 44 tall, 15/500 forest, no underline; presses tap once', async () => {
  const press = jest.fn();
  const b = await render(<LedgerButton label="Try again" onPress={press} testID="b" />);
  expect(flat(b.getByTestId('b'))).toMatchObject({ minHeight: 52, borderRadius: 12, backgroundColor: lightTokens.accent });
  expect(flat(b.getByText('Try again'))).toMatchObject({ fontSize: 16, fontWeight: '600', color: lightTokens.textOnAccent });
  await act(async () => fireEvent.press(b.getByTestId('b')));
  expect(press).toHaveBeenCalledTimes(1);
  expect(HapticService.softImpact).toHaveBeenCalledTimes(1);
  await b.rerender(<LedgerButton label="Try again" onPress={press} loading testID="b" />);
  expect(b.getByTestId('b-spinner')).toBeTruthy();
  expect(b.getByTestId('b').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  const l = await render(<LedgerLink label="Show older questions" onPress={press} testID="l" />);
  expect(flat(l.getByTestId('l'))).toMatchObject({ minHeight: 44 });
  expect(flat(l.getByText('Show older questions'))).toMatchObject({ fontSize: 15, color: '#2C4A36' });
});

test('C-852R3-1: a failed re-read over what is on screen keeps it with no retry card, on Your path and on Past questions', async () => {
  routeGet();
  const a = await render(wrap(<ClientPathCopilotScreen />));
  await a.findByTestId('copilot-week');
  get.mockRejectedValue(NET());
  await act(async () => { await a.getByTestId('copilot-scroll').props.refreshControl.props.onRefresh(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(get.mock.calls.filter(([url]) => url === '/client/copilot').length).toBeGreaterThanOrEqual(2);
  expect(a.getByTestId('copilot-week')).toBeTruthy();
  expect(a.queryByTestId('copilot-error')).toBeNull();
  await a.unmount();
  routeGet();
  mockParams = { view: 'questions' };
  const b = await render(wrap(<ClientPathCopilotScreen />));
  await b.findByTestId('copilot-past-m1');
  get.mockRejectedValue(NET());
  await act(async () => { await b.getByTestId('copilot-questions-scroll').props.refreshControl.props.onRefresh(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(get.mock.calls.filter(([url]) => url === COPILOT_PATHS.questions).length).toBeGreaterThanOrEqual(2);
  expect(b.getByTestId('copilot-past-m1')).toBeTruthy();
  expect(b.queryByTestId('copilot-past-error')).toBeNull();
});

test('B-878R3-3 (owner 178-4, op 2): Not now is style A\'s forest link, 44 tall, 15/500, no underline; it waits while Send is in flight', async () => {
  let done: (v: unknown) => void = () => undefined;
  const send = jest.fn(() => new Promise((r) => { done = r; }));
  const dismiss = jest.fn();
  const s = await render(<SuggestionCard suggestion={SUGGESTED as never} coach="Alex" send={send as never} onDismiss={dismiss} />);
  const link = s.getByTestId('copilot-not-now');
  expect(flat(link)).toMatchObject({ minHeight: 44, alignSelf: 'center' });
  const words = flat(s.getByText('Not now'));
  expect(words).toMatchObject({ fontSize: 15, fontWeight: '500', color: '#2C4A36' });
  expect(words.textDecorationLine).toBeUndefined();
  expect(link.props.accessibilityRole).toBe('button');
  await act(async () => fireEvent.press(link));
  expect(dismiss).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(s.getByTestId('copilot-send')));
  expect(s.getByTestId('copilot-not-now').props.accessibilityState?.disabled).toBe(true);
  expect(flat(s.getByText('Not now')).color).toBe('#5A5A56');
  await act(async () => done({ ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' }));
});

test('B-S4: the calm entry is one 200 ms opacity fade that moves nothing (so Reduce Motion\'s cross-fade is the same); a changed status fades in again, a repeat poll does not', async () => {
  const timing = jest.spyOn(Animated, 'timing');
  const calm = await render(<CalmIn testID="calm"><Text>Sent</Text></CalmIn>);
  expect(timing).toHaveBeenCalledTimes(1);
  expect(timing.mock.calls[0][1]).toMatchObject({ toValue: 1, duration: 200, useNativeDriver: true });
  expect(flat(calm.getByTestId('calm'))).toHaveProperty('opacity');
  expect(flat(calm.getByTestId('calm')).transform).toBeUndefined();
  timing.mockClear();
  const pending = { ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' };
  const list = await render(<SuggestionStatusList items={[pending] as never} coach="Alex" />);
  expect(timing).toHaveBeenCalledTimes(1);
  await list.rerender(<SuggestionStatusList items={[{ ...pending }] as never} coach="Alex" />);
  expect(timing).toHaveBeenCalledTimes(1);
  await list.rerender(<SuggestionStatusList items={[{ ...pending, status: 'approved', decided_at: '2026-10-22T09:00:00Z' }] as never} coach="Alex" />);
  expect(timing).toHaveBeenCalledTimes(2);
  expect(timing.mock.calls[1][1]).toMatchObject({ duration: 200 });
  timing.mockRestore();
});
