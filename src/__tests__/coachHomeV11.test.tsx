/**
 * The coach Home (spec #688 6295886580, Style A; coachHomeV11, only with coachTabsV2: PK-2a): wins, tiles, alerts and rings
 * from b#1123's `home`, the overview alone without it; Needs you as the list counts it; ask-first Roman drafts; the wins
 * list; Reach-outs from the at-risk set the ring counts; a re-read on each return and after Send.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  parseHomeDay, ringSpecs, ringsCaption, winLine, winsHeadline, type HomeWin,
} from '../screens/coach/home-v11/homeDay';
import { needsAndSteady } from '../screens/coach/home-v11/useCoachHomeV11';

const [mockNavigate, mockGet, mockPost, mockUnreadCounts, mockApprove, mockReject, mockUnread, mockDrafts] = Array.from({ length: 8 }, () => jest.fn());
const mockFocus = { current: true };
const mockWindow = { width: 390, height: 844, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => mockFocus.current,
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
const mockHaptics = { softImpact: jest.fn(), mediumImpact: jest.fn(), selection: jest.fn(), lightImpact: jest.fn() };
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: mockHaptics }));
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  __USING_MOCK_DATA: false,
  commandCenterApi: { getOverview: jest.fn() },
}));
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  coachApi: { getUnreadCounts: () => mockUnreadCounts() },
}));
jest.mock('../api/coachAiExecutionApi', () => ({
  coachAiExecutionApi: { approveDraft: (id: string) => mockApprove(id), rejectDraft: (id: string) => mockReject(id) },
}));
const mockStore = { clients: [] as unknown[], filterStatus: 'active', loadError: null as string | null, loadClients: jest.fn() };
jest.mock('../store/coachStore', () => {
  const useCoachStore = (sel: (s: typeof mockStore) => unknown) => sel(mockStore);
  useCoachStore.getState = () => mockStore;
  return { useCoachStore };
});
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => mockUnread() }));
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => mockDrafts() }));
const mockFlags = { coachHomeV11: true, romanChat: true, coachBrief: false, coachTabsV2: true };
jest.mock('../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../screens/coach/command-center/CoachHomeCards', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: ({ part = 'all', brief = true }: { part?: string; brief?: boolean }) => R.createElement(Text, { testID: `cards-${part}` }, brief ? 'brief' : 'no brief') };
});
const mockScreen = (testID: string) => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: () => R.createElement(Text, { testID }, testID) };
};
jest.mock('../screens/coach/command-center/OverviewScreen', () => mockScreen('today-overview'));
jest.mock('../screens/coach/command-center/ActionQueueScreen', () => mockScreen('action-queue'));
jest.mock('../screens/coach/command-center/AtRiskScreen', () => mockScreen('at-risk'));
jest.mock('../screens/coach/command-center/WinStreaksScreen', () => mockScreen('win-streaks'));
jest.mock('../screens/coach/command-center/InboxScreen', () => mockScreen('inbox'));
const mockSources = { monthSoFar: jest.fn(), nextPayout: jest.fn(), ltv: jest.fn(), atRisk: jest.fn() };
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({ get coachHomeSources() { return mockSources; } }));

// Required after the mocks above exist (an import would be hoisted above them).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CommandCenterScreen = require('../screens/coach/command-center/CommandCenterScreen').default as React.ComponentType;

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const client = (id: string, firstName: string, lastName: string, activity: Record<string, unknown> | null) => ({
  id, firstName, lastName, email: `${id}@x.co`, role: 'client', status: 'active', createdAt: '2026-01-01T00:00:00Z', activity,
});
const overview = (roster: number) => ({
  roster_size: roster, active_today: roster ? 21 : 0, check_in_rate_7day: 0.82, open_alerts: 3,
  at_risk_count: roster ? 2 : 0, win_streak_count: 9, unread_messages: 1, pending_actions: 0,
});
const draft = (id: string) => ({ capability: 'draft.coach_message', subject_user_id: id, message: 'Write a short congratulations.' });
const win = (n: number): HomeWin => ({
  id: `w${n}`, kind: 'checkin_streak', client_id: `c${n}`, client_name: `Client${n} Last`, at: '2026-10-20T10:00:00Z',
  streak_days: 7, draft: draft(`c${n}`) as HomeWin['draft'],
});
const rings = (goal = 5) => ({ check_ins: { reviewed: 5, submitted: 9 }, replies: { answered: 1, received: 1 }, reach_outs: { contacted: 2, goal } });
const home = (wins: unknown[], count = wins.length, goal = 5) => ({ wins: { count, items: wins }, rings: rings(goal) });
const risk = (id: string, display_name: string, top_factor: string) => ({ user_id: id, display_name, bucket: 'red', risk_score: null, last_active_at: null, top_factor, days_since_checkin: 5 });
const summary = (netCents: number) => ({ currency: 'usd', changeCents: null, totals: { netCents, chargeCount: netCents ? 3 : 0 } });
const overviewReads = () => mockGet.mock.calls.filter(([url]) => url === '/coach/command-center/overview').length;

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockFlags, { coachHomeV11: true, coachTabsV2: true, romanChat: true });
  mockFocus.current = true;
  mockWindow.fontScale = 1;
  mockUnread.mockResolvedValue(2);
  mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1), win(2), win(3), win(4)], 12) } });
  Object.assign(mockStore, { filterStatus: 'active', loadError: null });
  mockStore.clients = [
    client('c1', 'Maya', 'Ortiz', { lastActiveOn: day(-8), checkInsToReview: 0 }),
    client('c2', 'Ana', 'Ruiz', { lastActiveOn: day(0), checkInsToReview: 2 }),
    client('c3', 'Ben', 'Cole', { lastActiveOn: day(0), checkInsToReview: 0 }),
    client('c4', 'Dee', 'Fox', { lastActiveOn: day(-1), checkInsToReview: 0 }),
  ];
  mockStore.loadClients.mockResolvedValue(undefined);
  mockUnreadCounts.mockResolvedValue({ data: { total: 0, by_client: {} } });
  mockSources.ltv.mockResolvedValue({ active_client_count: 30, churn_rate_pct: 5, mrr_30d_ago_cents: 100000 });
  mockSources.monthSoFar.mockResolvedValue(summary(214000));
  mockSources.nextPayout.mockResolvedValue({ amountCents: 48600, currency: 'usd', arrivalDate: null });
  mockSources.atRisk.mockResolvedValue([risk('r1', 'Jordan Ellis', 'No check-in for 5 days'), risk('r2', 'Priya Nair', 'Food logging stopped')]);
  mockDrafts.mockReturnValue({
    data: { drafts: ['draft.assign_workout', 'draft.assign_workout', 'draft.send_notification', 'draft.coach_message'].map((capability, i) => ({ id: `d${i}`, capability })) },
    refetch: jest.fn(),
  });
  mockPost.mockResolvedValue({ data: { enabled: true, provider: 'anthropic', reply: 'Seven days straight, Client1. Proud of you.', approval: { required: true, status: 'pending', draft_id: 'dr-1' } } });
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
const label = (v: View, id: string) => v.getByTestId(id).props.accessibilityLabel as string;
const press = (v: View, ...ids: string[]) => ids.reduce((p, id) => p.then(() => fireEvent.press(v.getByTestId(id))), Promise.resolve());

describe('coach Home, flag on, with home (b#1123) and on an older server without it', () => {
  it('asks for include=home and draws the wins hero with one win, tiles, alerts and rings', async () => {
    const v = await renderHome();
    expect(mockGet).toHaveBeenCalledWith('/coach/command-center/overview', { params: { include: 'home' } });
    expect(v.getByText('12')).toBeTruthy();
    expect(v.getByText('wins this week')).toBeTruthy();
    expect(['w1', 'w2', 'w3', 'w4'].map((w) => !!v.queryByTestId(`home-win-${w}`))).toEqual([true, false, false, false]);
    expect(Object.fromEntries(['home-tile-active', 'home-tile-checkins', 'home-tile-stayed', 'home-alerts', 'home-ring-check_ins', 'home-ring-replies', 'home-ring-reach_outs', 'home-wins-all'].map((id) => [id, label(v, id)]))).toEqual({
      'home-tile-active': '21 of 30 active today', 'home-tile-checkins': '82% check-ins · last 7 days', 'home-tile-stayed': '95% stayed · this month',
      'home-alerts': 'Open alerts, 3', 'home-ring-check_ins': 'Check-ins, 5 of 9', 'home-ring-replies': 'Replies, 1 of 1',
      'home-ring-reach_outs': 'Reach-outs, 2 of 5', 'home-wins-all': '12 wins this week. See all',
    });
    expect([!!v.getByText('The day is in motion. Close the rings as you go.'), v.getByText('5/9').props]).toEqual([true, expect.objectContaining({ adjustsFontSizeToFit: true, minimumFontScale: 0.5, maxFontSizeMultiplier: 1 })]); // 112/140 fits (LO B2)
    expect(v.queryByTestId('command-center-settings')).toBeNull(); // no tab row on the Home itself
    expect(v.getByTestId('cards-setup')).toBeTruthy(); // the setup checklist on the hero, the push ask and brief under it
    expect(v.queryByTestId('cards-all')).toBeNull();
    expect(v.getByTestId('cards-below').props.children).toBe('brief');
  });
  it('counts Needs you as the list does, names the most urgent, and opens the list', async () => {
    const v = await renderHome();
    // Maya: last logged 8 days ago (nudge); Ana: 2 check-ins to review. Ben and Dee are steady.
    expect(label(v, 'home-needs')).toMatch(/^Needs you, 2\. /);
    await press(v, 'home-needs');
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'ClientsList', params: { view: 'needs' }, pop: true });
    expect([label(v, 'home-row-steady'), label(v, 'home-row-all'), label(v, 'home-row-streaks')]).toEqual(['Steady, 2, 1 logged today', 'All 30 clients, Open Clients', 'Streaks, 9']);
  });
  it.each([
    ['home-drafts', 'ClientsStack', { screen: 'PendingAiDrafts', initial: false }],
    ['home-ask-roman', 'SettingsStack', { screen: 'RomanChat', initial: false }],
    ['home-bell', 'ClientsStack', { screen: 'NotificationCenter', initial: false }],
    ['home-gear', 'SettingsStack', { screen: 'SettingsHome', pop: true }],
    ['home-month', 'MoneyStack', { screen: 'CoachMoney', pop: true }],
  ])('%s opens %s', async (id, stack, params) => {
    const v = await renderHome();
    await press(v, id);
    expect(mockNavigate).toHaveBeenCalledWith(stack, params);
  });
  it.each([[1, 'Ask,Workouts,Approve', true], [1.3, 'Approve,Workouts,Ask', false]])('orders the Roman card for the first screen at %sx text, the win line only at 1x (LS B2)', async (scale, order, winLine) => {
    mockWindow.fontScale = scale;
    const v = await renderHome();
    const seen = v.getAllByText(/^(Approve Roman|Ask Roman)|Workouts$/).map((n) => /^(Approve|Ask|Workouts)/.exec(String(n.props.children))?.[1]); // screen order
    expect([[...new Set(seen.filter(Boolean))].join(), !!v.queryByTestId('home-win-w1'), label(v, 'home-wins-all')]).toEqual([order, winLine, '12 wins this week. See all']);
  });
  it("opens alerts in Actions with the tab row back, and labels Roman's drafts", async () => {
    const v = await renderHome();
    expect(label(v, 'home-drafts')).toBe("Approve Roman's drafts, 3");
    await press(v, 'home-alerts');
    await waitFor(() => expect(v.getByTestId('action-queue')).toBeTruthy());
    expect(v.getByTestId('command-center-settings')).toBeTruthy();
    expect(v.getByText('Home')).toBeTruthy();
  });
  it("asks first before Roman writes to a win's client, cannot close while Roman writes, sends only on Send, then re-reads", async () => {
    let answer: (v: unknown) => void = () => undefined;
    mockPost.mockReturnValueOnce(new Promise((r) => { answer = r; }));
    const v = await renderHome();
    await press(v, 'home-wins-all', 'home-list-w1');
    expect(v.getByText('Ask Roman to write to Client1?')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
    await press(v, 'home-draft-ask');
    expect(mockPost).toHaveBeenCalledWith('/ai/gateway/invoke', draft('c1'));
    await fireEvent.press(v.getAllByLabelText('Close').slice(-1)[0]); // the scrim, while Roman writes
    expect(v.getByTestId('home-draft-sheet')).toBeTruthy();
    await act(async () => answer({ data: { enabled: true, provider: 'anthropic', reply: 'Proud of you.', approval: { required: true, draft_id: 'dr-1' } } }));
    await waitFor(() => expect(v.getByTestId('home-draft-text')).toBeTruthy());
    expect(mockApprove).not.toHaveBeenCalled();
    const before = overviewReads();
    await press(v, 'home-draft-send');
    expect(mockApprove).toHaveBeenCalledWith('dr-1');
    expect(v.getByText('Sent to Client1')).toBeTruthy();
    await waitFor(() => expect(overviewReads()).toBe(before + 1)); // the rings move after Send
  });
  it('turns a written draft down on Not now, so nothing waits to be sent', async () => {
    const v = await renderHome();
    await press(v, 'home-wins-all', 'home-list-w2', 'home-draft-ask');
    await waitFor(() => expect(v.getByTestId('home-draft-text')).toBeTruthy());
    await press(v, 'home-draft-close');
    expect(mockReject).toHaveBeenCalledWith('dr-1');
    expect(mockApprove).not.toHaveBeenCalled();
    expect(v.queryByTestId('home-draft-sheet')).toBeNull();
  });
  it('says nothing was sent when Roman is off, and offers no Send', async () => {
    mockPost.mockResolvedValue({ data: { enabled: false, provider: 'stub', reply: '', approval: { required: false, draft_id: null } } });
    const v = await renderHome();
    await press(v, 'home-wins-all', 'home-list-w1', 'home-draft-ask');
    expect(v.getByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy();
    expect([v.queryByTestId('home-draft-send'), label(v, 'home-draft-ask')]).toEqual([null, 'Try again']); // says what it shows (LO C1)
  });
  it("opens the wins list from the headline, and a win's ask-first draft in that same sheet, back to the list (B3, LO B1)", async () => {
    const v = await renderHome();
    await press(v, 'home-wins-all');
    expect(v.getByText('Wins this week')).toBeTruthy();
    expect(['w1', 'w2', 'w3', 'w4'].map((w) => label(v, `home-list-${w}`))).toEqual([1, 2, 3, 4].map((n) => `Client${n} hit a 7-day check-in streak. Ask Roman to congratulate Client${n}`));
    await press(v, 'home-list-w4');
    expect([!!v.getByText('Ask Roman to write to Client4?'), v.getAllByLabelText('Close').length, mockPost.mock.calls.length]).toEqual([true, 1, 0]);
    await press(v, 'home-draft-close');
    expect([!!v.queryByTestId('home-draft-sheet'), !!v.queryByTestId('home-list-w4')]).toEqual([false, true]);
    await press(v, 'home-list-close');
    expect(v.queryByTestId('home-list-sheet')).toBeNull();
  });
  it('lists the at-risk clients the Reach-outs ring counts, with the server reason, ask-first (B1)', async () => {
    const v = await renderHome();
    await press(v, 'home-ring-reach_outs');
    expect([label(v, 'home-list-r1'), label(v, 'home-list-r2')]).toEqual(['Reach out to Jordan Ellis?', 'Reach out to Priya Nair?']);
    expect(v.getByText('No check-in for 5 days')).toBeTruthy();
    expect(v.queryByTestId('home-list-c1')).toBeNull(); // the Needs you list's rule is not this ring's
    await press(v, 'home-list-r1');
    expect(v.getByText('Ask Roman to write to Jordan?')).toBeTruthy();
    await press(v, 'home-draft-ask');
    expect(mockPost).toHaveBeenCalledWith('/ai/gateway/invoke', expect.objectContaining({ capability: 'draft.coach_message', subject_user_id: 'r1' }));
    expect(mockPost.mock.calls[0][1].message).toMatch(/For you only, never say it to them: No check-in for 5 days\./); // LO C4
  });
  it.each([
    ['the ring has no goal', () => mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1)], 1, 0) } })],
    ['the at-risk list is empty', () => mockSources.atRisk.mockResolvedValue([])],
    ['the at-risk read fails', () => mockSources.atRisk.mockRejectedValue(new Error('down'))],
  ])('draws Reach-outs as not tappable when %s', async (_, arrange) => {
    arrange();
    const v = await renderHome();
    expect(v.getByTestId('home-ring-reach_outs').props.accessibilityRole).not.toBe('button');
  });
  it('re-reads the day, roster and at-risk list on each return to the Home, not on blur (B2), and stops the win turn on blur (LO C2)', async () => {
    const [run, stop, v] = [jest.spyOn(global, 'setInterval'), jest.spyOn(global, 'clearInterval'), await renderHome()]; const turns = () => run.mock.results.filter((r, i) => run.mock.calls[i][1] === 6000 && !stop.mock.calls.some(([id]) => id === r.value)).length;
    expect([overviewReads(), turns()]).toEqual([1, 1]);
    mockFocus.current = false;
    await act(async () => v.rerender(<CommandCenterScreen />));
    expect([overviewReads(), turns()]).toEqual([1, 0]);
    mockFocus.current = true;
    await act(async () => v.rerender(<CommandCenterScreen />));
    await waitFor(() => expect(overviewReads()).toBe(2));
    expect(mockSources.atRisk).toHaveBeenCalledTimes(2);
    expect(mockStore.loadClients).toHaveBeenCalledTimes(2); // mount and the return, not twice on mount (LO C1)
  });
  it("draws the overview's own figure and tiles and no rings or wins (no invented number)", async () => {
    mockGet.mockResolvedValue({ data: overview(30) });
    const v = await renderHome();
    expect(v.getByText('ACTIVE TODAY')).toBeTruthy();
    expect(['home-hero-today', 'home-hero-wins', 'home-rings', 'home-tile-active', 'home-tile-checkins'].map((id) => !!v.queryByTestId(id))).toEqual([true, false, false, false, true]);
  });
  it('leaves Stayed out when there is no real base', async () => {
    mockSources.ltv.mockResolvedValue({ active_client_count: 0, churn_rate_pct: 0, mrr_30d_ago_cents: 0 });
    expect((await renderHome()).queryByTestId('home-tile-stayed')).toBeNull();
  });
});

describe('coach Home at zero clients, at 1,000 and on failures', () => {
  it('says so at zero clients: no tiles, empty Needs you, Roman waits, no brief, no Clients rows', async () => {
    mockGet.mockResolvedValue({ data: { ...overview(0), home: home([], 0, 0) } });
    mockStore.clients = [];
    mockDrafts.mockReturnValue({ data: { drafts: [] }, refetch: jest.fn() });
    mockSources.monthSoFar.mockResolvedValue(summary(0));
    mockSources.nextPayout.mockResolvedValue(null);
    const v = await renderHome();
    expect(v.getByTestId('home-hero-zero')).toBeTruthy();
    expect(v.queryByTestId('home-tiles')).toBeNull();
    for (const t of ['Clients who need you show here, most urgent first.', 'Roman drafts replies and workout changes for you once clients join.', 'Your day fills in when your first client joins.', 'Nothing earned yet this month.']) {
      expect(v.getByText(t)).toBeTruthy();
    }
    expect(v.getByTestId('cards-below').props.children).toBe('no brief'); // OPERATOR RULING 6296068749
    expect(v.queryByTestId('home-clients')).toBeNull();
    expect(v.getByTestId('home-ring-reach_outs').props.accessibilityRole).not.toBe('button');
  });
  it('groups the thousands at 1,000 clients', async () => {
    mockGet.mockResolvedValue({ data: { ...overview(1000), active_today: 1000, home: home([win(1)]) } });
    const v = await renderHome();
    expect([label(v, 'home-tile-active'), label(v, 'home-row-all')]).toEqual(['1,000 of 1,000 active today', 'All 1,000 clients, Open Clients']);
  });
  it('says so with Try again when the overview cannot load', async () => {
    mockGet.mockRejectedValue(new Error('down'));
    const v = await render(<CommandCenterScreen />);
    await waitFor(() => expect(v.getByTestId('home-retry')).toBeTruthy());
    mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1)]) } });
    await press(v, 'home-retry');
    await waitFor(() => expect(v.getByTestId('home-hero-wins')).toBeTruthy());
  });
  it('tells a failed Needs you or drafts read from an empty one, with Try again', async () => {
    Object.assign(mockStore, { loadError: 'Clients did not load. Check the connection and try again.', clients: [] });
    mockDrafts.mockReturnValue({ data: undefined, isError: true, error: new Error('x'), refetch: jest.fn() });
    const v = await renderHome();
    expect(['home-needs-error', 'home-drafts-error', 'home-month'].map((id) => !!v.queryByTestId(id))).toEqual([true, true, true]);
  });
  it('says Needs you did not load when the unread counts fail, never "Nobody needs you", and keeps a good read (LS B1)', async () => {
    mockStore.clients = [client('c3', 'Ben', 'Cole', { lastActiveOn: day(0), checkInsToReview: 0 })];
    mockUnreadCounts.mockRejectedValueOnce(new Error('down'));
    const v = await renderHome();
    expect([!!v.queryByTestId('home-needs-error'), !!v.queryByText('Nobody needs you right now.'), !!v.queryByTestId('home-row-steady')]).toEqual([true, false, false]);
    mockUnreadCounts.mockResolvedValue({ data: { total: 1, by_client: { c3: 1 } } });
    await press(v, 'home-needs-error-retry');
    await waitFor(() => expect(label(v, 'home-needs')).toMatch(/^Needs you, 1\. Ben Cole/));
    mockUnreadCounts.mockRejectedValueOnce(new Error('down'));
    for (const f of [false, true]) { mockFocus.current = f; await act(async () => v.rerender(<CommandCenterScreen />)); } // away and back
    await waitFor(() => expect(mockUnreadCounts).toHaveBeenCalledTimes(3));
    expect(label(v, 'home-needs')).toMatch(/^Needs you, 1\. Ben Cole/); // the failed refresh keeps the verified answer
  });
  it('draws no Needs you count while the Clients list is on Archived', async () => {
    mockStore.filterStatus = 'archived';
    const v = await renderHome();
    expect(label(v, 'home-needs')).toBe('Needs you. Open the list');
    expect(mockStore.loadClients).not.toHaveBeenCalled();
  });
});

describe('coach Home off', () => {
  // PK-2a: never without its Money tab (coachTabsV2).
  it.each([[{ coachHomeV11: false }], [{ coachTabsV2: false }]])("keeps today's Overview with %o", async (flags) => {
    Object.assign(mockFlags, flags);
    const v = await render(<CommandCenterScreen />);
    expect(v.getByTestId('today-overview')).toBeTruthy();
    expect(v.queryByTestId('coach-home-v11')).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});

describe('homeDay, pure', () => {
  it('reads home, leaving out a malformed or unknown win and a draft about anyone else', () => {
    const h = parseHomeDay(home([
      win(1), { ...win(2), kind: 'mystery' }, { ...win(3), draft: draft('someone-else') },
      { id: 'w5', kind: 'lifting_best', client_id: 'c5', client_name: 'Rae Kim', at: 'x', exercise: 'Bench Press', weight_lbs: 205, reps: 3, draft: draft('c5') },
      { id: 'w6', kind: 'goal_weight', client_id: 'c6', client_name: 'Lou Park', at: 'x', weight_lbs: 179.6, goal_weight_lbs: 180, draft: draft('c6') },
    ], 9));
    expect(h?.wins.count).toBe(9);
    expect(h?.wins.items.map(winLine)).toEqual(['Client1 hit a 7-day check-in streak', 'Rae set a best: Bench Press, 205 lb for 3', 'Lou reached goal weight, 180 lb']);
  });
  it('is absent without a readable wins count, and draws no rings it cannot read', () => {
    expect([parseHomeDay(undefined), parseHomeDay({ wins: { count: -1, items: [] } })]).toEqual([null, null]);
    expect(parseHomeDay({ wins: { count: 2, items: [] }, rings: { check_ins: { reviewed: 1 } } })?.rings).toBeNull();
  });
  it('words the hero and captions the rings', () => {
    expect(winsHeadline(1)).toEqual({ value: '1', unit: 'win this week' });
    const zero = { reviewed: 0, submitted: 0 };
    expect([
      ringsCaption(ringSpecs({ check_ins: { reviewed: 2, submitted: 2 }, replies: { answered: 0, received: 0 }, reach_outs: { contacted: 5, goal: 5 } }), 10),
      ringsCaption(ringSpecs({ check_ins: zero, replies: { answered: 0, received: 0 }, reach_outs: { contacted: 0, goal: 0 } }), 10),
    ]).toEqual(['Every ring is closed for today.', 'Nothing to close yet today.']);
  });
  it('splits the roster into Needs you and Steady by the list rule, archived left out', () => {
    const rows = needsAndSteady([
      client('a', 'A', 'One', { lastActiveOn: day(0), checkInsToReview: 0 }),
      client('b', 'B', 'Two', { lastActiveOn: day(0), checkInsToReview: 0 }),
      { ...client('z', 'Z', 'Gone', null), status: 'archived' },
    ] as never, { b: 2 }, new Date());
    expect([rows.needs.map((r) => r.client.id), rows.needs[0].reason.text, rows.steady]).toEqual([['b'], '2 new messages', { count: 1, loggedToday: 1 }]);
  });
});

describe('coach Home flag wiring', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  it('adds no Money tab of its own, and names the first tab "Home" only with the new Home', () => {
    const nav = read('src', 'navigation', 'CoachNavigator.tsx');
    expect(nav.match(/name="MoneyStack"/g)).toHaveLength(1);
    expect(nav).toMatch(/const homeTabLabel = tabsV2 && featureFlags\.coachHomeV11 \? 'Home' : 'Overview';/);
  });
  it('is off by default in featureFlags.ts and in no EAS profile, so the default is the OTA switch', () => {
    expect(read('src', 'config', 'featureFlags.ts')).toMatch(/coachHomeV11: readFlag\('EXPO_PUBLIC_FF_COACH_HOME_V11', false\)/);
    const eas = JSON.parse(read('eas.json')) as { build: Record<string, { env?: Record<string, string> }> };
    for (const [name, profile] of Object.entries(eas.build)) expect(`${name}:${profile.env?.EXPO_PUBLIC_FF_COACH_HOME_V11}`).toBe(`${name}:undefined`);
  });
});
