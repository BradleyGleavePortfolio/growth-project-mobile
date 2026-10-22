/**
 * "Plan ended last 7 days, {N}" on the coach Home (CHURN-M; ruling v3 6328335815 items 5-7; RENEWAL3 P1, P1-0, K1-K3):
 * b#1130's list, only when the server returns it; grouped by days since the end; a row opens to "Ask Roman to write"
 * (the Home's ask-first sheet, b#1130's draft route, nothing sent without Send) and "Message" (the chat in Messages).
 */
import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import {
  groupPlanEnded, homeLabel, homeLine, messagedLine, parsePlanEndedPage, readPlanEnded, rowLine, type PlanEndedRow,
} from '../screens/coach/home-v11/planEnded';

const [mockNavigate, mockGet, mockPost, mockApprove, mockReject] = Array.from({ length: 5 }, () => jest.fn());
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => true,
}));
jest.mock('react-native-safe-area-context', () => {
  const insets = { top: 47, bottom: 34, left: 0, right: 0 };
  return { useSafeAreaInsets: () => insets, SafeAreaInsetsContext: jest.requireActual('react').createContext(insets) };
});
jest.mock('react-native-svg', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const El = ({ children, testID }: { children?: React.ReactNode; testID?: string }) => R.createElement(View, { testID }, children);
  return { __esModule: true, default: El, Circle: El };
});
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: { softImpact: jest.fn(), mediumImpact: jest.fn(), selection: jest.fn(), lightImpact: jest.fn() } }));
jest.mock('../services/commandCenterApi', () => ({ ...jest.requireActual('../services/commandCenterApi'), __USING_MOCK_DATA: false, commandCenterApi: { getOverview: jest.fn() } }));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  coachApi: { getUnreadCounts: () => Promise.resolve({ data: { total: 0, by_client: {} } }) },
}));
jest.mock('../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { approveDraft: (id: string) => mockApprove(id), rejectDraft: (id: string) => mockReject(id) },
}));
const mockStore = { clients: [] as unknown[], filterStatus: 'active', loadError: null as string | null, loadClients: jest.fn(() => Promise.resolve()) };
jest.mock('../store/coachStore', () => {
  const useCoachStore = (sel: (s: typeof mockStore) => unknown) => sel(mockStore);
  useCoachStore.getState = () => mockStore;
  return { useCoachStore };
});
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => Promise.resolve(0) }));
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => ({ data: { drafts: [] }, refetch: jest.fn() }) }));
jest.mock('../config/featureFlags', () => ({ featureFlags: { coachHomeV11: true, romanChat: true, coachBrief: false, coachTabsV2: true } }));
jest.mock('../screens/coach/command-center/CoachHomeCards', () => ({ __esModule: true, default: () => null }));
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({
  coachHomeSources: { monthSoFar: () => Promise.reject(new Error('x')), nextPayout: () => Promise.reject(new Error('x')), ltv: () => Promise.reject(new Error('x')), atRisk: () => Promise.resolve([]) },
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CommandCenterScreen = require('../screens/coach/command-center/CommandCenterScreen').default as React.ComponentType;

const row = (id: string, name: string, days: number, pkg = '12-week block', messaged: string | null = null) => ({
  client_id: id, first_name: name.split(' ')[0], name, avatar_url: null, ended_at: '2026-10-21T09:00:00Z', ended_on: '2026-10-21',
  days_since: days, group: days === 0 ? 'today' : 'this_week', package_name: pkg, last_coach_message_at: messaged,
});
const ROWS = [row('c1', 'Maya Ortiz', 0), row('c2', 'Dev Patel', 0, 'Monthly coaching'), row('c3', 'Sam Okafor', 1, 'Monthly coaching', '2026-10-20T15:00:00Z'), row('c4', 'Lena Fischer', 3), row('c5', 'Omar Haddad', 6)];
const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({ time_zone: 'America/Los_Angeles', today: '2026-10-21', total: items.length, today_count: 0, items, next_cursor: null, ...extra });
let churned: () => Promise<unknown>;
const http404 = () => Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: { code: 'PLAN_RENEWAL_OFF' } } }));

