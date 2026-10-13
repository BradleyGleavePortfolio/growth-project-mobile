/**
 * UI-2 coach Home (featureFlags.coachHomeV11): real numbers only, every tap arrives somewhere real, the Money
 * tab opens the Money page, and the flag is off in every build profile.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
  useIsFocused: () => mockFocused,
}));
let mockFocused = true;
jest.mock('react-native-safe-area-context', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const insets = { top: 47, bottom: 0, left: 0, right: 0 };
  return { useSafeAreaInsets: () => insets, SafeAreaInsetsContext: R.createContext(insets) };
});
jest.mock('react-native-svg', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const El = ({ children, testID }: { children?: React.ReactNode; testID?: string }) => R.createElement(View, { testID }, children);
  return { __esModule: true, default: El, Circle: El };
});
const mockHaptics = { softImpact: jest.fn(), mediumImpact: jest.fn(), selection: jest.fn() };
jest.mock('../ui/haptics/haptics.service', () => ({ HapticService: mockHaptics }));
const mockOverview = jest.fn();
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  commandCenterApi: { getOverview: () => mockOverview() },
}));
jest.mock('../services/notificationsApi', () => ({ fetchUnreadCount: () => Promise.resolve(2) }));
const mockDrafts = jest.fn();
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => mockDrafts() }));
const mockFlags = { coachHomeV11: true, romanChat: true, coachBrief: false };
jest.mock('../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockStub = (testID: string) => () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: () => R.createElement(Text, { testID }, testID) };
};
jest.mock('../screens/coach/command-center/CoachHomeCards', () => mockStub('setup-cards')());
jest.mock('../screens/coach/command-center/OverviewScreen', () => mockStub('today-overview')());
const mockSources = { monthSoFar: jest.fn(), nextPayout: jest.fn(), ltv: jest.fn(), atRisk: jest.fn() };
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({ get coachHomeSources() { return mockSources; } }));
jest.mock('../screens/coach/home-v11/rosterSources', () => ({
  rosterSources: {
    clients: () => Promise.resolve([]), winStreaks: () => Promise.resolve([]), unreadByClient: () => Promise.resolve({}), setup: () => mockSetup(),
  },
}));
const mockSetup = jest.fn();
// Stripe ready, nothing else yet: the zero-client mockup's state.
const snapshot = (over: Record<string, unknown> = {}) => ({
  connect: { state: 'active', actionRequired: false }, livePackageTitle: '', hasClient: false, paid: false, sharedLink: false, errors: [], ...over,
});
const PACKAGE_NEXT = 'Next is your first package. Once it is live, share your link and the rings start to fill.';

// Required after the mocks above exist (an import would be hoisted above them).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CommandCenterScreen = require('../screens/coach/command-center/CommandCenterScreen').default as React.ComponentType;

const overview = (roster: number) => ({
  roster_size: roster, active_today: roster ? 21 : 0, check_in_rate_7day: 0.82, open_alerts: 0,
  at_risk_count: roster ? 2 : 0, win_streak_count: 9, unread_messages: 1, pending_actions: 0,
});
const entry = (id: string, name: string, factor: string) => ({
  user_id: id, display_name: name, bucket: 'amber', risk_score: null, last_active_at: new Date().toISOString(), top_factor: factor, days_since_checkin: 8,
});
const summary = (netCents: number) => ({
  currency: 'usd', changeCents: null,
  totals: { netCents, chargeCount: netCents ? 3 : 0 },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.coachHomeV11 = true;
  mockFocused = true;
  mockSetup.mockResolvedValue(snapshot());
  mockOverview.mockResolvedValue({ data: overview(30) });
  mockSources.atRisk.mockResolvedValue([entry('c1', 'Casey Lin', 'No check-in for 8 days'), entry('c2', 'Ana Ruiz', 'Payment failed')]);
  mockSources.ltv.mockResolvedValue({ active_client_count: 30, churn_rate_pct: 3, mrr_30d_ago_cents: 100000 });
  mockSources.monthSoFar.mockResolvedValue(summary(214000));
  mockSources.nextPayout.mockResolvedValue({ amountCents: 48600, currency: 'usd', arrivalDate: null });
  mockDrafts.mockReturnValue({
    data: { drafts: [
      { id: 'd1', capability: 'draft.assign_workout' },
      { id: 'd2', capability: 'draft.assign_workout' },
      { id: 'd3', capability: 'draft.send_notification' },
      { id: 'd4', capability: 'draft.coach_message' },
    ] },
    refetch: jest.fn(),
  });
});

async function renderHome() {
  const view = await render(<CommandCenterScreen />);
  await waitFor(() => expect(view.getByTestId('coach-home-v11-dials')).toBeTruthy());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return view;
}

describe('UI-2 coach Home, flag on', () => {
  it('draws only real numbers in the three dials', async () => {
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-dial-today').props.accessibilityLabel).toBe('Today: 21 of 30');
    expect(v.getByTestId('coach-home-v11-dial-checkins').props.accessibilityLabel).toBe('Check-ins: 82% check-ins. Last 7 days');
    expect(v.getByTestId('coach-home-v11-dial-retention').props.accessibilityLabel).toBe('Retention: 97% stayed. This month');
  });

  it('leaves the retention dial out when there is no real base', async () => {
    mockSources.ltv.mockResolvedValue(null);
    const v = await renderHome();
    expect(v.queryByTestId('coach-home-v11-dial-retention')).toBeNull();
  });

  it("counts exactly the drafts the queue shows and opens it with a medium haptic", async () => {
    const v = await renderHome();
    const button = v.getByTestId('coach-home-v11-drafts');
    expect(button.props.accessibilityLabel).toBe("Approve Roman's drafts, 3");
    expect(v.getByText("Approve Roman's drafts\u00a0→")).toBeTruthy();
    await fireEvent.press(button);
    expect(mockHaptics.mediumImpact).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'PendingAiDrafts', initial: false });
  });

  it('hides the drafts action when nothing is waiting', async () => {
    mockDrafts.mockReturnValue({ data: { drafts: [{ id: 'd4', capability: 'draft.coach_message' }] }, refetch: jest.fn() });
    const v = await renderHome();
    expect(v.queryByTestId('coach-home-v11-drafts')).toBeNull();
    expect(v.getByTestId('coach-home-v11-ask-roman')).toBeTruthy();
  });

  it('opens Roman, the bell, a client, Clients and the Money tab', async () => {
    const v = await renderHome();
    await fireEvent.press(v.getByTestId('coach-home-v11-ask-roman'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'RomanChat', initial: false });
    expect(v.getByTestId('coach-home-v11-bell').props.accessibilityLabel).toBe('Notifications, 2 unread');
    await fireEvent.press(v.getByTestId('coach-home-v11-bell'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'NotificationCenter', initial: false });
    expect(v.getByTestId('coach-home-v11-chip-needs').props.accessibilityLabel).toBe('Needs you, 2');
    await fireEvent.press(v.getByTestId('coach-home-v11-client-c1'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'ClientDetail', params: { clientId: 'c1', clientName: 'Casey Lin' }, initial: false });
    await fireEvent.press(v.getByTestId('coach-home-v11-all-clients'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'ClientsList' });
    expect(v.getByText('Next payout')).toBeTruthy();
    await fireEvent.press(v.getByTestId('coach-home-v11-payout'));
    await fireEvent.press(v.getByTestId('coach-home-v11-month'));
    expect(mockNavigate).toHaveBeenCalledWith('MoneyStack', { screen: 'CoachMoney' });
    expect(mockHaptics.softImpact).toHaveBeenCalled();
  });

  it('shows the Setup, Clients and Earnings dials, Roman\'s next step, the open steps and the empty wall for a coach with no clients', async () => {
    mockOverview.mockResolvedValue({ data: overview(0) });
    mockSources.monthSoFar.mockResolvedValue(summary(0));
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-dial-setup').props.accessibilityLabel).toBe('Setup: 1 of 4 steps. Stripe is ready');
    expect(v.getByTestId('coach-home-v11-dial-clients').props.accessibilityLabel).toBe('Clients: 0 clients. None yet');
    expect(v.getByTestId('coach-home-v11-dial-earnings').props.accessibilityLabel).toMatch(/^Earnings: \$0(\.00)? this month\. \w+ so far$/);
    expect(v.getByTestId('coach-home-v11-roman-line').props.children).toBe(PACKAGE_NEXT);
    expect(v.getByTestId('coach-home-v11-chip-setup').props.accessibilityLabel).toBe('Setup, 3');
    // The one Setup chip has nothing to switch to: a heading in the mockup's pill, never a button.
    expect(v.getByTestId('coach-home-v11-chip-setup').props.accessibilityRole).toBe('header');
    expect(v.queryByTestId('coach-home-v11-step-get_paid')).toBeNull();
    expect(v.getByTestId('coach-home-v11-step-package').props.accessibilityLabel).toBe('Step 2. Create your first package. Free, or $19.99 and up. Create');
    expect(v.getByTestId('coach-home-v11-step-invite').props.accessibilityLabel).toBe('Step 3. Invite your first client. Share your link or QR code. Share link');
    expect(v.getByTestId('coach-home-v11-step-money').props.accessibilityLabel).toBe('Step 4. First client payment. This ticks when your first client payment arrives.');
    await fireEvent.press(v.getByTestId('coach-home-v11-step-package'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CoachPackagesList', initial: false });
    await fireEvent.press(v.getByTestId('coach-home-v11-step-invite'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CoachSetup', params: { section: 'invite' }, initial: false });
    await fireEvent.press(v.getByTestId('coach-home-v11-step-money'));
    expect(mockNavigate).toHaveBeenCalledWith('MoneyStack', { screen: 'CoachMoney' });
    expect(mockHaptics.softImpact).toHaveBeenCalledTimes(3);
    expect(v.getByTestId('coach-home-v11-empty-wall')).toBeTruthy();
    expect(v.getByText(/^Clients appear here as they join\./)).toBeTruthy();
    expect(v.queryByTestId('setup-cards')).toBeNull();
    expect(v.queryByTestId('coach-home-v11-all-clients')).toBeNull();
    expect(v.queryByTestId('coach-home-v11-business')).toBeNull();
  });

  it('puts Stripe first, and leaves out the Roman line, when Stripe is not connected', async () => {
    mockOverview.mockResolvedValue({ data: overview(0) });
    mockSetup.mockResolvedValue(snapshot({ connect: { state: 'not_started', actionRequired: true } }));
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-dial-setup').props.accessibilityLabel).toBe('Setup: 0 of 4 steps');
    expect(v.queryByTestId('coach-home-v11-roman-line')).toBeNull();
    expect(v.getByTestId('coach-home-v11-chip-setup').props.accessibilityLabel).toBe('Setup, 4');
    const stripe = v.getByTestId('coach-home-v11-step-get_paid');
    expect(stripe.props.accessibilityLabel).toBe('Step 1. Get paid. Connect Stripe so clients can pay you. Connect Stripe');
    await fireEvent.press(stripe);
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CoachSetup', params: { section: 'get_paid' }, initial: false });
  });

  it('says when a setup read failed, with Try again, and never ticks that step', async () => {
    mockOverview.mockResolvedValue({ data: overview(0) });
    mockSetup.mockResolvedValueOnce(snapshot({
      connect: null, errors: [{ title: 'Could not check Stripe', body: 'Try again in a moment.', requestId: null, code: null, retryable: true }],
    }));
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-setup-error')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-step-get_paid').props.accessibilityLabel).toBe('Step 1. Get paid. This could not be checked just now. Connect Stripe');
    expect(v.getByTestId('coach-home-v11-dial-setup').props.accessibilityLabel).toBe('Setup: 0 of 4 steps');
    await fireEvent.press(v.getByTestId('coach-home-v11-setup-error-retry'));
    await waitFor(() => expect(v.queryByTestId('coach-home-v11-setup-error')).toBeNull());
    expect(v.queryByTestId('coach-home-v11-step-get_paid')).toBeNull();
    expect(mockSetup).toHaveBeenCalledTimes(2);
  });

  it('leaves setup out for a coach whose head coach runs the practice', async () => {
    mockOverview.mockResolvedValue({ data: overview(0) });
    mockSetup.mockResolvedValue(snapshot({ connect: null, headCoachHandlesMoney: true }));
    const v = await renderHome();
    expect(v.queryByTestId('coach-home-v11-dial-setup')).toBeNull();
    expect(v.queryByTestId('coach-home-v11-chip-setup')).toBeNull();
    expect(v.queryByTestId('coach-home-v11-step-package')).toBeNull();
    expect(v.getByTestId('coach-home-v11-empty-wall')).toBeTruthy();
  });

  it('reads setup again when the Home comes back into focus, so a new package ticks', async () => {
    mockOverview.mockResolvedValue({ data: overview(0) });
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-step-package')).toBeTruthy();
    mockSetup.mockResolvedValue(snapshot({ livePackageTitle: 'Starter' }));
    mockFocused = false;
    await v.rerender(<CommandCenterScreen />);
    mockFocused = true;
    await v.rerender(<CommandCenterScreen />);
    await waitFor(() => expect(v.queryByTestId('coach-home-v11-step-package')).toBeNull());
    expect(v.getByTestId('coach-home-v11-dial-setup').props.accessibilityLabel).toBe('Setup: 2 of 4 steps. Stripe is ready');
    expect(v.queryByTestId('coach-home-v11-roman-line')).toBeNull();
  });

  it('says so with a Try again when the roster cannot load', async () => {
    mockOverview.mockRejectedValueOnce(new Error('down'));
    const v = await render(<CommandCenterScreen />);
    await waitFor(() => expect(v.getByTestId('coach-home-v11-error')).toBeTruthy());
    expect(v.getByText('Roster numbers could not load.')).toBeTruthy();
    await fireEvent.press(v.getByText('Try again'));
    await waitFor(() => expect(v.getByTestId('coach-home-v11-dials')).toBeTruthy());
  });

  it('tells a failed needs-you or drafts read from an empty one, with Try again, while the rest stays usable', async () => {
    mockSources.atRisk.mockRejectedValueOnce(new Error('down'));
    const refetch = jest.fn();
    mockDrafts.mockReturnValue({ data: undefined, isError: true, error: new Error('down'), isFetching: false, refetch });
    const v = await renderHome();
    expect(v.getByText('At-risk clients could not load.')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-drafts-error')).toBeTruthy();
    expect(v.queryByTestId('coach-home-v11-drafts')).toBeNull();
    expect(v.getByTestId('coach-home-v11-all-clients')).toBeTruthy();
    expect(v.getByTestId('coach-home-v11-payout')).toBeTruthy();
    await fireEvent.press(v.getByTestId('coach-home-v11-drafts-error-retry'));
    expect(refetch).toHaveBeenCalled();
    await fireEvent.press(v.getByTestId('coach-home-v11-urgent-error-retry'));
    await waitFor(() => expect(v.getByTestId('coach-home-v11-client-c1')).toBeTruthy());
    expect(v.queryByTestId('coach-home-v11-urgent-error')).toBeNull();
  });

  it('keeps the verified clients when a refresh fails', async () => {
    const v = await renderHome();
    mockSources.atRisk.mockRejectedValueOnce(new Error('down'));
    await act(async () => { v.getByTestId('coach-home-v11').props.refreshControl.props.onRefresh(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(v.getByTestId('coach-home-v11-client-c1')).toBeTruthy();
    expect(v.queryByTestId('coach-home-v11-urgent-error')).toBeNull();
  });

  it('shows the drafts as loading until they answer', async () => {
    mockDrafts.mockReturnValue({ data: undefined, isError: false, refetch: jest.fn() });
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-drafts-loading')).toBeTruthy();
    expect(v.queryByTestId('coach-home-v11-drafts')).toBeNull();
  });
});

describe('UI-2 flag off', () => {
  it("keeps today's Overview", async () => {
    mockFlags.coachHomeV11 = false;
    const v = await render(<CommandCenterScreen />);
    expect(v.getByTestId('today-overview')).toBeTruthy();
    expect(v.queryByTestId('coach-home-v11')).toBeNull();
  });
});

describe('UI-2 Money tab and flag wiring', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const nav = fs.readFileSync(path.join(ROOT, 'src', 'navigation', 'CoachNavigator.tsx'), 'utf8');

  it('registers the Money tab ($ icon) only behind the flag, opening the Money page', () => {
    const gate = nav.search(/\{featureFlags\.coachHomeV11 && \(\s*<Tab\.Screen\s+name="MoneyStack"/);
    expect(gate).toBeGreaterThan(-1);
    const tab = nav.slice(gate, gate + 500);
    expect(tab).toMatch(/component=\{MoneyStackNavigator\}/);
    expect(tab).toMatch(/tabBarLabel: 'Money'/);
    expect(tab).toMatch(/name="logo-usd"/);
    expect(nav).toMatch(/function MoneyStackNavigator\(\) \{\s*return <SettingsStackNavigator initialRouteName="CoachMoney" \/>;/);
    expect(nav).toMatch(/<SettingsStack\.Navigator\s+initialRouteName=\{initialRouteName\}/);
    expect(nav).toMatch(/<SettingsStack\.Screen name="CoachMoney" component=\{MoneyScreen\} \/>/);
    expect(nav.match(/name="MoneyStack"/g)).toHaveLength(1);
  });

  it('gives every tab a string label with the flag on, so all six labels share one size and keep it at large text', () => {
    const tabs = nav.split('<Tab.Screen').slice(1);
    expect(tabs.length).toBeGreaterThanOrEqual(6);
    for (const t of tabs) {
      const name = /name="(\w+)"/.exec(t)?.[1];
      expect(`${name}:${/tabBarLabel: (featureFlags\.\w+ \? )?'/.test(t)}`).toBe(`${name}:true`);
    }
    expect(nav).toMatch(/\.\.\.\(featureFlags\.coachHomeV11 \? \{ tabBarLabel: 'Messages' \} : \{\}\),/);
    expect(nav).toMatch(/tabBarAllowFontScaling: !featureFlags\.coachHomeV11,/);
  });

  it('opens the app on the new Home only with the flag on', () => {
    expect(nav).toMatch(/const initialTab = __USING_MOCK_DATA \|\| featureFlags\.coachHomeV11 \? 'CommandCenter' : 'ClientsStack';/);
  });

  it('is off by default and in every EAS profile', () => {
    const flags = fs.readFileSync(path.join(ROOT, 'src', 'config', 'featureFlags.ts'), 'utf8');
    expect(flags).toMatch(/coachHomeV11: readFlag\('EXPO_PUBLIC_FF_COACH_HOME_V11', false\)/);
    const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8')) as { build: Record<string, { env?: Record<string, string> }> };
    for (const [name, profile] of Object.entries(eas.build)) {
      expect([undefined, 'false']).toContain(profile.env?.EXPO_PUBLIC_FF_COACH_HOME_V11);
      if (profile.env) expect(`${name}:${profile.env.EXPO_PUBLIC_FF_COACH_HOME_V11}`).toBe(`${name}:false`);
    }
  });
});
