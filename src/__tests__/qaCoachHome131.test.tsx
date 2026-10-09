/**
 * QA-COACH-HOME-131 (AUD-FIN-DESIGN-129 U1-U4, C7): coach Home.
 *
 * U1: the setup checklist and the Money card (the Home header) stay on screen while the roster numbers load and when they
 *     fail, mounted once (C7: no flash in, out, in); the numbers area shows a skeleton or a calm error with Try again.
 * U2: numbers are monochrome; "needs attention" is said in words, never red or gold.
 * U3: the top tabs are 44 pt tall with readable 14 pt labels in sentence case ("At risk").
 * U4: a failed Team load says so without red and without the false "No sub-coaches yet".
 * Parity: every tab, KPI tile, Try again and Invite stays reachable.
 */
import React from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }),
  // COACH-INSETS-B-134: Team now sits in the shared Screen, which reads this context.
  SafeAreaInsetsContext: jest.requireActual('react-native-safe-area-context').SafeAreaInsetsContext,
}));
const mockMe = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  authApi: { me: (...a: unknown[]) => mockMe(...a) },
}));
const mockApi: Record<string, jest.Mock> = {
  getOverview: jest.fn(),
  getAtRisk: jest.fn(),
  getWinStreaks: jest.fn(),
  getInbox: jest.fn(),
  getActionQueue: jest.fn(),
};
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  __USING_MOCK_DATA: false,
  commandCenterApi: {
    getOverview: (...a: unknown[]) => mockApi.getOverview(...a),
    getAtRisk: (...a: unknown[]) => mockApi.getAtRisk(...a),
    getWinStreaks: (...a: unknown[]) => mockApi.getWinStreaks(...a),
    getInbox: (...a: unknown[]) => mockApi.getInbox(...a),
    getActionQueue: (...a: unknown[]) => mockApi.getActionQueue(...a),
    dismissAlert: jest.fn(),
    getLtvMetrics: () => new Promise(() => {}),
  },
}));
jest.mock('../components/command-center/CoachLtvDashboard', () => () => null);
jest.mock('../components/roman/adjust/RomanAdjustmentsSection', () => () => null);
let mockHeaderMounts = 0;
jest.mock('../screens/coach/command-center/CoachHomeCards', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return function MockCoachHomeCards() {
    R.useEffect(() => {
      mockHeaderMounts += 1;
    }, []);
    return R.createElement(Text, { testID: 'coach-home-cards' }, 'Set up Stripe');
  };
});
const mockListSubCoaches = jest.fn();
jest.mock('../api/subCoachApi', () => ({
  subCoachApi: { listSubCoaches: (...a: unknown[]) => mockListSubCoaches(...a) },
}));
jest.mock('../api/coachTeamApi', () => ({
  coachTeamApi: { getProfile: jest.fn().mockResolvedValue({ ok: false }) },
}));
jest.mock('../screens/coach/SubCoachInviteModal', () => () => null);

import { colors, lightTokens } from '../theme/tokens';
import CoachHomeCards from '../screens/coach/command-center/CoachHomeCards';
import CommandCenterScreen from '../screens/coach/command-center/CommandCenterScreen';
import OverviewScreen from '../screens/coach/command-center/OverviewScreen';
import AtRiskScreen from '../screens/coach/command-center/AtRiskScreen';
import WinStreaksScreen from '../screens/coach/command-center/WinStreaksScreen';
import InboxScreen from '../screens/coach/command-center/InboxScreen';
import ActionQueueScreen from '../screens/coach/command-center/ActionQueueScreen';
import TeamManagementScreen from '../screens/coach/TeamManagementScreen';

const api = mockApi;
const flat = (node: { props: { style?: unknown } }): TextStyle =>
  StyleSheet.flatten(node.props.style as TextStyle) ?? {};