beforeEach(() => {
  jest.clearAllMocks();
  churned = () => Promise.resolve({ data: page(ROWS) });
  mockGet.mockImplementation((url: string) => (url === '/v1/coach/churned-clients' ? churned()
    : Promise.resolve({ data: { roster_size: 30, active_today: 21, check_in_rate_7day: 0.82, open_alerts: 0, at_risk_count: 0, win_streak_count: 0, unread_messages: 0, pending_actions: 0 } })));
  mockPost.mockResolvedValue({ data: { enabled: true, provider: 'anthropic', reply: 'Hi Maya, how did the block feel?', approval: { required: true, status: 'pending', draft_id: 'dr-9' }, reason: { kind: 'plan_ended' } } });
  mockApprove.mockResolvedValue({ ok: true });
  mockReject.mockResolvedValue({ ok: true });
});

async function renderHome() {
  const view = await render(<CommandCenterScreen />);
  await waitFor(() => expect(view.getByTestId('home-alerts')).toBeTruthy());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return view;
}
type View = Awaited<ReturnType<typeof renderHome>>;
const press = (v: View, ...ids: string[]) => ids.reduce((p, id) => p.then(() => fireEvent.press(v.getByTestId(id))), Promise.resolve());
const churnReads = () => mockGet.mock.calls.filter(([url]) => url === '/v1/coach/churned-clients').length;

