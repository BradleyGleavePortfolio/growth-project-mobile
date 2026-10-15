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
 *
 * C-S-PUSH-3 (FIX728 B1): the screen a coach lands on carries the deferred push
 * ask, asked once. coachLandingTab() is the one point: it picks the landing and
 * places the ask on it (Overview's CoachHomeCards or ClientsListScreen, both real
 * below). The second table walks it, flag on and off.
 */
import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
const mockFlags = { mwbPrograms: true, coachTabsV2: true };
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../hooks/useCoachRoleType', () => ({ useCoachTeamStatus: () => ({ role: 'head_coach', hasSubCoaches: false }) }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => '#000000' }) }),
}));
// The real ClientsListScreen and the real Overview cards (CoachHomeCards) render; their data stays out.
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../store/coachStore', () => ({
  useCoachStore: () => ({
    clients: [], isLoading: false, loadError: null, searchQuery: '', filterStatus: 'all',
    loadClients: jest.fn(), setSearchQuery: jest.fn(), setFilterStatus: jest.fn(), getFilteredClients: () => [],
  }),
}));
jest.mock('../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../ui/skeletons', () => ({ SkeletonClientCard: () => null }));
jest.mock('../../ui/empty-states', () => ({ EmptyStateNoClients: () => null, EmptyStateNoResults: () => null }));
for (const card of ['setup/CoachSetupChecklist', 'money/MoneyHomeCard', 'brief/BriefHomeCard']) {
  jest.doMock(`../../components/coach/${card}`, () => () => null);
}
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
// CommandCenterScreen hands Overview these cards as its header in every state (QA-COACH-HOME-131).
const OverviewCards = () => {
  const CoachHomeCards = require('../../screens/coach/command-center/CoachHomeCards').default;
  return <CoachHomeCards />;
};
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (modulePath.endsWith('/ClientsListScreen')) continue;
  const Stub = modulePath.endsWith('/CommandCenterScreen') ? OverviewCards : () => <Text>{modulePath}</Text>;
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: Stub }));
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
const { prefsStorage } = require('../../storage/mmkv');
const { pushPrimerDismissedKey } = require('../../components/home/PushPermissionCard');

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

beforeEach(async () => {
  push.__resetPushTapRouterForTests();
  await prefsStorage.delete(pushPrimerDismissedKey('coach-1')); // a fresh install
});

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

// The ask's card reads its memory and the OS permission after mount.
const settle = () => act(() => new Promise((r) => setTimeout(r, 10)));
// How many push asks each landing candidate shows (Overview's cards, the rest is Clients).
const asks = () => {
  const all = screen.queryAllByTestId('push-permission-card').length;
  const cards = screen.queryByTestId('coach-home-cards');
  const overview = cards ? within(cards).queryAllByTestId('push-permission-card').length : 0;
  return { CommandCenter: overview, ClientsStack: all - overview };
};
// [coachTabsV2, the landing that carries the ask, the other tab, which never asks]
const ASK_ROWS = [['on', 'CommandCenter', 'ClientsStack'], ['off', 'ClientsStack', 'CommandCenter']] as const;
it.each(ASK_ROWS)('push ask, coachTabsV2 %s: %s asks on a fresh install, %s never asks, and an answered ask stays answered', async (flag, landing, other) => {
  mockFlags.coachTabsV2 = flag === 'on';
  const view = await mount();
  await settle();
  expect(landed()[0]).toBe(landing);
  expect(asks()[landing]).toBe(1);
  expect(asks()[other]).toBe(0);
  await step(() => ref.navigate(other));
  await settle();
  expect(asks()[other]).toBe(0); // no second ask on the other tab
  await step(() => ref.navigate(landing));
  await fireEvent.press(screen.getByTestId('push-permission-dismiss')); // answered: Not now
  await settle();
  expect(asks()).toEqual({ CommandCenter: 0, ClientsStack: 0 });
  await view.rerender(tree(true, undefined, 1)); // reopened after the app was killed
  await settle();
  expect(landed()[0]).toBe(landing);
  expect(asks()).toEqual({ CommandCenter: 0, ClientsStack: 0 });
  await step(() => ref.navigate(other));
  await settle();
  expect(asks()).toEqual({ CommandCenter: 0, ClientsStack: 0 });
});
