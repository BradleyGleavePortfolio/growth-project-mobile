/**
 * #852 fix round 4 (FR-852R3): the answer body, the client's change tiles, the sent change's status under Your path,
 * the ledger's own loading and error states, and Roman's lock drawn as frame 12.
 */
import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { withRepeat } from 'react-native-reanimated';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '../../../../services/api';
import { openOrResumeSession, sendMessage } from '../../../../api/romanApi';
import ClientPathCopilotScreen from '../../ClientPathCopilotScreen';
import { AnswerCard } from '../AnswerCard';
import { ChangeTiles } from '../ChangeTiles';
import { lightTokens, typography } from '../../../../theme/tokens';

let mockNeedsCoach = false;
const mockBack = jest.fn();
const mockJoin = jest.fn();
const mockSupport = jest.fn();
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return { ...actual, __esModule: true, default: actual.default, withRepeat: jest.fn(actual.withRepeat) };
});
jest.mock('../../../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../../../api/romanApi', () => ({
  ROMAN_MESSAGE_MAX_LENGTH: 4000, RomanApiError: class extends Error {}, RomanWireError: class extends Error {}, openOrResumeSession: jest.fn(), sendMessage: jest.fn(),
}));
jest.mock('../../../../config/featureFlags', () => ({ featureFlags: { clientPathCopilot: true } }));
jest.mock('../../../../api/schedulingApi', () => ({ resolveClientTimezone: () => 'UTC' }));
jest.mock('../../../../hooks/useCalendar', () => ({ useMyCoaches: () => ({ data: [{ name: 'Alex Rivera' }] }) }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockBack, push: jest.fn() }), useRoute: () => ({ params: undefined }), NavigationContext: jest.requireActual('react').createContext(null),
}));
jest.mock('@expo/vector-icons', () => {
  const { View: V } = jest.requireActual('react-native');
  return { Ionicons: (p: { testID?: string; size: number; color: string; name: string }) => <V testID={p.testID} accessibilityHint={`${p.name} ${p.size} ${p.color}`} /> };
});
jest.mock('../../../../components/StatusBarBand', () => ({ ForestStatusBar: () => null }));
jest.mock('../../../../ui/haptics/haptics.service', () => ({ HapticService: { success: jest.fn(), error: jest.fn(), softImpact: jest.fn(), selection: jest.fn() } }));
jest.mock('../../../../components/roman/RomanTypingIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../../components/ai/useOpenSupport', () => ({ useOpenSupport: () => mockSupport }));
jest.mock('../../../../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({ messageCoach: mockJoin }) }));
jest.mock('../../../../components/coachless/JoinCoachState', () => ({
  __esModule: true, default: () => null, useClientNeedsCoach: () => mockNeedsCoach,
  ROMAN_LOCK_TITLE: 'Roman works with a coach', ROMAN_LOCK_BODY: 'Roman is the AI that works alongside your coach.', JOIN_A_COACH: 'Join a coach',
}));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'client-1', role: 'student' }) }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const t = jest.requireActual('../../../../theme/tokens');
  return { useTheme: () => ({ colors: t.colors, semanticColors: t.lightTokens }) };
});

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
const MOVE = { kind: 'move_session', assignment_id: 'a1', workout: 'Lower body B', from_at: '2026-10-22T17:00:00Z', to_at: '2026-10-23T17:00:00Z', sources: [] };
const SUGGESTED = { id: 's9', status: 'suggested', change: MOVE, reason: 'Friday is a rest day.', note: null, sent_at: null, decided_at: null };
let recent: unknown = { suggestions: [] };
const routeGet = () => get.mockImplementation((url: string) => (url === '/client/copilot' ? Promise.resolve({ data: recent }) : Promise.resolve({ data: {} })) as never);

beforeEach(() => {
  jest.resetAllMocks();
  mockNeedsCoach = false;
  recent = { suggestions: [] };
  jest.mocked(openOrResumeSession).mockResolvedValue({ id: 'sess-1' } as never);
});