function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const overview = (over: Record<string, number> = {}) => ({
  data: {
    roster_size: 12,
    active_today: 8,
    check_in_rate_7day: 0.6,
    open_alerts: 2,
    at_risk_count: 3,
    win_streak_count: 5,
    unread_messages: 1,
    pending_actions: 0,
    ...over,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockHeaderMounts = 0;
});

describe('U1 + C7: the Home header stays while the roster numbers load or fail', () => {
  it('shows the setup checklist and Money card above a skeleton while the numbers load', async () => {
    api.getOverview.mockReturnValue(new Promise(() => {}));
    const screen = await render(<OverviewScreen header={<CoachHomeCards />} />);
    expect(screen.getByTestId('coach-home-cards')).toBeTruthy();
    expect(screen.getByTestId('command-center-overview-loading')).toBeTruthy();
    expect(screen.queryByTestId('command-center-kpi-roster-size')).toBeNull();
  });

  it('keeps the header on a failed read, says what did not load, and Try again loads the numbers', async () => {
    api.getOverview.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(overview());
    const screen = await render(<OverviewScreen header={<CoachHomeCards />} />);
    expect(await screen.findByText('Roster numbers could not load.')).toBeTruthy();
    expect(screen.getByTestId('coach-home-cards')).toBeTruthy();
    expect(screen.queryByText(/unable to load|check your connection/i)).toBeNull();
    const retry = screen.getByTestId('command-center-overview-error-retry');
    expect(flat(retry).minHeight).toBeGreaterThanOrEqual(44);
    const label = within(retry).getByText('Try again');
    expect(flat(label).fontSize).toBeGreaterThanOrEqual(13);
    expect(flat(label).color).toBe(lightTokens.accentText);
    await fireEvent.press(retry);
    expect(await screen.findByTestId('command-center-kpi-roster-size')).toBeTruthy();
    expect(api.getOverview).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('coach-home-cards')).toBeTruthy();
  });

  it('mounts the header once from the first frame to loaded numbers (no flash)', async () => {
    api.getOverview.mockResolvedValue(overview());
    const screen = await render(<OverviewScreen header={<CoachHomeCards />} />);
    expect(await screen.findByTestId('command-center-kpi-roster-size')).toBeTruthy();
    expect(mockHeaderMounts).toBe(1);
  });
});

describe('U2: monochrome numbers, the need said in words', () => {
  it('never colours a number red or gold; at-risk and open alerts say it in words', async () => {
    api.getOverview.mockResolvedValue(overview());
    const screen = await render(<OverviewScreen />);
    await screen.findByText('60%');
    for (const node of screen.getAllByText(/./)) {
      expect([colors.mutedGold, colors.error]).not.toContain(flat(node).color);
    }
    for (const value of ['60%', '3', '2', '12', '1']) {
      expect(flat(screen.getByText(value)).color).toBe(colors.ink);
    }
    expect(screen.getByText('8 active today')).toBeTruthy();
    expect(within(screen.getByTestId('command-center-kpi-at-risk')).getByText('Need attention')).toBeTruthy();
    expect(within(screen.getByTestId('command-center-kpi-open-alerts')).getByText('Waiting in Actions')).toBeTruthy();
  });

  it('one client at risk reads "Needs attention"; none adds no words', async () => {
    api.getOverview.mockResolvedValue(overview({ at_risk_count: 1, open_alerts: 0 }));
    const screen = await render(<OverviewScreen />);
    const atRisk = await screen.findByTestId('command-center-kpi-at-risk');
    expect(within(atRisk).getByText('Needs attention')).toBeTruthy();
    expect(screen.queryByText('Waiting in Actions')).toBeNull();
  });
});

