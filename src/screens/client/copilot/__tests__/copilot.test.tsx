import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';
import { SuggestionCard } from '../SuggestionCard';
import { describeChange, statusLine } from '../pathChangeWords';
import type { CopilotSuggestion } from '../../../../api/copilotApi';

const mockBack = jest.fn();
let mockCoaches: Array<{ name: string }> = [{ name: 'Alex Rivera' }];
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
const mockFlags: { clientPathCopilot: boolean } = jest.requireMock('../../../../config/featureFlags').featureFlags;
jest.mock('../../../../api/schedulingApi', () => ({ resolveClientTimezone: () => 'UTC' }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: mockCoaches }) }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockBack }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../../components/ai/AiRefusalNotice', () => ({ __esModule: true, default: () => mockText('AI help is off') }));
const mockText = (t: string) => <Text>{t}</Text>;
let mockNeedsCoach = false;
jest.mock('../../../../components/coachless/JoinCoachState', () => ({ __esModule: true, ROMAN_LOCK_TITLE: 'Roman works with a coach',
  default: ({ title, testID }: { title: string; testID: string }) => mockLock(title, testID), useClientNeedsCoach: () => mockNeedsCoach }));
const mockLock = (title: string, testID: string) => <Text testID={testID}>{title}</Text>;
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const NOW = new Date('2026-10-21T22:00:00Z');
const move = { kind: 'move_session' as const, assignment_id: 'a1', workout: 'Lower body B', from_at: '2026-10-22T17:00:00Z', to_at: '2026-10-23T17:00:00Z' };
const kcal = { kind: 'set_calorie_target' as const, target_id: 'auto-t1', from_kcal: 2600, to_kcal: 2450 };
const row = (over: Partial<CopilotSuggestion>): CopilotSuggestion => ({
  id: 's1', status: 'pending', change: move, reason: 'r', note: null, sent_at: '2026-10-21T14:34:00Z', decided_at: null, ...over,
});
const fail = (status: number, data: unknown = {}) => Object.assign(new Error('http'), { response: { status, data } });
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.clientPathCopilot = true;
  mockNeedsCoach = false;
  mockCoaches = [{ name: 'Alex Rivera' }];
});

test('the phone writes every line from the structured change (no server titles)', () => {
  expect(describeChange(move)).toEqual({ title: 'Move Lower body B', from: 'Thu 22 Oct', to: 'Fri 23 Oct', summary: 'Move Lower body B to Fri 23 Oct' });
  expect(describeChange(kcal)).toMatchObject({ title: 'Calorie target', from: '2,600 kcal', to: '2,450 kcal', summary: 'Calorie target 2,600 to 2,450 kcal' });
  expect(statusLine(row({}), 'Alex', NOW)).toEqual({ line: 'Awaiting coach approval', meta: 'Sent today, 2:34 PM', tone: 'waiting' });
  expect(statusLine(row({ sent_at: '2026-10-19T09:00:00Z' }), 'Alex', NOW).meta).toBe('Sent Mon 19 Oct');
  // An edited change comes back approved with the coach's day: the same approved line, the applied fact.
  const edited = row({ status: 'approved', change: { ...move, to_at: '2026-10-24T17:00:00Z' }, decided_at: '2026-10-21T18:00:00Z' });
  expect(statusLine(edited, 'Alex', NOW)).toEqual({ line: 'Approved by your coach', meta: 'Wed 21 Oct', tone: 'approved' });
  expect(describeChange(edited.change).summary).toBe('Move Lower body B to Sat 24 Oct');
  expect(statusLine(row({ status: 'rejected', decided_at: '2026-10-09T10:00:00Z' }), 'Alex', NOW)).toEqual({ line: 'Alex kept your plan as it is', meta: 'Fri 9 Oct', tone: 'still' });
  expect(statusLine(row({ status: 'rejected' }), 'your coach', NOW).line).toBe('Your coach kept your plan as it is');
  expect(statusLine(row({ status: 'expired' }), 'Alex', NOW)).toMatchObject({ line: 'This suggestion has expired.', tone: 'still' });
});

test('Send hands the change to the coach and confirms it once', async () => {
  post.mockResolvedValueOnce({ data: { ...row({}), sent_at: new Date().toISOString() } } as never);
  const onSent = jest.fn();
  const s = await render(<SuggestionCard suggestion={row({ status: 'suggested', sent_at: null })} coach="Alex" onSent={onSent} />);
  expect(s.getByText('Move Lower body B')).toBeTruthy();
  expect(s.getByText("Nothing changes until Alex says yes. Alex sees this change and Roman's reason, not your conversation.")).toBeTruthy();
  await act(async () => fireEvent.press(s.getByText('Send to Alex')));
  expect(post).toHaveBeenCalledWith('/client/copilot/suggestions/s1/send');
  expect(s.getByTestId('copilot-sent')).toBeTruthy();
  expect(s.getByText(/^Sent to Alex · Today, /)).toBeTruthy();
  expect(onSent).toHaveBeenCalledTimes(1);
  expect(s.queryByText('Send to Alex')).toBeNull();
});

