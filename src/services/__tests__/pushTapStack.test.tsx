// DELIVERABLES-BACK-M (LS-1247R1 C1): a tap delivered through CLIENT_PUSH_ROUTES or COACH_PUSH_ROUTES (a device push, a
// held cold-start push or an inbox row) opens its screen with that tab's own home under it, so Back lands on that home,
// whether or not the tab was opened this session; a home already open stays one copy.
// The real ClientNavigator, CommunityNavigator, CoachNavigator and CoachCommunityNavigator (real tabs and native stacks,
// mounted in a NavigationContainer) with every leaf screen they import made shallow, as trainRootReturn.test.tsx and
// coachTabsV2.test.tsx do. Each case is a fresh launch: router attached, app session, tap; then the focused tab, that
// tab's stack, the top route's params, and where the top screen's own navigation.goBack() lands (the call
// DeliverablesScreen.tsx makes).
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { Text } from 'react-native';
import {
  createNavigationContainerRef,
  NavigationContainer,
  NavigationContext,
  NavigationRouteContext,
  type NavigationProp,
  type NavigationState,
  type ParamListBase,
} from '@react-navigation/native';
import { act, render } from '@testing-library/react-native';

const CLIENT_ID = 'stack-client';
const COACH_ID = 'stack-coach';
const mockUser: Record<string, unknown> = { id: CLIENT_ID, role: 'client', coach_id: COACH_ID, profile: {} };
// Every route's switch on ([R27]); clientTimelineV2 and romanChat are set per case.
const SWITCHES = {
  clientCalendar: true, communityTab: true, communityEvents: true, coachCommunity: true, coachTabsV2: true,
  coachBrief: true, coachBriefGate: false, mwbPrograms: true, teamMode: true, clientTutorial: false,
  clientTimelineV2: false, romanChat: false,
};
const mockFlags: Record<string, boolean> = { ...SWITCHES };

// From trainRootReturn.test.tsx (client) and coachTabsV2.test.tsx (coach).
jest.mock('../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: true, confirmedActive: true, status: 'active' }),
}));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../config/featureFlags', () => ({ featureFlags: mockFlags }));
jest.mock('../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../hooks/useAiWithdrawalDrain', () => ({ useAiWithdrawalDrain: () => {} }));
jest.mock('../../hooks/useCommunity', () => ({ useCommunityBadge: () => ({ total: 0 }) }));
jest.mock('../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../components/tutorial/TutorialHost', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../entitlements/withProtectedScreen', () => ({ withProtectedScreen: (screen: unknown) => screen }));
jest.mock('../../components/community/UnreadBadge', () => () => null);
jest.mock('../../entitlements/dunning/UpdateCardScreen', () => ({ __esModule: true, default: mockLeaf('UpdateCardScreen') }));
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(),
    heavyImpact: jest.fn(), warning: jest.fn(), success: jest.fn(), error: jest.fn(),
  },
}));
jest.mock('../../hooks/useCoachRoleType', () => ({ useCoachTeamStatus: () => ({ role: 'head_coach', hasSubCoaches: true }) }));
jest.mock('../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../theme/tokens').lightTokens, colors: new Proxy({}, { get: () => '#000000' }) }),
  LightTheme: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../../services/api', () => ({ coachApi: {
  getUnreadCounts: async () => ({ data: { total: 0, by_client: {} } }),
  getClients: async () => ({ data: [] }),
} }));
jest.mock('../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../../hooks/useMacros', () => ({ useCurrentMacrosForClient: () => ({ isSuccess: false }) }));
jest.mock('../../services/notificationsApi', () => ({ fetchUnreadCount: async () => 0 }));
jest.mock('../../services/commandCenterApi', () => ({ __USING_MOCK_DATA: false })); // what ships
jest.mock('../../components/NotificationBadge', () => () => null);
jest.mock('../../components/purchases/withNonP2PPurchaseGate', () => ({ withNonP2PPurchaseGate: (screen: unknown) => screen }));
// The gates around the two community stacks are not leaves: each renders its children here (this file only).
jest.mock('../../components/community/CommunityTermsGate', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
  withCommunityTerms: (screen: unknown) => screen,
}));
jest.mock('../../components/coachless/JoinCoachState', () => ({
  CoachOnlyGate: ({ children }: { children: React.ReactNode }) => children,
  COMMUNITY_LOCK_TITLE: '', COMMUNITY_LOCK_BODY: '',
}));