test('B-H1: the answer body is 15/1.5 in #2E2E2B and Roman sits at 24 beside the name', async () => {
  const s = await render(<AnswerCard text="Friday works. Saturday trains other muscles." reply={null} />);
  const body = flat(s.getByTestId('copilot-answer-body'));
  expect([body.fontSize, body.lineHeight, body.color]).toEqual([15, 23, '#2E2E2B']);
  expect(flat(s.getByTestId('copilot-answer-roman'))).toMatchObject({ width: 24, height: 24 });
});

test('B-G2: the client tiles draw style A (.ba); the coach row keeps its inset look', async () => {
  const c = await render(<ChangeTiles from="Thu 22 Oct" to="Fri 23 Oct" />);
  expect(flat(c.getByTestId('copilot-tile-now')).backgroundColor).toBe('#F5F6F1');
  expect(flat(c.getByTestId('copilot-tile-next'))).toMatchObject({ backgroundColor: '#EEF4E0', borderColor: '#D2E2B4', borderWidth: 1 });
  const labels = [c.getByText('Now'), c.getByText('Suggested')].map(flat);
  for (const l of labels) expect([l.fontSize, l.color, l.letterSpacing ?? 0]).toEqual([12, '#5A5A56', 0]);
  const values = [c.getByText('Thu 22 Oct'), c.getByText('Fri 23 Oct')].map(flat);
  for (const v of values) expect([v.fontSize, v.fontWeight, v.color]).toEqual([15.5, '600', lightTokens.textPrimary]);
  expect(c.getByTestId('copilot-tiles-arrow').props.accessibilityHint).toBe('arrow-forward 20 #4E7A3F');
  await c.unmount();
  const coach = await render(<ChangeTiles from="Thu 22 Oct" to="Fri 23 Oct" inset />);
  expect(flat(coach.getByTestId('copilot-tile-now')).backgroundColor).toBe(lightTokens.bgSurface);
  expect(flat(coach.getByText('Now')).fontSize).toBe(typography.caption.fontSize);
  expect(coach.getByTestId('copilot-tiles-arrow').props.accessibilityHint).toBe('arrow-forward 16 #4E7A3F');
});

