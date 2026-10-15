/**
 * COACHLAND (owner 10-15: "coaches land on overview/home page", #COACH-LANDING op 1).
 * Rule: a coach opens the app on Overview: cold start, sign-in, return after
 * the app was killed, and account switch; a notification or link tap still
 * opens its own target. coachTabsV2 off: today's landing, unchanged.
 *
 * Every place that could pick the coach's first screen (search in the PR body):
 * the tab navigator's initialRouteName (the one fix point, CoachNavigator), no
 * restored navigation state or saved last tab (NavigationContainer has no
 * initialState or persistence), no post-sign-in reset (RootNavigator mounts
 * <CoachNavigator /> afresh, PersistedQueryCacheGate unmounts it on an identity
 * change), push taps (pushTapRouter, after mount) and the linking config (no
 * coach route). One table below walks each path, flag on and off, through the
 * real CoachNavigator, pushTapRouter and RootNavigator linking config.
 */
import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockFlags = { mwbPrograms: true, coachTabsV2: true };
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../hooks/useCoachRoleType', () => ({ useCoachTeamStatus: () => ({ role: 'head_coach', hasSubCoaches: false }) }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens }),
}));
jest.mock('../../services/api', () => ({
  ...jest.requireActual('../../services/api'),
  __esModule: true,
  coachApi: { getUnreadCounts: async () => ({ data: { total: 0 } }) },
}));
jest.mock('../../services/notificationsApi', () => ({ fetchUnreadCount: async () => 0 }));
// Production value: real coaches today land on Clients with the flag off.
jest.mock('../../services/commandCenterApi', () => ({ __USING_MOCK_DATA: false }));
jest.mock('../../components/NotificationBadge', () => () => null);
jest.mock('../../components/purchases/withNonP2PPurchaseGate', () => ({
  withNonP2PPurchaseGate: (screen: unknown) => screen,
}));
jest.mock('../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// RootNavigator is loaded only for its real `linking` config (as linkingConfig.test.ts does).
for (const name of ['AuthNavigator', 'ClientNavigator', 'CoachWizardNavigator', 'OnboardingNavigator', 'ConsultationOnboardingNavigator']) {
  jest.doMock(`../${name}`, () => () => null);
}
jest.mock('../../components/OfflineBanner', () => () => null);
jest.mock('../../screens/client/Day1WinScreen', () => () => null);
jest.mock('../../services/support/crisp.service', () => ({ initCrisp: jest.fn(), syncCrispIdentity: jest.fn() }));
jest.mock('../../services/firstWinApi', () => ({ firstWinApi: {}, WinType: {} }));
jest.mock('../../services/authActions', () => ({ signOut: jest.fn() }));
jest.mock('../../hooks/useLeanOnboardingReconcile', () => ({ useLeanOnboardingReconcile: () => {} }));
jest.mock('../../services/foodLogQueue', () => ({ flush: jest.fn() }));
jest.mock('../../screenshots', () => ({ isScreenshotMode: () => false }));

const navSource = fs.readFileSync(path.join(__dirname, '..', 'CoachNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: () => <Text>{modulePath}</Text> }));
}
jest.doMock('../../screens/coach/ed/FirstPaymentWowHost', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
for (const name of ['ProgramsStackNavigator', 'CoachCommunityNavigator']) {
  jest.doMock(`../${name}`, () => ({ __esModule: true, default: () => <Text>{name}</Text> }));
}
const CoachNavigator = require('../CoachNavigator').default;
const { linking } = require('../RootNavigator');
const push = require('../../services/pushTapRouter');

const ref = createNavigationContainerRef<ParamListBase>();
const SignedOut = createNativeStackNavigator();
const LoginScreen = () => <Text>Login</Text>;
let signIn: (on: boolean) => void = () => {};
// RootNavigator's shape: one container; the signed-out navigator or CoachNavigator inside it.
function App({ start }: { start: boolean }) {
  const [signedIn, setSignedIn] = React.useState(start);
  signIn = setSignedIn;
  return signedIn ? <CoachNavigator /> : (
    <SignedOut.Navigator><SignedOut.Screen name="Login" component={LoginScreen} /></SignedOut.Navigator>
  );
}
// A new `launch` key is a fresh process: the old container and its state are gone.
const tree = (start = true, url?: string, launch = 0) => (
  <NavigationContainer
    key={launch}
    ref={ref}
    linking={url ? { ...linking, getInitialURL: async () => url, subscribe: () => () => {} } : undefined}
  >
    <App start={start} />
  </NavigationContainer>
);
const mount = (start = true, url?: string) => render(tree(start, url));
const step = (fn: () => void) => act(async () => fn());
const landed = () => {
  const root = ref.getRootState();
  return [root.routes[root.index].name, ref.getCurrentRoute()?.name];
};

beforeEach(() => push.__resetPushTapRouterForTests());

const OVERVIEW = ['CommandCenter', 'CommandCenter'];
const CLIENTS = ['ClientsStack', 'ClientsList'];
// [path, how the coach gets there, landing with coachTabsV2 on, landing off]
const ROWS: [string, () => Promise<unknown>, string[], string[]][] = [
  ['cold start (signed in)', async () => mount(), OVERVIEW, CLIENTS],
  ['sign-in', async () => { await mount(false); await step(() => signIn(true)); }, OVERVIEW, CLIENTS],
  ['return after the app was killed (it was on Messages)', async () => {
    const view = await mount();
    await step(() => ref.navigate('Messages'));
    await view.rerender(tree(true, undefined, 1));
  }, OVERVIEW, CLIENTS],
  ['account switch (sign out on Messages, the next coach signs in)', async () => {
    await mount();
    await step(() => ref.navigate('Messages'));
    await step(() => signIn(false));
    await step(() => signIn(true));
  }, OVERVIEW, CLIENTS],
  ['safety alert push tapped at cold start: opens its alert', async () => {
    push.setPushSession({ kind: 'unknown' });
    push.routePushTap('CoachSafetyAlert', { alertId: 'alert-1' }, 'n-1');
    await mount();
    push.attachPushNavigator(ref);
    await step(() => push.setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' }));
  }, ['ClientsStack', 'CoachSafetyAlert'], ['ClientsStack', 'CoachSafetyAlert']],
  ['booking push tapped while open: opens the booking inbox', async () => {
    await mount();
    push.attachPushNavigator(ref);
    push.setPushSession({ kind: 'app', userId: 'coach-1', role: 'coach' });
    await step(() => push.routePushTap('CoachBookingInbox', undefined, 'n-2'));
  }, ['CalendarStack', 'CoachBookingInbox'], ['ClientsStack', 'CoachBookingInbox']],
  // The linking config names no coach route, so a link (here the coach's own
  // invite link) never picks a coach screen; the tab router falls back to its
  // first tab, Overview, with the flag on or off (unchanged by this PR).
  ['link tapped at cold start (tgp://join/<code>)', async () => {
    await mount(true, 'tgp://join/ABC123');
    await step(() => {}); // the container waits for getInitialURL
  }, OVERVIEW, OVERVIEW],
];

it.each(ROWS.flatMap(([name, run, on, off]) => [
  [name, 'on', run, on] as const,
  [name, 'off', run, off] as const,
]))('%s, coachTabsV2 %s', async (_name, flag, run, expected) => {
  mockFlags.coachTabsV2 = flag === 'on';
  await run();
  expect(landed()).toEqual(expected);
});
