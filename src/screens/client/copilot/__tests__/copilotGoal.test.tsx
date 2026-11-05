import React from 'react';
import { Dimensions, StyleSheet, Text } from 'react-native';
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

// FR-852 (#878 round 1): Opus B-878-G1..G3, Sol B-G2.
const flat = (el: { props: { style?: unknown } } | null) => StyleSheet.flatten(el?.props.style as never) as Record<string, unknown>;
const at = (width: number) => act(() => { Dimensions.set({ window: { width, height: 800, scale: 2, fontScale: 1 }, screen: { width, height: 800, scale: 2, fontScale: 1 } }); });
afterEach(() => at(750));

test('Opus B-878-G3: no quick chips under an offline turn, a rate limit or a crisis reply; the crisis reply keeps its buttons', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  send.mockRejectedValueOnce(new RomanApiError('offline', 'offline'));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getByTestId('copilot-turn-offline')).toBeTruthy();
  expect(s.queryByTestId('copilot-more')).toBeNull();
  send.mockRejectedValueOnce(Object.assign(new RomanApiError('rateLimited', 'slow'), { retryAfterSeconds: 30 }));
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'And now?'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByTestId('copilot-turn-rateLimited')).toBeTruthy();
  expect(s.queryByTestId('copilot-more')).toBeNull();
  send.mockResolvedValueOnce({ text: 'Please reach out now.', messageId: 'm9', interrupted: false, copilot: null,
    safetyActions: [{ kind: 'call', label: 'Call 988', value: '988' }] } as never);
  await act(async () => fireEvent.changeText(s.getByPlaceholderText('Ask Roman anything.'), 'I feel unsafe'));
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
  expect(s.getByText('crisis buttons')).toBeTruthy();
  expect(s.queryByTestId('copilot-more')).toBeNull();
});

test('Opus B-878-G2: below 375 wide the masthead uses the 16 gutter and the week tiles take style A\u2019s padding and chip', async () => {
  await at(360);
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  const tile = await s.findByTestId('copilot-week-target');
  expect(flat(s.getByTestId('copilot-mast'))).toMatchObject({ paddingHorizontal: 16 });
  expect(flat(s.getByTestId('copilot-body'))).toMatchObject({ paddingHorizontal: 16, paddingTop: 22 });
  expect(flat(tile)).toMatchObject({ paddingTop: 12, paddingHorizontal: 10, paddingBottom: 11, borderRadius: 16, borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)', borderColor: 'rgba(184,204,191,0.2)' });
  expect(flat(s.getByTestId('copilot-week-checkin-label'))).toMatchObject({ fontSize: 12, lineHeight: 15, color: '#B8CCBF' });
  expect(flat(s.getByTestId('copilot-week-changed'))).toMatchObject({ backgroundColor: '#A3C46A', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, marginRight: -10 });
  expect(flat(s.getByText(/^Changed /))).toMatchObject({ fontSize: 11, fontWeight: '600', color: '#1A1A18' });
  expect(flat(s.getByTestId('copilot-mast-title'))).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 34 });
  await at(390);
  expect(flat(s.getByTestId('copilot-mast'))).toMatchObject({ paddingHorizontal: 20 });
});

test('Opus B-878-G1 and Sol B-G2: once asked, the folded masthead and the answer take style A\u2019s tighter sizes', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  send.mockResolvedValueOnce({ text: 'Your target is 2,150 kcal [1]. It held this week.', messageId: 'm1', interrupted: false,
    copilot: { sources: FACTS, suggestion: null } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(flat(s.getByTestId('copilot-mast'))).toMatchObject({ paddingBottom: 14 });
  expect(flat(s.getByTestId('copilot-body'))).toMatchObject({ paddingTop: 18 });
  expect(flat(s.getByText(/^You asked/))).toMatchObject({ fontSize: 12.5, color: '#5A5A56' });
  expect(flat(s.getByTestId('copilot-asked'))).toMatchObject({ fontSize: 18, fontWeight: '600', lineHeight: 24 });
  expect(flat(s.getByText('Roman'))).toMatchObject({ fontSize: 13, fontWeight: '600', color: '#2C4A36' });
  expect(flat(s.getByTestId('copilot-lead'))).toMatchObject({ fontFamily: 'CormorantGaramond_500Medium', fontSize: 24, lineHeight: 30 });
  expect(flat(s.getByTestId('copilot-answer-body'))).toMatchObject({ fontSize: 15, lineHeight: 23, color: '#2E2E2B' });
  expect(flat(s.getByText('From your data'))).toMatchObject({ fontSize: 12.5, fontWeight: '600', color: '#5A5A56', paddingTop: 11 });
  expect(flat(s.getByTestId('copilot-fact-plan'))).toMatchObject({ minHeight: 56, paddingVertical: 9, paddingHorizontal: 16 });
  expect(flat(s.getByText('How was my week'))).toMatchObject({ fontSize: 14.5, fontWeight: '500', color: '#2C4A36' });
});

test('Sol B-G2: the composer is style A\u2019s cream bar with a 46-high leaf-edged field and the send square', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  const bar = await s.findByTestId('copilot-composer');
  expect(flat(bar)).toMatchObject({ backgroundColor: '#FFFDF8', borderTopWidth: 1, borderTopColor: '#E6E9DF', paddingTop: 10, paddingHorizontal: 20 });
  expect(flat(s.getByTestId('roman-composer-field'))).toMatchObject({ borderColor: '#D2E2B4', minHeight: 46, borderRadius: 12, paddingHorizontal: 14 });
  expect(flat(s.getByTestId('roman-composer-input'))).toMatchObject({ fontSize: 16 });
  expect(flat(s.getByTestId('roman-composer-send'))).toMatchObject({ width: 46, height: 46, borderRadius: 12, backgroundColor: '#EEF4E0' });
});

test('Sol B-G2: a failure card is style A\u2019s state card (20/18 in, Roman at 40, 17/600 title, 15/1.5 body)', async () => {
  get.mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
  send.mockRejectedValueOnce(new RomanApiError('offline', 'offline'));
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(flat(s.getByTestId('copilot-turn-offline'))).toMatchObject({ paddingVertical: 20, paddingHorizontal: 18, borderRadius: 16, backgroundColor: '#FFFFFF' });
  expect(s.getByTestId('copilot-turn-offline-roman')).toBeTruthy();
  expect(flat(s.getByTestId('copilot-turn-offline-title'))).toMatchObject({ fontSize: 17, fontWeight: '600' });
});
