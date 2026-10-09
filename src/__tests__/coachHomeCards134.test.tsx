// COACH-HOME-134 follow-up (agent 134): the Home cards below "Your clients today" (setup checklist, brief, Money) in the
// coach-home-solo language: rounded hairline cards (radius.card), serif titles, the Money need said in forest words (no red
// pill). Rendered in the real Command Center at 360x800 and 390x844.
import React from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import { render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors, layout, radius } from '../theme/tokens';
import CommandCenterScreen from '../screens/coach/command-center/CommandCenterScreen';

jest.mock('@react-navigation/native', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: (cb: () => void) => R.useEffect(() => cb(), [cb]),
  };
});
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  __USING_MOCK_DATA: false,
  commandCenterApi: {
    getOverview: async () => ({ data: { roster_size: 12, active_today: 8, check_in_rate_7day: 0.6, open_alerts: 0, at_risk_count: 0, win_streak_count: 0, unread_messages: 0, pending_actions: 0 } }),
    getLtvMetrics: () => new Promise(() => {}),
  },
}));
jest.mock('../components/command-center/CoachLtvDashboard', () => () => null);
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({
  coachHomeSources: { monthSoFar: () => new Promise(() => {}), nextPayout: async () => null, ltv: async () => null, atRisk: async () => [] },
}));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', firstName: 'Sarah' }) }));
jest.mock('../hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }) }));
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, coachBrief: true } };
});
jest.mock('../lib/coachSetup/setupStatus', () => ({
  ...jest.requireActual('../lib/coachSetup/setupStatus'),
  loadSetupStatus: async () => ({ connect: { state: 'active', actionRequired: false }, livePackageTitle: '', hasClient: true, paid: false, sharedLink: true, errors: [] }),
}));
jest.mock('../api/coachSetupApi', () => ({
  ...jest.requireActual('../api/coachSetupApi'),
  coachSetupApi: { connectStatus: async () => ({ state: 'active', actionRequired: false }) },
}));
jest.mock('../api/coachMoneyApi', () => {
  const actual = jest.requireActual('../api/coachMoneyApi');
  const summary = { currency: 'usd', currencies: ['usd'], totals: { netCents: 948000, chargeCount: 12 }, changeCents: null, changePct: null, attentionCount: 2 };
  return { ...actual, coachMoneyApi: { ...actual.coachMoneyApi, summary: async () => summary } };
});

const flat = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as TextStyle) ?? {};

it.each([
  ['Android 360x800', { x: 0, y: 0, width: 360, height: 800 }, { top: 24, bottom: 16, left: 0, right: 0 }],
  ['iPhone 390x844', { x: 0, y: 0, width: 390, height: 844 }, { top: 47, bottom: 34, left: 0, right: 0 }],
])('on %s the Home cards are rounded hairline cards with serif titles and no red pill', async (_n, frame, insets) => {
  const screen = await render(<SafeAreaProvider initialMetrics={{ frame, insets }}><CommandCenterScreen /></SafeAreaProvider>);
  expect(flat(screen.getByTestId('command-center-root')).paddingTop).toBe(insets.top + layout.statusBarGap);
  // SHOTS-134B f: the five tab labels (17.218 em of Inter Regular, measured from the TTF) fit gutter to gutter, even at 1.2x text.
  expect(17.218 * 14 * 1.2 + 2 * layout.gutter).toBeLessThanOrEqual(frame.width);
  const actions = screen.getByText('Actions');
  expect(actions.props).toMatchObject({ numberOfLines: 1, maxFontSizeMultiplier: 1.2 });
  expect(flat(screen.getByTestId('command-center-tab-action-queue'))).toMatchObject({ minWidth: 44 });
  expect(flat(screen.getByTestId('command-center-tab-overview')).paddingHorizontal).toBeUndefined();
  // Lining figures: a serif "1" never reads as "I" in the count rows.
  expect(flat(within(await screen.findByTestId('command-center-kpi-at-risk')).getByText('0')).fontVariant).toEqual(['lining-nums', 'tabular-nums']);
  const cards = [await screen.findByTestId('coach-setup-checklist'), screen.getByTestId('coach-home-brief-card'), await screen.findByTestId('money-home-card')];
  for (const card of cards) {
    expect(flat(card)).toMatchObject({ borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth });
  }
  for (const title of ['Finish setting up', "Today's brief", 'Money']) {
    expect(flat(screen.getByText(title)).fontFamily).toMatch(/^CormorantGaramond/);
  }
  expect(flat(await screen.findByTestId('money-home-card-net')).fontFamily).toMatch(/^CormorantGaramond/);
  const attention = await screen.findByTestId('money-home-card-attention');
  expect(flat(attention).backgroundColor).toBeUndefined();
  const words = within(attention).getByText('2 need attention');
  expect(flat(words).color).not.toBe(colors.error);
  expect(flat(words).color).toBe(colors.forest);
});