// Every leaf screen the four navigators import is shallow (read from their own imports, so screens an open PR adds are
// shallow too). Each keeps its own navigation object, so Back is the screen's own goBack().
const mockScreenNavs = new Map<string, NavigationProp<ParamListBase>>();
function mockLeaf(label: string) {
  return function LeafScreen() {
    const navigation = React.useContext(NavigationContext);
    const route = React.useContext(NavigationRouteContext);
    if (navigation && route) mockScreenNavs.set(route.key, navigation as NavigationProp<ParamListBase>);
    return <Text>{label}</Text>;
  };
}
for (const navigator of ['ClientNavigator', 'CommunityNavigator', 'CoachNavigator', 'CoachCommunityNavigator']) {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'navigation', `${navigator}.tsx`), 'utf8');
  for (const match of source.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
    const modulePath = match[1];
    jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: mockLeaf(modulePath) }));
  }
}
jest.doMock('../../screens/coach/ed/FirstPaymentWowHost', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.doMock('../../navigation/ProgramsStackNavigator', () => ({ __esModule: true, default: () => <Text>ProgramsStackNavigator</Text> }));
const ClientNavigator = require('../../navigation/ClientNavigator').default;
const CoachNavigator = require('../../navigation/CoachNavigator').default;
const push = require('../pushTapRouter');

type Ref = ReturnType<typeof createNavigationContainerRef<ParamListBase>>;
type Role = 'student' | 'coach';

const focusedTab = (ref: Ref) => {
  const root = ref.getRootState();
  return root.routes[root.index].name;
};
const stackOf = (ref: Ref, tab: string) =>
  (ref.getRootState().routes.find((route) => route.name === tab)?.state as NavigationState | undefined)
    ?.routes.map((route) => route.name);

async function launch(role: Role) {
  mockUser.id = role === 'student' ? CLIENT_ID : COACH_ID;
  mockUser.role = role === 'student' ? 'client' : 'coach';
  mockScreenNavs.clear();
  const ref = createNavigationContainerRef<ParamListBase>();
  const Navigator = role === 'student' ? ClientNavigator : CoachNavigator;
  await render(<NavigationContainer ref={ref}><Navigator /></NavigationContainer>);
  push.__resetPushTapRouterForTests();
  push.attachPushNavigator(ref);
  return ref;
}
const appSession = (role: Role) =>
  push.setPushSession({ kind: 'app', userId: role === 'student' ? CLIENT_ID : COACH_ID, role });

/** What the user sees after the tap, then where the top screen's own Back lands. */
async function landed(ref: Ref, tab: string) {
  const top = ref.getCurrentRoute();
  const seen = { tab: focusedTab(ref), stack: stackOf(ref, tab), params: top?.params, back: [] as (string | undefined)[] };
  await act(async () => mockScreenNavs.get(top!.key)!.goBack());
  seen.back = [focusedTab(ref), ref.getCurrentRoute()?.name];
  return seen;
}

interface Case {
  name: string;
  role: Role;
  flags?: Partial<typeof SWITCHES>;
  before?: (ref: Ref) => Promise<void>;
  tap: () => unknown;
  tab: string;
  stack: string[];
  params?: Record<string, string>;
  back: [string, string];
}
const PURCHASE = { purchaseId: 'p-1' };
const deliverablesPush = () => push.routePushTap('Deliverables', PURCHASE, 'n-1', 'tgp://client/library');
const openYou = (screen?: string) => async (ref: Ref) => {
  await act(async () => ref.navigate('MoreTab', screen ? { screen, initial: false } : undefined));
  await act(async () => ref.navigate('Home'));
};

// Members: the tab is drawn on its first visit and the route names a screen that is not its stack's home.
const MEMBERS: Case[] = [
  { name: 'a. Deliverables push (New content), You never opened', role: 'student', tap: deliverablesPush,
    tab: 'MoreTab', stack: ['MoreIndex', 'Deliverables'], params: PURCHASE, back: ['MoreTab', 'MoreIndex'] },
  { name: 'b. Deliverables inbox row, You never opened', role: 'student',
    tap: () => expect(push.routeInAppNotification('Deliverables', PURCHASE)).toBe(true),
    tab: 'MoreTab', stack: ['MoreIndex', 'Deliverables'], params: PURCHASE, back: ['MoreTab', 'MoreIndex'] },
  { name: 'e. Membership push, You never opened', role: 'student', tap: () => push.routePushTap('Membership', undefined, 'n-2'),
    tab: 'MoreTab', stack: ['MoreIndex', 'Membership'], back: ['MoreTab', 'MoreIndex'] },
  { name: 'e. Timeline push with clientTimelineV2 off, You never opened', role: 'student', flags: { clientTimelineV2: false },
    tap: () => push.routePushTap('Timeline', undefined, 'n-3'),
    tab: 'MoreTab', stack: ['MoreIndex', 'Timeline'], back: ['MoreTab', 'MoreIndex'] },
  { name: 'e. CalendarSession booking push, Calendar never opened', role: 'student',
    tap: () => push.routePushTap('CalendarSession', { sessionId: 's-1' }, 'n-4'),
    tab: 'CalendarTab', stack: ['CalendarHome', 'CalendarSession'], params: { sessionId: 's-1' }, back: ['CalendarTab', 'CalendarHome'] },
  { name: 'e. client CommunityEventDetail push, Community never opened', role: 'student',
    tap: () => push.routePushTap('CommunityEventDetail', { eventId: 'e-1' }, 'n-5'),
    tab: 'CommunityTab', stack: ['CommunityTab', 'CommunityEventDetail'], params: { eventId: 'e-1' }, back: ['CommunityTab', 'CommunityTab'] },
  { name: 'e. coach CommunityEventDetail push, Community never opened', role: 'coach',
    tap: () => push.routePushTap('CommunityEventDetail', { eventId: 'e-2' }, 'n-6'),
    tab: 'CommunityStack', stack: ['CoachCommunityHome', 'CoachCommunityEvents'], params: { eventId: 'e-2' },
    back: ['CommunityStack', 'CoachCommunityHome'] },
  { name: 'e. coach CoachCommunityEvents push, Community never opened', role: 'coach',
    tap: () => push.routePushTap('CoachCommunityEvents', undefined, 'n-7'),
    tab: 'CommunityStack', stack: ['CoachCommunityHome', 'CoachCommunityEvents'], back: ['CommunityStack', 'CoachCommunityHome'] },
];

// Controls: the same at main and with the fix.
const CONTROLS: Case[] = [
  { name: 'd. Deliverables push, You already open on its home: one home under it', role: 'student', before: openYou(),
    tap: deliverablesPush, tab: 'MoreTab', stack: ['MoreIndex', 'Deliverables'], params: PURCHASE, back: ['MoreTab', 'MoreIndex'] },
  { name: 'd. Deliverables push, You open with Membership on top: Membership kept under it', role: 'student',
    before: openYou('Membership'), tap: deliverablesPush,
    tab: 'MoreTab', stack: ['MoreIndex', 'Membership', 'Deliverables'], params: PURCHASE, back: ['MoreTab', 'Membership'] },
  { name: 'f. Home > Messages push (Home drawn at start)', role: 'student',
    tap: () => push.routePushTap('Messages', { threadId: 't-1' }, 'n-8'),
    tab: 'Home', stack: ['HomeMain', 'Messages'], params: { threadId: 't-1' }, back: ['Home', 'HomeMain'] },
  { name: 'f. Timeline push with clientTimelineV2 on (beneath)', role: 'student', flags: { clientTimelineV2: true },
    tap: () => push.routePushTap('Timeline', undefined, 'n-9'),
    tab: 'MoreTab', stack: ['MoreIndex', 'Progress', 'Timeline'], back: ['MoreTab', 'Progress'] },
  { name: 'f. UpdateCard push (initial: false)', role: 'student', tap: () => push.routePushTap('UpdateCard', undefined, 'n-10'),
    tab: 'MoreTab', stack: ['MoreIndex', 'UpdateCard'], back: ['MoreTab', 'MoreIndex'] },
  { name: 'f. AIGuide push with romanChat off: one You home', role: 'student', flags: { romanChat: false },
    tap: () => push.routePushTap('AIGuide', undefined, 'n-11'), tab: 'MoreTab', stack: ['MoreIndex'], back: ['Home', 'HomeMain'] },
  { name: 'f. coach NotificationCenter push (Clients drawn at start)', role: 'coach',
    tap: () => push.routePushTap('NotificationCenter', undefined, 'n-12'),
    tab: 'ClientsStack', stack: ['ClientsList', 'NotificationCenter'], back: ['ClientsStack', 'ClientsList'] },
];

beforeEach(() => {
  Object.assign(mockFlags, SWITCHES);
});

async function run(c: Case) {
  Object.assign(mockFlags, c.flags);
  const ref = await launch(c.role);
  await c.before?.(ref);
  appSession(c.role);
  await act(async () => { c.tap(); });
  return landed(ref, c.tab);
}

describe('same class as DELIVERABLES-BACK-M: the tab\'s own home under the opened screen', () => {
  it.each(MEMBERS.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    expect(await run(c)).toEqual({ tab: c.tab, stack: c.stack, params: c.params, back: c.back });
  });

  it('c. a Deliverables push held on a cold start opens over the You home once the app session is set', async () => {
    const ref = await launch('student');
    await act(async () => { deliverablesPush(); });
    expect([focusedTab(ref), stackOf(ref, 'MoreTab')]).toEqual(['Home', undefined]); // held, not delivered
    await act(async () => { appSession('student'); });
    expect(await landed(ref, 'MoreTab')).toEqual({
      tab: 'MoreTab', stack: ['MoreIndex', 'Deliverables'], params: PURCHASE, back: ['MoreTab', 'MoreIndex'],
    });
  });
});

describe('controls: the same at main and with the fix', () => {
  it.each(CONTROLS.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    expect(await run(c)).toEqual({ tab: c.tab, stack: c.stack, params: c.params, back: c.back });
  });
});
