/**
 * ROMAN-PENDING-WORDS-M, the Path Copilot card: the same words asked again while Roman is still writing the first
 * answer get the server's exact frame (backend main 1462408a roman-sse-error.ts:34-37, replayTurn at
 * roman.controller.ts:311). The card says so truthfully, with no Try again; once the answer is stored, the same words
 * asked again show it on a new card under the same key. The real ClientPathCopilotScreen, the real useCopilotAsk, and
 * romanApi's real sendMessage and RomanApiError over a stubbed `fetch` (only openOrResumeSession is stubbed), so the
 * field the screen reads comes from the wire, never from a hand-built error (copilotTurn.test.tsx swaps them out).
 */
import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';

const mockText = (t: string) => <Text>{t}</Text>;
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../../../../services/sentry', () => ({ captureError: jest.fn(), setSentryUser: jest.fn() }));
jest.mock('../../../../api/romanApi', () => ({
  ...jest.requireActual('../../../../api/romanApi'),
  openOrResumeSession: jest.fn(async () => ({ id: 'sess-1', surface: 'client', messageCount: 0 })),
}));
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
  __esModule: true, default: ({ title }: { title: string }) => mockText(title), useClientNeedsCoach: () => false,
  ROMAN_LOCK_TITLE: 'Roman works with a coach', ROMAN_LOCK_BODY: 'lock body', JOIN_A_COACH: 'Join a coach',
}));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1', role: 'student' }) }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

// Required, not imported, so this file type-checks before the new line exists (its red run is at the assertions).
const voice = require('../../../../components/roman/romanVoice');
const STORED: string = voice.ROMAN_HELD_NO_ANSWER_COPILOT;
const STILL: string = voice.ROMAN_HELD_NOT_READY_COPILOT;

const WEEK = { number: 3, coach_first_name: 'Alex', target: { kcal: 2150, from: new Date().toISOString(), previous_kcal: 2300 }, workouts: { done: 1, total: 4 }, last_check_in: '2026-10-18' };
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const frame = (code: string) => `event: error\ndata: {"code":"${code}","message":"Roman is not available right now."}\n\n`;
const ANSWER = 'data: {"type":"done","text":"Friday works.","messageId":"m-1","interrupted":false,"copilot":{"sources":[],"suggestion":null}}\n\n';

const realFetch = global.fetch;
let bodies: (string | Error)[] = [];
const fetchMock = jest.fn(async (_url: string, _init: RequestInit) => {
  const body = bodies.shift() ?? ANSWER;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => { if (body instanceof Error) throw body; return body; },
  } as unknown as Response;
});
const keyOf = (n: number): string => (fetchMock.mock.calls[n][1].headers as Record<string, string>)['Idempotency-Key'];
const shows = (s: Awaited<ReturnType<typeof render>>, line: string | undefined): boolean =>
  typeof line === 'string' && s.queryAllByText(line).length > 0;

beforeEach(() => {
  bodies = [];
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  jest.mocked(api.get).mockResolvedValue({ data: { week: WEEK, suggestions: [] } } as never);
});
afterEach(() => {
  global.fetch = realFetch;
});

const QUESTION = 'Can I swap Friday?';
const askFromComposer = async (s: Awaited<ReturnType<typeof render>>) => {
  await act(async () => fireEvent.press(s.getByLabelText('Send message')));
};

test('case 6: the same words asked again while Roman is still writing show the true line on the card (no Try again); once the answer is stored, asking again shows it under the same key', async () => {
  bodies = [new TypeError('Connection lost after the turn was stored'), frame('ROMAN_REPLY_PENDING'), ANSWER];
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.changeText(await s.findByPlaceholderText('Ask Roman anything.'), QUESTION));
  await askFromComposer(s);
  // A cut stream: the phone cannot tell, so today's stored line; the question goes back in the composer.
  expect(s.getAllByText(STORED)).toHaveLength(1);
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe(QUESTION);
  await askFromComposer(s); // the exact frame
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(s.getAllByText(STORED)).toHaveLength(1); // only the first card's
  const cards = s.getAllByTestId(/^copilot-turn-[A-Za-z]+$/);
  expect(cards).toHaveLength(2);
  expect(cards[1].props.testID).toBe('copilot-turn-generic');
  expect(shows(s, STILL)).toBe(true);
  expect(within(cards[1]).queryAllByText(STILL)).toHaveLength(1);
  expect(s.queryByText('Try again')).toBeNull();
  expect(s.getByPlaceholderText('Ask Roman anything.').props.value).toBe(QUESTION);
  await askFromComposer(s); // the first answer is stored by now: the same key replays it, on a new card
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(s.getByText('Friday works.')).toBeTruthy();
  expect(s.getAllByTestId('copilot-turn')).toHaveLength(3);
  expect(keyOf(1)).toBe(keyOf(0));
  expect(keyOf(2)).toBe(keyOf(0));
});

test.each([
  ['ROMAN_UNAVAILABLE', 'copilot-turn-unavailable'],
  ['ROMAN_SOMETHING_NEW', 'copilot-turn-generic'],
  ['roman_reply_pending', 'copilot-turn-generic'],
])('case 6, negative: %s on the card is today’s stored line, never the still-writing line', async (code, testID) => {
  bodies = [frame(code)];
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.changeText(await s.findByPlaceholderText('Ask Roman anything.'), QUESTION));
  await askFromComposer(s);
  expect(s.getByTestId(testID)).toBeTruthy();
  expect(s.getAllByText(STORED)).toHaveLength(1);
  expect(shows(s, STILL)).toBe(false);
  expect(s.queryByText('Try again')).toBeNull();
});
