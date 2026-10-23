/**
 * The coach Home's win line on the real screen (m#863): a cold open or a retry after an error lands the win at once,
 * with no empty line under the wins headline (LO r2 B1, 6352710559); at 130 % text the empty line fades out over the
 * same 0.3 s when the first win comes (#168-3 op 1, 6353564001), and with Reduce Motion on it goes at once.
 */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import type { HomeWin } from '../screens/coach/home-v11/homeDay';

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
type Node = ReturnType<View['getByText']>;

const EMPTY = 'Wins show here as your clients hit them.';
/** Animated.timing held by hand, so a fade is caught at its first frame. */
let fades: { duration?: number; end: (finished: boolean) => void }[] = [];
const opacity = (n: Node) => {
  for (let x: Node | null = n.parent; x; x = x.parent) {
    const o = StyleSheet.flatten(x.props.style)?.opacity as unknown;
    if (o !== undefined) return typeof o === 'number' ? o : (o as { __getValue: () => number }).__getValue();
  }
  return undefined;
};
const all = { includeHiddenElements: true };
const headline = (v: View) => v.getByTestId('home-wins-all').props.accessibilityLabel as string;
/** The wins re-read on a return to the Home (useCoachHomeV11 reads on each focus). */
const reread = async (v: View) => {
  mockFocus.current = false; await act(async () => { await v.rerender(<CommandCenterScreen />); });
  mockFocus.current = true; await act(async () => { await v.rerender(<CommandCenterScreen />); await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
  fades = [];
  jest.spyOn(Animated, 'timing').mockImplementation((val, config) => {
    const f = { duration: config.duration, end: (_: boolean) => undefined as void };
    fades.push(f);
    const start = (cb?: Animated.EndCallback) => { f.end = (fin) => { if (fin) (val as Animated.Value).setValue(config.toValue as number); cb?.({ finished: fin }); }; };
    return { start, stop: jest.fn(), reset: jest.fn() } as unknown as Animated.CompositeAnimation;
  });
});
afterEach(() => jest.restoreAllMocks());

describe('the Home win line lands at once after Loading or an error (LO r2 B1)', () => {
  it('a cold open with wins draws the first win at full and no empty line under the headline', async () => {
    const v = await renderHome();
    expect(v.getByText('12')).toBeTruthy();
    expect(v.queryAllByText(EMPTY, all)).toHaveLength(0);
    expect(opacity(v.getByTestId('home-win-w1', all))).toBe(1);
    expect(fades.filter((f) => f.duration === 300)).toHaveLength(0);
  });

  it('Try again after a failed read lands the win the same way', async () => {
    mockGet.mockRejectedValue(new Error('down'));
    const v = await render(<CommandCenterScreen />);
    await waitFor(() => expect(v.getByTestId('home-retry')).toBeTruthy());
    mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1), win(2)], 2) } });
    await fireEvent.press(v.getByTestId('home-retry'));
    await waitFor(() => expect(v.getByTestId('home-hero-wins')).toBeTruthy());
    expect(v.queryAllByText(EMPTY, all)).toHaveLength(0);
    expect(opacity(v.getByTestId('home-win-w1', all))).toBe(1);
  });
});

describe('#168-3 op 1: at 130 % text the empty line fades out when the first win comes', () => {
  beforeEach(() => {
    mockWindow.fontScale = 1.3;
    mockGet.mockResolvedValue({ data: { ...overview(30), home: home([], 0) } });
  });

  it('fades the empty line out over 0.3 s, draws no win line, then leaves none', async () => {
    const v = await renderHome();
    expect(v.getByText(EMPTY)).toBeTruthy(); // drawn as m#688 drew it, at rest
    mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1)], 1) } });
    await reread(v);
    expect(headline(v)).toMatch(/^1 win/);
    expect(opacity(v.getByText(EMPTY, all))).toBe(1); // its first frame: still at full, now fading
    expect(v.queryByTestId('home-win-w1', all)).toBeNull();
    const fade = fades.filter((f) => f.duration === 300);
    expect(fade).toHaveLength(1);
    await act(async () => { fade[0].end(true); });
    expect(v.queryAllByText(EMPTY, all)).toHaveLength(0);
    expect(v.queryByTestId('home-win-w1', all)).toBeNull();
  });

  it('with Reduce Motion on, the empty line goes at once', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const v = await renderHome();
    expect(v.getByText(EMPTY)).toBeTruthy();
    mockGet.mockResolvedValue({ data: { ...overview(30), home: home([win(1)], 1) } });
    await reread(v);
    expect(headline(v)).toMatch(/^1 win/);
    expect(v.queryAllByText(EMPTY, all)).toHaveLength(0);
    expect(fades.filter((f) => f.duration === 300)).toHaveLength(0);
  });
});