test('Send refusals are told truthfully: lapsed, AI help off, and a failed connection', async () => {
  const lapsed = await render(<SuggestionCard suggestion={row({ status: 'suggested' })} coach="Alex" onDismiss={jest.fn()} />);
  post.mockRejectedValueOnce(fail(409, { code: 'COPILOT_SUGGESTION_EXPIRED', message: 'This suggestion is no longer available. Ask Roman again.' }));
  await act(async () => fireEvent.press(lapsed.getByText('Send to Alex')));
  expect(lapsed.getByText('This suggestion is no longer available. Ask Roman again.')).toBeTruthy();
  expect(lapsed.queryByText('Send to Alex')).toBeNull();
  expect(lapsed.getByText('Not now')).toBeTruthy();
  await lapsed.unmount();
  const s = await render(<SuggestionCard suggestion={row({ status: 'suggested' })} coach="Alex" onDismiss={jest.fn()} />);
  post.mockRejectedValueOnce(fail(403, { code: 'ai_consent_required' }));
  await act(async () => fireEvent.press(s.getByText('Send to Alex')));
  expect(s.getByText('AI help is off')).toBeTruthy();
  post.mockRejectedValueOnce(new Error('Network Error'));
  await act(async () => fireEvent.press(s.getByText('Send to Alex')));
  expect(s.getByText('That did not go through. Try again.')).toBeTruthy();
  expect(s.getByText('Not now')).toBeTruthy();
});

test('Your path lists sent suggestions with where each stands and the coach note', async () => {
  get.mockResolvedValueOnce({ data: { suggestions_total: 3, suggestions: [
    row({}),
    row({ id: 's2', status: 'approved', change: kcal, decided_at: '2026-10-12T10:00:00Z' }),
    row({ id: 's3', status: 'rejected', note: 'Keep the run, just take it easy.', decided_at: '2026-10-09T10:00:00Z' }),
  ] } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(await s.findByText('Suggestions')).toBeTruthy();
  expect(get).toHaveBeenCalledWith('/client/copilot');
  expect(s.getByText('Awaiting coach approval')).toBeTruthy();
  expect(s.getByText('Calorie target 2,600 to 2,450 kcal')).toBeTruthy();
  expect(s.getByText('Alex kept your plan as it is')).toBeTruthy();
  expect(s.getByText('\u201CKeep the run, just take it easy.\u201D')).toBeTruthy();
  await act(async () => fireEvent.press(s.getByTestId('copilot-back')));
  expect(mockBack).toHaveBeenCalled();
});

test('a server without Copilot (404) shows the calm empty state; a failed read is not emptiness; flag off draws the old gate', async () => {
  get.mockRejectedValueOnce(fail(404));
  const a = await render(wrap(<ClientPathCopilotScreen />));
  expect(await a.findByText('No suggestions are available.')).toBeTruthy();
  await a.unmount();
  get.mockRejectedValueOnce(fail(500));
  const b = await render(wrap(<ClientPathCopilotScreen />));
  expect(await b.findByTestId('copilot-error')).toBeTruthy();
  expect(b.queryByText('No suggestions yet')).toBeNull();
  await b.unmount();
  mockFlags.clientPathCopilot = false;
  expect((await render(wrap(<ClientPathCopilotScreen />))).getByText('Path suggestions are not available on this account.')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});

test('a client with no coach gets the existing Roman lock page and no read; Not now waits while Send is in flight', async () => {
  mockNeedsCoach = true;
  const a = await render(wrap(<ClientPathCopilotScreen />));
  expect([a.getByTestId('copilot-coach-lock').props.children, get.mock.calls.length]).toEqual(['Roman works with a coach', 0]);
  await a.unmount();
  post.mockReturnValueOnce(new Promise(() => undefined) as never);
  const s = await render(<SuggestionCard suggestion={row({ status: 'suggested' })} coach="Alex" onDismiss={jest.fn()} />);
  await act(async () => fireEvent.press(s.getByText('Send to Alex')));
  expect(s.getByTestId('copilot-not-now').props.accessibilityState?.disabled).toBe(true);
});
