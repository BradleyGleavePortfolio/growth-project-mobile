/**
 * UI-2 coach Home (featureFlags.coachHomeV11): real numbers only, every tap arrives somewhere real, Money opens
 * the six-tab Money tab (coachTabsV2) or Settings' Money page, the Home lands first and carries the coach's push
 * ask, and the flag is off by default with no eas.json line (the OTA switch).
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: mockNavigate }),
    useIsFocused: () => mockFocused,
    // Runs each time the screen comes into focus, as the real hook does.
    useFocusEffect: (cb: () => void) => {
      const focused = mockFocused;
      R.useEffect(() => { if (focused) cb(); }, [cb, focused]);
    },
  };
});
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
const mockFlags = { coachHomeV11: true, romanChat: true, coachBrief: false, coachTabsV2: false };
jest.mock('../config/featureFlags', () => ({ featureFlags: mockFlags }));
const mockStub = (testID: string) => () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: () => R.createElement(Text, { testID }, testID) };
};
jest.mock('../screens/coach/command-center/CoachHomeCards', () => mockStub('setup-cards')());
jest.mock('../screens/coach/command-center/OverviewScreen', () => mockStub('today-overview')());
jest.mock('../components/home/PushPermissionCard', () => mockStub('push-ask')());
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
  mockFlags.coachTabsV2 = false;
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

/** Every testID in the rendered tree, top to bottom (props can be circular, so no JSON.stringify). */
const testIdsInOrder = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(testIdsInOrder);
  if (!node || typeof node !== 'object') return [];
  const n = node as { props?: { testID?: unknown }; children?: unknown };
  const id = n.props?.testID;
  return [...(typeof id === 'string' ? [id] : []), ...testIdsInOrder(n.children)];
};

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
    // No Roman line: the link keeps its own side padding.
    expect(StyleSheet.flatten(v.getByTestId('coach-home-v11-ask-roman').props.style).marginStart).toBeUndefined();
  });

  it('opens Roman, the bell, a client, Clients and Money', async () => {
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
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'ClientsList', pop: true });
    expect(v.getByText('Next payout')).toBeTruthy();
    await fireEvent.press(v.getByTestId('coach-home-v11-payout'));
    await fireEvent.press(v.getByTestId('coach-home-v11-month'));
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CoachMoney', params: { from: 'home' }, initial: false });
    expect(mockHaptics.softImpact).toHaveBeenCalled();
  });

  it('opens the six-tab Money tab from Business when coachTabsV2 is on too', async () => {
    mockFlags.coachTabsV2 = true;
    const v = await renderHome();
    await fireEvent.press(v.getByTestId('coach-home-v11-month'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoneyStack', { screen: 'CoachMoney', pop: true });
    await fireEvent.press(v.getByTestId('coach-home-v11-payout'));
    expect(mockNavigate).toHaveBeenLastCalledWith('MoneyStack', { screen: 'CoachMoney', pop: true });
    expect(v.getByTestId('command-center-settings')).toBeTruthy();
  });

  it("carries the coach's push ask once, between the client tiles and Business (C-S-PUSH-3)", async () => {
    const v = await renderHome();
    expect(v.getAllByTestId('push-ask')).toHaveLength(1);
    const order = testIdsInOrder(v.toJSON());
    const at = (id: string) => order.indexOf(id);
    expect(at('coach-home-v11-all-clients')).toBeGreaterThanOrEqual(0);
    expect(at('coach-home-v11-all-clients')).toBeLessThan(at('push-ask'));
    expect(at('push-ask')).toBeLessThan(at('coach-home-v11-business'));
  });

  it('shows the Setup, Clients and Earnings dials, Roman\'s next step, the open steps and the empty wall for a coach with no clients', async () => {
    mockOverview.mockResolvedValue({ data: overview(0) });
    mockSources.monthSoFar.mockResolvedValue(summary(0));
    const v = await renderHome();
    expect(v.getByTestId('coach-home-v11-dial-setup').props.accessibilityLabel).toBe('Setup: 1 of 4 steps. Stripe is ready');
    expect(v.getByTestId('coach-home-v11-dial-clients').props.accessibilityLabel).toBe('Clients: 0 clients. None yet');
    expect(v.getByTestId('coach-home-v11-dial-earnings').props.accessibilityLabel).toMatch(/^Earnings: \$0(\.00)? this month\. \w+ so far$/);
    expect(v.getByTestId('coach-home-v11-roman-line').props.children).toBe(PACKAGE_NEXT);
    // Under Roman's line, "Ask Roman" starts on the line's edge, as in the mockup (LOC C2).
    expect(StyleSheet.flatten(v.getByTestId('coach-home-v11-ask-roman').props.style).marginStart).toBe(-4);
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
    expect(mockNavigate).toHaveBeenCalledWith('SettingsStack', { screen: 'CoachMoney', params: { from: 'home' }, initial: false });
    expect(mockHaptics.softImpact).toHaveBeenCalledTimes(3);
    expect(v.getByTestId('coach-home-v11-empty-wall')).toBeTruthy();
    expect(v.getByText(/^Clients appear here as they join\./)).toBeTruthy();
    expect(v.queryByTestId('setup-cards')).toBeNull();
    // C-S-PUSH-3: the old cards are gone, so the Home itself carries the push ask, once, after the setup steps.
    expect(v.getAllByTestId('push-ask')).toHaveLength(1);
    const order = testIdsInOrder(v.toJSON());
    expect(order.indexOf('coach-home-v11-empty-wall')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('coach-home-v11-empty-wall')).toBeLessThan(order.indexOf('push-ask'));
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

describe('UI-2 landing, Money tab and flag wiring', () => {
  const ROOT = path.resolve(__dirname, '..', '..');
  const nav = fs.readFileSync(path.join(ROOT, 'src', 'navigation', 'CoachNavigator.tsx'), 'utf8');

  it('adds no Money tab of its own: the one Money tab is the six-tab one (coachTabsV2)', () => {
    expect(nav.match(/name="MoneyStack"/g)).toHaveLength(1);
    expect(nav).toMatch(/\{tabsV2 && \(\s*<Tab\.Screen\s+name="MoneyStack"\s+component=\{MoneyStackNavigator\}/);
    expect(nav).not.toMatch(/coachHomeV11/);
  });

  it('opens the app on the new Home with the flag on (coachLanding.ts)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { coachLandingTab } = require('../navigation/coachLanding') as typeof import('../navigation/coachLanding');
    expect(nav).toMatch(/const initialTab = coachLandingTab\(\);/);
    expect(coachLandingTab()).toBe('CommandCenter');
    mockFlags.coachHomeV11 = false;
    expect(coachLandingTab()).toBe('ClientsStack');
    mockFlags.coachTabsV2 = true;
    expect(coachLandingTab()).toBe('CommandCenter');
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
