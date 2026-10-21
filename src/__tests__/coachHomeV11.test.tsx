/**
 * The coach Home (spec #688 6295886580, Style A; featureFlags.coachHomeV11, drawn only with coachTabsV2 on: owner
 * PK-2a): "{n} wins this week" with three wins, the small tiles, Open alerts and the day's rings from b#1123's
 * `home`; without it, the overview's own figures and no rings (no invented number). Needs you is one tile counted
 * as the Needs you list counts it, and opens that list; the Roman drafts from a win or a reach-out are ask-first,
 * and nothing is sent until Send. The flag is off by default, with no eas.json line, and the first tab is "Home".
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  parseHomeDay, ringSpecs, ringsCaption, winLine, winWindow, winsHeadline, type HomeWin,
} from '../screens/coach/home-v11/homeDay';
import { needsAndSteady } from '../screens/coach/home-v11/useCoachHomeV11';

const mockNavigate = jest.fn();
const mockFocus = { current: true };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => mockFocus.current,
}));
jest.mock('react-native-safe-area-context', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const insets = { top: 47, bottom: 34, left: 0, right: 0 };
  return { useSafeAreaInsets: () => insets, SafeAreaInsetsContext: R.createContext(insets) };
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
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockUnreadCounts = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
  coachApi: { getUnreadCounts: () => mockUnreadCounts() },
}));
const mockApprove = jest.fn();
const mockReject = jest.fn();
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
const mockUnread = jest.fn();
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => mockUnread() }));
const mockDrafts = jest.fn();
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
const home = (wins: unknown[], count = wins.length) => ({
  date: '2026-10-21', week_start: '2026-10-19', time_zone: 'America/Los_Angeles',
  wins: { count, items: wins },
  rings: { check_ins: { reviewed: 5, submitted: 9 }, replies: { answered: 1, received: 1 }, reach_outs: { contacted: 2, goal: 5 } },
});
const summary = (netCents: number) => ({ currency: 'usd', changeCents: null, totals: { netCents, chargeCount: netCents ? 3 : 0 } });

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockFlags, { coachHomeV11: true, coachTabsV2: true, romanChat: true });
  mockFocus.current = true;
  mockUnread.mockResolvedValue(2);
  mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1), win(2), win(3), win(4)], 12) } });
  mockStore.filterStatus = 'active';
  mockStore.loadError = null;
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
  mockDrafts.mockReturnValue({
    data: { drafts: [
      { id: 'd1', capability: 'draft.assign_workout' }, { id: 'd2', capability: 'draft.assign_workout' },
      { id: 'd3', capability: 'draft.send_notification' }, { id: 'd4', capability: 'draft.coach_message' },
    ] },
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
const label = (v: Awaited<ReturnType<typeof renderHome>>, id: string) => v.getByTestId(id).props.accessibilityLabel as string;

describe('coach Home, flag on, with home (b#1123)', () => {
  it('asks the overview for include=home and draws the wins hero, three wins, the tiles and Open alerts', async () => {
    const v = await renderHome();
    expect(mockGet).toHaveBeenCalledWith('/coach/command-center/overview', { params: { include: 'home' } });
    expect(v.getByTestId('home-hero-wins')).toBeTruthy();
    expect(v.getByText('12')).toBeTruthy();
    expect(v.getByText('wins this week')).toBeTruthy();
    expect(v.getByTestId('home-win-w1')).toBeTruthy();
    expect(v.getByTestId('home-win-w3')).toBeTruthy();
    expect(v.queryByTestId('home-win-w4')).toBeNull();
    expect(label(v, 'home-tile-active')).toBe('21 of 30 active today');
    expect(label(v, 'home-tile-checkins')).toBe('82% check-ins · last 7 days');
    expect(label(v, 'home-tile-stayed')).toBe('95% stayed · this month');
    expect(label(v, 'home-alerts')).toBe('Open alerts, 3');
    expect(v.queryByTestId('command-center-settings')).toBeNull(); // no tab row on the Home itself
  });

  it('draws the three rings from the server and nothing else', async () => {
    const v = await renderHome();
    expect(label(v, 'home-ring-check_ins')).toBe('Check-ins, 5 of 9');
    expect(label(v, 'home-ring-replies')).toBe('Replies, 1 of 1');
    expect(label(v, 'home-ring-reach_outs')).toBe('Reach-outs, 2 of 5');
    expect(v.getByText('The day is in motion. Close the rings as you go.')).toBeTruthy();
  });

  it('counts Needs you as the list does, names the most urgent, and opens the list', async () => {
    const v = await renderHome();
    // Maya: last logged 8 days ago (nudge); Ana: 2 check-ins to review. Ben and Dee are steady.
    expect(label(v, 'home-needs')).toMatch(/^Needs you, 2\. /);
    await fireEvent.press(v.getByTestId('home-needs'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'ClientsList', params: { view: 'needs' }, pop: true });
    expect(label(v, 'home-row-steady')).toBe('Steady, 2, 1 logged today');
    expect(label(v, 'home-row-all')).toBe('All 30 clients, Open Clients');
    expect(label(v, 'home-row-streaks')).toBe('Streaks, 9');
  });

  it('opens Roman, the drafts, the bell, the gear, Money, alerts and streaks', async () => {
    const v = await renderHome();
    expect(label(v, 'home-drafts')).toBe("Approve Roman's drafts, 3");
    await fireEvent.press(v.getByTestId('home-drafts'));
    expect(mockHaptics.mediumImpact).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'PendingAiDrafts', initial: false });
    await fireEvent.press(v.getByTestId('home-ask-roman'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'RomanChat', initial: false });
    await fireEvent.press(v.getByTestId('home-bell'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', initial: false });
    await fireEvent.press(v.getByTestId('home-gear'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'SettingsHome', pop: true });
    await fireEvent.press(v.getByTestId('home-month'));
    expect(mockNavigate).toHaveBeenCalledWith('MoneyStack', { screen: 'CoachMoney', pop: true });
    await fireEvent.press(v.getByTestId('home-alerts'));
    await waitFor(() => expect(v.getByTestId('action-queue')).toBeTruthy()); // Actions, with the tab row back
    expect(v.getByTestId('command-center-settings')).toBeTruthy();
    expect(v.getByText('Home')).toBeTruthy();
  });

  it('puts the setup checklist on the hero and the push ask and brief under it', async () => {
    const v = await renderHome();
    expect(v.getByTestId('cards-setup')).toBeTruthy();
    expect(v.getByTestId('cards-below')).toBeTruthy();
    expect(v.queryByTestId('cards-all')).toBeNull();
    expect(v.getByTestId('cards-below').props.children).toBe('brief');
  });

  it("asks first before Roman writes to a win's client, and sends only on Send", async () => {
    const v = await renderHome();
    await fireEvent.press(v.getByTestId('home-win-w1'));
    expect(v.getByText('Ask Roman to write to Client1?')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
    await fireEvent.press(v.getByTestId('home-draft-ask'));
    expect(mockPost).toHaveBeenCalledWith('/ai/gateway/invoke', draft('c1'));
    await waitFor(() => expect(v.getByTestId('home-draft-text')).toBeTruthy());
    expect(mockApprove).not.toHaveBeenCalled();
    await fireEvent.press(v.getByTestId('home-draft-send'));
    expect(mockApprove).toHaveBeenCalledWith('dr-1');
    expect(v.getByText('Sent to Client1')).toBeTruthy();
  });

  it('turns a written draft down on Not now, so nothing waits to be sent', async () => {
    const v = await renderHome();
    await fireEvent.press(v.getByTestId('home-win-w2'));
    await fireEvent.press(v.getByTestId('home-draft-ask'));
    await waitFor(() => expect(v.getByTestId('home-draft-text')).toBeTruthy());
    await fireEvent.press(v.getByTestId('home-draft-close'));
    expect(mockReject).toHaveBeenCalledWith('dr-1');
    expect(mockApprove).not.toHaveBeenCalled();
    expect(v.queryByTestId('home-draft-sheet')).toBeNull();
  });

  it('says nothing was sent when Roman is off, and offers Try again', async () => {
    mockPost.mockResolvedValue({ data: { enabled: false, provider: 'stub', reply: '', approval: { required: false, draft_id: null } } });
    const v = await renderHome();
    await fireEvent.press(v.getByTestId('home-win-w1'));
    await fireEvent.press(v.getByTestId('home-draft-ask'));
    expect(v.getByText("Roman can't write this right now. Nothing was sent.")).toBeTruthy();
    expect(v.queryByTestId('home-draft-send')).toBeNull();
  });

  it('lists one "Reach out to {name}?" per client who needs the coach from the Reach-outs ring, ask-first', async () => {
    const v = await renderHome();
    await fireEvent.press(v.getByTestId('home-ring-reach_outs'));
    expect(label(v, 'home-reach-c1')).toBe('Reach out to Maya Ortiz?');
    expect(label(v, 'home-reach-c2')).toBe('Reach out to Ana Ruiz?');
    expect(v.queryByTestId('home-reach-c3')).toBeNull();
    await fireEvent.press(v.getByTestId('home-reach-c1'));
    expect(v.getByText('Ask Roman to write to Maya?')).toBeTruthy();
    expect(mockPost).not.toHaveBeenCalled();
    await fireEvent.press(v.getByTestId('home-draft-ask'));
    expect(mockPost).toHaveBeenCalledWith('/ai/gateway/invoke', expect.objectContaining({ capability: 'draft.coach_message', subject_user_id: 'c1' }));
  });
});

describe('coach Home without home (an older server)', () => {
  it("draws the overview's own figure and tiles and no rings or wins (no invented number)", async () => {
    mockGet.mockResolvedValue({ data: overview(30) });
    const v = await renderHome();
    expect(v.getByTestId('home-hero-today')).toBeTruthy();
    expect(v.getByText('ACTIVE TODAY')).toBeTruthy();
    expect(v.queryByTestId('home-hero-wins')).toBeNull();
    expect(v.queryByTestId('home-rings')).toBeNull();
    expect(v.queryByTestId('home-tile-active')).toBeNull();
    expect(v.getByTestId('home-tile-checkins')).toBeTruthy();
  });

  it('leaves Stayed out when there is no real base', async () => {
    mockSources.ltv.mockResolvedValue({ active_client_count: 0, churn_rate_pct: 0, mrr_30d_ago_cents: 0 });
    const v = await renderHome();
    expect(v.queryByTestId('home-tile-stayed')).toBeNull();
  });
});

describe('coach Home at zero clients and on failures', () => {
  it('says so at zero clients: no tiles, empty Needs you, Roman waits, no Clients rows', async () => {
    mockGet.mockResolvedValue({ data: { ...overview(0), home: home([], 0) } });
    mockStore.clients = [];
    mockDrafts.mockReturnValue({ data: { drafts: [] }, refetch: jest.fn() });
    mockSources.monthSoFar.mockResolvedValue(summary(0));
    mockSources.nextPayout.mockResolvedValue(null);
    const v = await renderHome();
    expect(v.getByTestId('home-hero-zero')).toBeTruthy();
    expect(v.queryByTestId('home-tiles')).toBeNull();
    expect(v.getByText('Clients who need you show here, most urgent first.')).toBeTruthy();
    expect(v.getByText('Roman drafts replies and workout changes for you once clients join.')).toBeTruthy();
    expect(v.getByText('Your day fills in when your first client joins.')).toBeTruthy();
    expect(v.getByTestId('cards-below').props.children).toBe('no brief'); // OPERATOR RULING 6296068749
    expect(v.getByText('Nothing earned yet this month.')).toBeTruthy();
    expect(v.queryByTestId('home-clients')).toBeNull();
    expect(v.queryByTestId('home-ring-reach_outs')?.props.accessibilityRole).not.toBe('button');
  });

  it('says so with Try again when the overview cannot load', async () => {
    mockGet.mockRejectedValue(new Error('down'));
    const v = await render(<CommandCenterScreen />);
    await waitFor(() => expect(v.getByTestId('home-retry')).toBeTruthy());
    mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1)]) } });
    await fireEvent.press(v.getByTestId('home-retry'));
    await waitFor(() => expect(v.getByTestId('home-hero-wins')).toBeTruthy());
  });

  it("tells a failed Needs you or drafts read from an empty one, with Try again", async () => {
    mockStore.loadError = 'Clients did not load. Check the connection and try again.';
    mockStore.clients = [];
    mockDrafts.mockReturnValue({ data: undefined, isError: true, error: new Error('x'), refetch: jest.fn() });
    const v = await renderHome();
    expect(v.getByTestId('home-needs-error')).toBeTruthy();
    expect(v.getByTestId('home-drafts-error')).toBeTruthy();
    expect(v.getByTestId('home-month')).toBeTruthy();
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
      win(1),
      { ...win(2), kind: 'mystery' },
      { ...win(3), draft: draft('someone-else') },
      { id: 'w5', kind: 'lifting_best', client_id: 'c5', client_name: 'Rae Kim', at: 'x', exercise: 'Bench Press', weight_lbs: 205, reps: 3, draft: draft('c5') },
      { id: 'w6', kind: 'goal_weight', client_id: 'c6', client_name: 'Lou Park', at: 'x', weight_lbs: 179.6, goal_weight_lbs: 180, draft: draft('c6') },
    ], 9));
    expect(h?.wins.count).toBe(9);
    expect(h?.wins.items.map((w) => w.id)).toEqual(['w1', 'w5', 'w6']);
    expect(h?.wins.items.map(winLine)).toEqual([
      'Client1 hit a 7-day check-in streak', 'Rae set a best: Bench Press, 205 lb for 3', 'Lou reached goal weight, 180 lb',
    ]);
  });

  it('is absent without a readable wins count, and draws no rings it cannot read', () => {
    expect(parseHomeDay(undefined)).toBeNull();
    expect(parseHomeDay({ wins: { count: -1, items: [] } })).toBeNull();
    expect(parseHomeDay({ wins: { count: 2, items: [] }, rings: { check_ins: { reviewed: 1 } } })?.rings).toBeNull();
  });

  it('words the hero, moves the three-win window and captions the rings', () => {
    expect(winsHeadline(1)).toEqual({ value: '1', unit: 'win this week' });
    const ws = [win(1), win(2), win(3), win(4)];
    expect(winWindow(ws, 0).map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(winWindow(ws, 2).map((w) => w.id)).toEqual(['w3', 'w4', 'w1']);
    expect(winWindow(ws.slice(0, 2), 5)).toHaveLength(2);
    const closed = ringSpecs({ check_ins: { reviewed: 2, submitted: 2 }, replies: { answered: 0, received: 0 }, reach_outs: { contacted: 5, goal: 5 } });
    expect(ringsCaption(closed, 10)).toBe('Every ring is closed for today.');
    expect(ringsCaption(ringSpecs({ check_ins: { reviewed: 0, submitted: 0 }, replies: { answered: 0, received: 0 }, reach_outs: { contacted: 0, goal: 0 } }), 10))
      .toBe('Nothing to close yet today.');
  });

  it('splits the roster into Needs you and Steady by the list rule, archived left out', () => {
    const now = new Date();
    const rows = needsAndSteady([
      client('a', 'A', 'One', { lastActiveOn: day(0), checkInsToReview: 0 }),
      client('b', 'B', 'Two', { lastActiveOn: day(0), checkInsToReview: 0 }),
      { ...client('z', 'Z', 'Gone', null), status: 'archived' },
    ] as never, { b: 2 }, now);
    expect(rows.needs.map((r) => r.client.id)).toEqual(['b']);
    expect(rows.needs[0].reason.text).toBe('2 new messages');
    expect(rows.steady).toEqual({ count: 1, loggedToday: 1 });
  });
});

describe('coach Home flag wiring', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const nav = fs.readFileSync(path.join(ROOT, 'src', 'navigation', 'CoachNavigator.tsx'), 'utf8');

  it('adds no Money tab of its own, and names the first tab "Home" only with the new Home', () => {
    expect(nav.match(/name="MoneyStack"/g)).toHaveLength(1);
    expect(nav).toMatch(/const homeTabLabel = tabsV2 && featureFlags\.coachHomeV11 \? 'Home' : 'Overview';/);
  });

  it('is off by default in featureFlags.ts and in no EAS profile, so the default is the OTA switch', () => {
    const flags = fs.readFileSync(path.join(ROOT, 'src', 'config', 'featureFlags.ts'), 'utf8');
    expect(flags).toMatch(/coachHomeV11: readFlag\('EXPO_PUBLIC_FF_COACH_HOME_V11', false\)/);
    const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8')) as { build: Record<string, { env?: Record<string, string> }> };
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(`${name}:${profile.env?.EXPO_PUBLIC_FF_COACH_HOME_V11}`).toBe(`${name}:undefined`);
    }
  });
});