describe('U3 + parity: readable 44 pt top tabs that all still open their screen', () => {
  const TABS = [
    ['overview', 'Overview', 'command-center-overview'],
    ['at-risk', 'At risk', 'command-center-at-risk'],
    ['win-streaks', 'Streaks', 'command-center-win-streaks'],
    ['inbox', 'Inbox', 'command-center-inbox'],
    ['action-queue', 'Actions', 'command-center-action-queue'],
  ] as const;

  it('labels are sentence case, at least 13 pt, AA on bone, and every tab is 44 pt tall', async () => {
    api.getOverview.mockReturnValue(new Promise(() => {}));
    const screen = await render(<CommandCenterScreen />);
    expect(screen.queryByText('At-Risk')).toBeNull();
    for (const [key, label] of TABS) {
      const tab = screen.getByTestId(`command-center-tab-${key}`);
      expect(flat(tab).minHeight).toBeGreaterThanOrEqual(44);
      const text = within(tab).getByText(label);
      expect(flat(text).fontSize).toBeGreaterThanOrEqual(13);
      const color = String(flat(text).color);
      expect(color).toBe(key === 'overview' ? lightTokens.accentText : lightTokens.textMuted);
      expect(contrast(color, colors.bone)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('each top tab and each KPI tile opens its screen', async () => {
    for (const fn of ['getAtRisk', 'getWinStreaks', 'getInbox', 'getActionQueue']) {
      api[fn].mockReturnValue(new Promise(() => {}));
    }
    api.getOverview.mockResolvedValue(overview());
    const screen = await render(<CommandCenterScreen />);
    for (const [key, , screenId] of TABS) {
      await fireEvent.press(screen.getByTestId(`command-center-tab-${key}`));
      expect(screen.getByTestId(screenId)).toBeTruthy();
    }
    const tiles = [
      ['command-center-kpi-at-risk', 'command-center-at-risk'],
      ['command-center-kpi-win-streaks', 'command-center-win-streaks'],
      ['command-center-kpi-unread-messages', 'command-center-inbox'],
      ['command-center-kpi-open-alerts', 'command-center-action-queue'],
    ];
    for (const [tile, screenId] of tiles) {
      await fireEvent.press(screen.getByTestId('command-center-tab-overview'));
      await fireEvent.press(await screen.findByTestId(tile));
      expect(screen.getByTestId(screenId)).toBeTruthy();
    }
  });
});

describe('the four list tabs: one skeleton, one calm error with Try again', () => {
  const LISTS = [
    ['at-risk', AtRiskScreen, 'getAtRisk', 'At-risk clients could not load.', { items: [], total_at_risk: 0 }],
    ['win-streaks', WinStreaksScreen, 'getWinStreaks', 'Win streaks could not load.', { items: [], total_active_streaks: 0 }],
    ['inbox', InboxScreen, 'getInbox', 'The inbox could not load.', { threads: [], total_unread: 0 }],
    ['action-queue', ActionQueueScreen, 'getActionQueue', 'The action queue could not load.', { items: [], total_pending: 0 }],
  ] as const;

  it.each(LISTS)('%s shows the skeleton while loading', async (key, Screen, fn) => {
    api[fn].mockReturnValue(new Promise(() => {}));
    const screen = await render(<Screen />);
    expect(screen.getByTestId(`command-center-${key}-loading`)).toBeTruthy();
  });

  it.each(LISTS)('%s names what failed and Try again reloads it', async (key, Screen, fn, copy, empty) => {
    api[fn].mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: empty });
    const screen = await render(<Screen />);
    expect(await screen.findByText(copy)).toBeTruthy();
    const retry = screen.getByTestId(`command-center-${key}-error-retry`);
    expect(flat(retry).minHeight).toBeGreaterThanOrEqual(44);
    expect(flat(within(retry).getByText('Try again')).color).toBe(lightTokens.accentText);
    await fireEvent.press(retry);
    await waitFor(() => expect(screen.queryByText(copy)).toBeNull());
    expect(api[fn]).toHaveBeenCalledTimes(2);
  });
});

describe('U4: Team says a failed load in words, without red or a false empty line', () => {
  it('hides "No sub-coaches yet" when the load failed and keeps Invite and Try again', async () => {
    mockMe.mockResolvedValue({ data: { plan_tier: 'scale' } });
    mockListSubCoaches.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({ data: [] });
    const screen = await render(<TeamManagementScreen />);
    const message = await screen.findByText('Your team could not load.');
    expect(flat(message).color).not.toBe(colors.error);
    expect(screen.queryByText(/No sub-coaches yet/)).toBeNull();
    expect(screen.queryByText(/Tap to retry/)).toBeNull();
    expect(screen.getByLabelText('Invite sub-coach')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('team-load-error-retry'));
    expect(await screen.findByText('No sub-coaches yet. Tap Invite to add your first one.')).toBeTruthy();
    expect(screen.queryByText('Your team could not load.')).toBeNull();
    expect(mockListSubCoaches).toHaveBeenCalledTimes(2);
  });
});