describe('plan ended: the read and its words', () => {
  it('reads every page, newest first, and is off on a 404 or an answer that is not the list', async () => {
    mockGet.mockResolvedValueOnce({ data: page(ROWS.slice(0, 2), { total: 3, next_cursor: 'k' }) }).mockResolvedValueOnce({ data: page(ROWS.slice(2, 3), { total: 3 }) });
    const all = await readPlanEnded();
    expect(mockGet.mock.calls).toEqual([['/v1/coach/churned-clients', { params: { take: 50 } }], ['/v1/coach/churned-clients', { params: { take: 50, cursor: 'k' } }]]);
    expect([all?.total, all?.items.map((r) => r.client_id)]).toEqual([3, ['c1', 'c2', 'c3']]);
    mockGet.mockImplementationOnce(http404);
    await expect(readPlanEnded()).resolves.toBeNull();
    mockGet.mockResolvedValueOnce({ data: { roster_size: 3 } });
    await expect(readPlanEnded()).resolves.toBeNull();
    mockGet.mockRejectedValueOnce(new Error('Network Error'));
    await expect(readPlanEnded()).rejects.toThrow('Network Error');
  });
  it('groups by days since the end (0, 1, 2 and more) and words each row', () => {
    const p = parsePlanEndedPage(page([...ROWS, { client_id: '', days_since: 0 }, row('c6', '', 2, '')]))!;
    expect(p.items.map((r) => r.client_id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
    expect(groupPlanEnded(p.items).map((g) => [g.label, g.rows.length])).toEqual([['Today', 2], ['Yesterday', 1], ['Earlier this week', 3]]);
    const [maya, , sam, lena, , c6] = p.items as PlanEndedRow[];
    expect([rowLine(maya), rowLine(sam), rowLine(lena), rowLine(c6), homeLine(lena)]).toEqual([
      'Plan ended today · 12-week block', 'Plan ended 1 day ago · Monthly coaching', 'Plan ended 3 days ago · 12-week block', 'Plan ended 2 days ago', 'Lena Fischer · ended 3 days ago',
    ]);
    expect(c6.name).toBe('Unnamed client');
    expect(messagedLine('2026-10-20T15:00:00Z', 'America/Los_Angeles')).toBe('Messaged Oct 20');
    expect(homeLabel(p)).toBe('Plan ended last 7 days, 7. Maya Ortiz, plan ended today, and 6 more'); // the server's total stands
    expect(homeLabel({ ...p, total: 1, items: [maya] })).toBe('Plan ended last 7 days, 1. Maya Ortiz, plan ended today');
  });
});

describe('plan ended on the coach Home', () => {
  it('shows P1 under the rings with the newest client and opens the grouped list', async () => {
    const v = await renderHome();
    expect(v.getByTestId('home-plan-ended').props.accessibilityLabel).toBe('Plan ended last 7 days, 5. Maya Ortiz, plan ended today, and 4 more');
    expect(v.getByText('Maya Ortiz · ended today')).toBeTruthy();
    await press(v, 'home-plan-ended');
    expect(v.getByTestId('plan-ended-list')).toBeTruthy();
    expect(v.getByText('NEWEST FIRST')).toBeTruthy();
    expect(['today', 'yesterday', 'week'].map((k) => v.getByTestId(`plan-ended-${k}`) && v.getByText(k === 'week' ? 'EARLIER THIS WEEK' : k.toUpperCase()).props.accessibilityLabel)).toEqual(['Today, 2', 'Yesterday, 1', 'Earlier this week, 2']);
    expect(v.getByText('Messaged Oct 20')).toBeTruthy();
    expect(churnReads()).toBe(2); // the Home's read, and a fresh one on open
    await press(v, 'plan-ended-back');
    await waitFor(() => expect(v.queryByTestId('plan-ended-list')).toBeNull());
  });
  it('shows P1-0, not a button, when nobody ended', async () => {
    churned = () => Promise.resolve({ data: page([]) });
    const v = await renderHome();
    expect(v.queryByTestId('home-plan-ended')).toBeNull();
    expect(v.getByTestId('home-plan-ended-none').props.accessibilityLabel).toBe('Plan ended last 7 days, 0. Clients whose plan ended show here, newest first.');
    expect(v.getByTestId('home-plan-ended-none').props.accessibilityRole).toBeUndefined();
  });
  it.each([['off on this server (404)', http404], ['not loaded', () => Promise.reject(new Error('Network Error'))]])('shows nothing when the list is %s', async (_, answer) => {
    churned = answer;
    const v = await renderHome();
    expect([v.queryByTestId('home-plan-ended'), v.queryByTestId('home-plan-ended-none')]).toEqual([null, null]);
  });
  it('keeps the rows and says so quietly when a re-read fails', async () => {
    const v = await renderHome();
    churned = () => Promise.reject(new Error('Network Error'));
    await press(v, 'home-plan-ended');
    await waitFor(() => expect(v.getByText('This list could not load. Check your connection, then try again.')).toBeTruthy());
    expect(v.getByText('Maya Ortiz')).toBeTruthy();
  });
  it('opens a row to Message, which goes to the chat in Messages; nothing is sent', async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c2');
    expect(v.getByTestId('plan-ended-row-c2').props.accessibilityState).toEqual({ expanded: true });
    await press(v, 'plan-ended-message');
    expect(mockNavigate).toHaveBeenCalledWith('Messages', { screen: 'ClientMessages', params: { clientId: 'c2', clientName: 'Dev Patel', initialDraft: undefined }, initial: false });
    expect([mockPost.mock.calls, mockApprove.mock.calls]).toEqual([[], []]);
  });
  it("asks first, asks b#1130's draft route, and sends only on Send", async () => {
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c1', 'plan-ended-ask');
    expect(v.getByText('Ask Roman to write to Maya?')).toBeTruthy();
    expect(within(v.getByTestId('home-draft-sheet')).getByText('Plan ended today · 12-week block')).toBeTruthy(); // the K3 context line
    expect(mockPost).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(v.getByTestId('home-draft-ask')); });
    expect(mockPost).toHaveBeenCalledWith('/v1/coach/churned-clients/c1/draft', {});
    await waitFor(() => expect(v.getByTestId('home-draft-text').props.children).toBe('Hi Maya, how did the block feel?'));
    expect(mockApprove).not.toHaveBeenCalled();
    const before = churnReads();
    await act(async () => { fireEvent.press(v.getByTestId('home-draft-send')); });
    expect(mockApprove).toHaveBeenCalledWith('dr-9');
    await waitFor(() => expect(churnReads()).toBe(before + 1)); // "Messaged" comes from the re-read
  });
  it("says Roman can't write while draft.coach_message is off, and Not now leaves nothing pending", async () => {
    mockPost.mockResolvedValue({ data: { enabled: false, reply: '', approval: { required: false, draft_id: null } } });
    const v = await renderHome();
    await press(v, 'home-plan-ended', 'plan-ended-row-c1', 'plan-ended-ask');
    await act(async () => { fireEvent.press(v.getByTestId('home-draft-ask')); });
    await waitFor(() => expect(v.getByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy());
    await press(v, 'home-draft-close');
    expect([mockApprove.mock.calls, mockReject.mock.calls, v.queryByTestId('home-draft-sheet')]).toEqual([[], [], null]);
    expect(v.getByTestId('plan-ended-list')).toBeTruthy(); // back on the list
  });
});