test('B-R2-SEND: after Send the same change shows one status under Your path, then its decision; no second Send', async () => {
  routeGet();
  jest.mocked(sendMessage).mockResolvedValueOnce({ text: 'Friday works.', messageId: 'm1', interrupted: false, copilot: { sources: [], suggestion: SUGGESTED } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getAllByTestId('copilot-send')).toHaveLength(1);
  const pending = { ...SUGGESTED, status: 'pending', sent_at: '2026-10-21T21:34:00Z' };
  recent = { suggestions: [pending] };
  post.mockResolvedValueOnce({ data: pending } as never);
  await act(async () => fireEvent.press(s.getByTestId('copilot-send')));
  expect(await s.findByTestId('copilot-status-pending')).toBeTruthy();
  expect(s.getAllByTestId('copilot-status-pending')).toHaveLength(1);
  expect(s.queryByTestId('copilot-send')).toBeNull();
  expect(s.getByTestId('copilot-sent')).toBeTruthy();
  for (const status of ['approved', 'rejected']) {
    recent = { suggestions: [{ ...pending, status, decided_at: '2026-10-22T09:00:00Z' }] };
    await act(async () => { await s.getByTestId('copilot-scroll').props.refreshControl.props.onRefresh(); });
    expect(await s.findByTestId(`copilot-status-${status}`)).toBeTruthy();
    expect(s.getAllByTestId(`copilot-status-${status}`)).toHaveLength(1);
    expect(s.queryByTestId('copilot-status-pending')).toBeNull();
    expect(s.queryByTestId('copilot-send')).toBeNull();
  }
});

test('B-R2-SEND: an unsent change under its answer is still not listed twice', async () => {
  routeGet();
  recent = { suggestions: [{ ...SUGGESTED, status: 'pending', id: 's9' }] };
  jest.mocked(sendMessage).mockResolvedValueOnce({ text: 'Done.', messageId: 'm1', interrupted: false, copilot: { sources: [], suggestion: { ...SUGGESTED, status: 'pending' } } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => fireEvent.press(await s.findByText('Explain my targets')));
  expect(s.getAllByTestId('copilot-status-pending')).toHaveLength(1);
});

test('B-R2-FALLBACK: a failed first read is the ledger retry notice with Roman; Try again reads again', async () => {
  get.mockRejectedValueOnce(Object.assign(new Error('http'), { response: { status: 500, data: {} } }));
  get.mockResolvedValue({ data: { suggestions: [] } } as never);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  const notice = await s.findByTestId('copilot-error');
  expect(notice.props.accessibilityRole).toBe('alert');
  expect(flat(notice)).toMatchObject({ backgroundColor: '#FFFFFF', borderColor: '#E6E9DF' });
  expect(s.getByTestId('copilot-error-roman')).toBeTruthy();
  expect(s.getByText('Your path could not load. Try again in a moment.')).toBeTruthy();
  await act(async () => fireEvent.press(s.getByTestId('copilot-error-retry')));
  expect(get.mock.calls.filter(([url]) => url === '/client/copilot').length).toBeGreaterThanOrEqual(2);
});

test('B-R2-FALLBACK: loading is the ledger card with cool bars, spoken as before, and still under Reduce Motion', async () => {
  get.mockReturnValue(new Promise(() => undefined) as never);
  (withRepeat as jest.Mock).mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => undefined);
  const box = s.getByTestId('copilot-loading');
  expect([box.props.accessibilityLabel, flat(box).backgroundColor]).toEqual(['Loading your path', '#FFFFFF']);
  const bars = s.getAllByTestId('copilot-loading-bar').map((v) => flat(v).backgroundColor);
  expect(bars.length).toBeGreaterThan(0);
  expect(new Set(bars)).toEqual(new Set(['#E6E9DF']));
  expect(withRepeat).not.toHaveBeenCalled();
});

test('B-R2-FALLBACK: with motion allowed the ledger bars pulse once the probe answers', async () => {
  get.mockReturnValue(new Promise(() => undefined) as never);
  (withRepeat as jest.Mock).mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  const s = await render(wrap(<ClientPathCopilotScreen />));
  await act(async () => undefined);
  expect(s.getByTestId('copilot-loading')).toBeTruthy();
  expect(withRepeat).toHaveBeenCalled();
});

test('B-878R2-G3: a client with no coach gets frame 12: Back to You, Roman 72, the words, Join a coach under them, help kept', async () => {
  mockNeedsCoach = true;
  const s = await render(wrap(<ClientPathCopilotScreen />));
  expect(get).not.toHaveBeenCalled();
  expect(s.getByTestId('copilot-coach-lock-back').props.accessibilityLabel).toBe('Back to You');
  expect(s.getByText('You')).toBeTruthy();
  expect(flat(s.getByTestId('copilot-coach-lock-roman'))).toMatchObject({ width: 72, height: 72 });
  expect(flat(s.getByTestId('copilot-coach-lock-title'))).toMatchObject({ fontSize: 32, fontFamily: 'CormorantGaramond_500Medium' });
  expect(s.getByTestId('copilot-coach-lock-title').props.children).toBe('Roman works with a coach');
  expect(flat(s.getByTestId('copilot-coach-lock-body'))).toMatchObject({ fontSize: 16, lineHeight: 24, color: '#5A5A56' });
  expect(s.queryByTestId('copilot-coach-lock-footer')).toBeNull();
  await act(async () => fireEvent.press(s.getByText('Join a coach')));
  expect(mockJoin).toHaveBeenCalledTimes(1);
  expect(flat(s.getByTestId('copilot-coach-lock-crisis')).color).toBe('#5A5A56');
  await act(async () => fireEvent.press(s.getByText('Contact support')));
  expect(mockSupport).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.press(s.getByTestId('copilot-coach-lock-back')));
  expect(mockBack).toHaveBeenCalledTimes(1);
});
