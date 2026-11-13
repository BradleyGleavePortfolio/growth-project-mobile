// INAPP-BACK-M (LO-971R1 C1 to C6, same class as DELIVERABLES-BACK-M): an in-app tap that opens a screen in the You
// tab, a tab the client may not have opened this session, opens it with the You home under it, so the screen's own Back
// lands on the You home and the You tab shows its home afterwards; a You tab already open keeps what it held.
// The real ClientNavigator (real tabs and native stacks) in a NavigationContainer, every leaf screen it imports made
// shallow by reading its own imports (as pushTapStack.test.tsx and trainRootReturn.test.tsx do), except the real
// MessagesScreen and CheckoutReturnScreen; the HomeMain leaf renders the real ProfileNudge or CoachlessHomeSlot where a
// case says so. Each case starts on the member's real origin, fires the tap, then reads the focused tab, the You tab's
// stack, the top route's params, where the top screen's own goBack() lands, and what the You tab shows afterwards.
// Proof holds on @react-navigation/core 7.21.1 (getStateFromParams, useNavigationBuilder.tsx).
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
import { HeaderBackContext } from '@react-navigation/elements';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { CoachCodeSheetProps } from '../../components/coachless/CoachCodeSheet';

const mockUser: Record<string, unknown> = { id: 'tap-client', role: 'client', profile: {} }; // no coach: C2 and C3's path
// Every switch a member's path reads on ([R27]); youTabV2 runs both ways below.
const SWITCHES = { clientCalendar: true, communityTab: true, youTabV2: true, romanChat: false, clientTutorial: false };
const mockFlags: Record<string, boolean> = { ...SWITCHES };

// Navigator edges, from pushTapStack.test.tsx.
jest.mock('../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({
    entitlementActive: true, confirmedActive: true, status: 'active',
    refreshEntitlement: async () => false, messageCoach: jest.fn(),
  }),
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
jest.mock('../../components/community/CommunityTermsGate', () => ({ withCommunityTerms: (screen: unknown) => screen }));
jest.mock('../../components/community/UnreadBadge', () => () => null);
jest.mock('../../entitlements/dunning/UpdateCardScreen', () => ({ __esModule: true, default: mockLeaf('UpdateCardScreen') }));
jest.mock('../../ui/haptics/haptics.service', () => ({
  HapticService: {
    selection: jest.fn(), softImpact: jest.fn(), mediumImpact: jest.fn(),
    heavyImpact: jest.fn(), warning: jest.fn(), success: jest.fn(), error: jest.fn(),
  },
}));
jest.mock('../../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../../theme/tokens');
  return {
    useTheme: () => ({
      semanticColors: tokens.lightTokens, tokens: tokens.default, colorScheme: 'light',
      colors: new Proxy({}, { get: () => '#000000' }),
    }),
    LightTheme: ({ children }: { children: React.ReactNode }) => children,
    ThemeColors: {},
  };
});
jest.mock('../../components/home/PushPermissionCard', () => () => null);
jest.mock('../../components/purchases/withNonP2PPurchaseGate', () => ({ withNonP2PPurchaseGate: (screen: unknown) => screen }));
// The members' own data, from CoachlessHomeSlot.test.tsx and MessagesScreenNoCoach.test.tsx.
const mockCoachlessHome = {
  eligible: true,
  coach_attached: false,
  banner: { title: 'Banner title', offer_text: 'Offer text.', code: 'GP-TOP' },
  roman_card: null,
  roman_card_hidden_reason: null,
  featured_coach: null,
};
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => ({ data: url === '/coachless/home' ? mockCoachlessHome : [] })),
    post: jest.fn(async () => ({ data: { recorded: true, visible: true } })),
    delete: jest.fn(),
  },
  messagesApi: {
    list: jest.fn(async () => Promise.reject({ response: { status: 409, data: { code: 'NO_COACH_ASSIGNED' } } })),
    coachReview: jest.fn(async () => ({ data: { coachReviewedAt: null } })),
    send: jest.fn(),
    markRead: jest.fn(async () => ({ data: {} })),
  },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../hooks/useFeatureFlags', () => ({
  useFeatureFlags: () => ({ flags: { messaging_core_v2: false, coachless_home: true } }),
}));
jest.mock('../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => true })); // iOS: CoachlessHomeSlot.tsx:144
jest.mock('../../lib/userCache', () => ({ patchUserCache: jest.fn(async () => undefined), readUserCacheSync: () => null }));
jest.mock('../../components/PackageSelectionSheet', () => () => null);
jest.mock('../../services/realtime', () => ({ subscribeToMessages: () => () => undefined }));
jest.mock('../../hooks/useBlockedUsersHydration', () => ({
  useBlockedUsersHydration: () => ({ serverHydrationComplete: true }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
let mockSheetProps: CoachCodeSheetProps | null = null;
jest.mock('../../components/coachless/CoachCodeSheet', () => (props: CoachCodeSheetProps) => {
  mockSheetProps = props;
  return null;
});
// The lockout's status read (dunningLockout.test.tsx's LOCKED).
const mockLocked = {
  enabled: true, state: 'locked', purchase_id: 'p1', amount_cents: 15000, currency: 'usd',
  failed_at: '2026-10-01T15:00:00.000Z', lockout_at: '2026-10-11T15:00:00.000Z', locked_at: '2026-10-11T15:07:00.000Z',
  day: 10, coach_name: 'Avery', card_last4: '4242', card_brand: 'visa',
};
jest.mock('../../entitlements/dunning/dunningApi', () => ({
  ...jest.requireActual('../../entitlements/dunning/dunningApi'),
  dunningApi: { getStatus: jest.fn(async () => mockLocked), createCardSetup: jest.fn(), confirmCardUpdate: jest.fn(), cancelPlan: jest.fn() },
}));

// Every leaf screen ClientNavigator imports is shallow (read from its own imports). Each keeps its own navigation, so
// Back is the screen's own goBack(), and records the header back its native stack computes (NativeStackView.native.tsx
// :262, handed to the native header as its back button).
const HOME = '../screens/client/HomeScreen';
const REAL = new Set(['../screens/client/MessagesScreen', '../screens/client/CheckoutReturnScreen']);
const mockScreenNavs = new Map<string, NavigationProp<ParamListBase>>();
const mockHeaderBack = new Map<string, unknown>();
const mockBodies: Record<string, React.ComponentType | undefined> = {};
function mockLeaf(label: string) {
  return function LeafScreen() {
    const navigation = React.useContext(NavigationContext);
    const route = React.useContext(NavigationRouteContext);
    const headerBack = React.useContext(HeaderBackContext);
    if (navigation && route) {
      mockScreenNavs.set(route.key, navigation as NavigationProp<ParamListBase>);
      mockHeaderBack.set(route.key, headerBack);
    }
    const Body = mockBodies[label];
    return <>{Body ? <Body /> : null}<Text>{label}</Text></>;
  };
}
const navSource = fs.readFileSync(path.join(__dirname, '..', 'ClientNavigator.tsx'), 'utf8');
for (const match of navSource.matchAll(/^import (?!type\b)[^;]*? from '(\.\.\/screens\/[^']+)'/gm)) {
  const modulePath = match[1];
  if (REAL.has(modulePath)) continue;
  jest.doMock(`../${modulePath}`, () => ({ __esModule: true, default: mockLeaf(modulePath) }));
}
jest.doMock('../CommunityNavigator', () => ({ __esModule: true, default: function Community() { return null; } }));
const ClientNavigator = require('../ClientNavigator').default;
const ProfileNudge = require('../../components/home/ProfileNudge').default;
const CoachlessHomeSlot = require('../../components/coachless/CoachlessHomeSlot').default;
const { openSupportFrom } = require('../../components/ai/useOpenSupport');
const { DunningLockoutProvider } = require('../../entitlements/dunning/DunningLockoutProvider');
const { dunningLockoutStore } = require('../../entitlements/dunning/dunningLockoutStore');

type Ref = ReturnType<typeof createNavigationContainerRef<ParamListBase>>;
type View = Awaited<ReturnType<typeof render>>;
type Shape = 'main' | 'head';
/** The navigate argument as main sends it (the screen alone) and as this PR sends it. */
const arg = (shape: Shape, screen: string, params?: object) =>
  ({ screen, ...(params ? { params } : {}), ...(shape === 'head' ? { initial: false } : {}) });

const focusedTab = (ref: Ref) => {
  const root = ref.getRootState();
  return root.routes[root.index].name;
};
const stackOf = (ref: Ref, tab: string) =>
  (ref.getRootState().routes.find((route) => route.name === tab)?.state as NavigationState | undefined)
    ?.routes.map((route) => route.name);
const leafNav = (ref: Ref) => mockScreenNavs.get(ref.getCurrentRoute()!.key)!;

async function launch(opts: { lockout?: Shape } = {}) {
  mockScreenNavs.clear();
  mockHeaderBack.clear();
  mockSheetProps = null;
  const ref = createNavigationContainerRef<ParamListBase>();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const shape = opts.lockout;
  const app = shape ? (
    // RootNavigator.tsx:1118-1128: the lockout around the client navigator, its handlers sending main's or this PR's argument.
    <DunningLockoutProvider
      enabled
      onMessageCoach={jest.fn()}
      onOpenDataExport={() => ref.navigate('MoreTab', arg(shape, 'DataExport'))}
      onOpenDeleteAccount={() => ref.navigate('MoreTab', arg(shape, 'DeleteAccount'))}
      onOpenUpdateCard={(p: { autostart: boolean }) => ref.navigate('MoreTab', arg(shape, 'UpdateCard', { autostart: p.autostart }))}
      onSignOut={jest.fn()}
      getCurrentRouteName={() => (ref.isReady() ? ref.getCurrentRoute()?.name : undefined)}
      subscribeToRouteChanges={(listener: () => void) => ref.addListener('state', listener)}
    >
      <ClientNavigator />
    </DunningLockoutProvider>
  ) : <ClientNavigator />;
  const view = await render(
    <QueryClientProvider client={qc}><NavigationContainer ref={ref}>{app}</NavigationContainer></QueryClientProvider>,
  );
  return { ref, view };
}

/** What the user sees after the tap, where the top screen's own Back lands, then what the You tab shows. */
async function landed(ref: Ref) {
  const top = ref.getCurrentRoute()!;
  const nav = mockScreenNavs.get(top.key)!;
  const seen = {
    tab: focusedTab(ref), stack: stackOf(ref, 'MoreTab'), params: top.params, canGoBack: nav.canGoBack(),
    back: [] as (string | undefined)[], youShows: undefined as string | undefined,
  };
  await act(async () => nav.goBack());
  seen.back = [focusedTab(ref), ref.getCurrentRoute()?.name];
  await act(async () => ref.navigate('MoreTab'));
  seen.youShows = ref.getCurrentRoute()?.name;
  return seen;
}
/** With the You home under X (this PR, or the You tab already open). */
const overYouHome = (screen: string, params?: object) => ({
  tab: 'MoreTab', stack: ['MoreIndex', screen], params, canGoBack: true, back: ['MoreTab', 'MoreIndex'], youShows: 'MoreIndex',
});
/** X alone in the You tab (main, You never opened): Back leaves for Home and the You tab keeps X. */
const alone = (screen: string, origin: string, params?: object) => ({
  tab: 'MoreTab', stack: [screen], params, canGoBack: true, back: ['Home', origin], youShows: screen,
});

const openYou = (screen?: string) => async (ref: Ref) => {
  await act(async () => ref.navigate('MoreTab', screen ? { screen, initial: false } : undefined));
  await act(async () => ref.navigate('Home'));
};
const toOrigin = (origin: string) => async (ref: Ref) => {
  if (origin !== 'HomeMain') await act(async () => ref.navigate('Home', { screen: origin }));
};

interface Member {
  name: string;
  origin: 'HomeMain' | 'Messages' | 'MessagesInbox';
  body?: React.ComponentType;
  tap: (view: View, ref: Ref) => Promise<void>;
  screen: string;
}
const pressNudge = async (view: View) => {
  await fireEvent.press(await view.findByLabelText(/^Complete your profile\. Missing .+\.$/));
};
const chooseCoachlessPlan = async (view: View) => {
  await fireEvent.press(await view.findByTestId('coachless-join'));
  await waitFor(() => expect(mockSheetProps).not.toBeNull());
  await act(async () => mockSheetProps!.onChoosePlan('pkg-49'));
};
const MEMBERS: Member[] = [
  { name: 'C1 ProfileNudge.tsx:50, Home "Finish your profile"', origin: 'HomeMain',
    body: () => <ProfileNudge hasCoachPlan={false} hasTargets />, tap: pressNudge, screen: 'EditProfile' },
  { name: 'C2 CoachlessHomeSlot.tsx:145, Home code sheet "Choose a plan" (iOS)', origin: 'HomeMain',
    body: () => <CoachlessHomeSlot />, tap: chooseCoachlessPlan, screen: 'ClientPackages' },
  { name: 'C3 MessagesScreen.tsx:685, no-coach "Contact support"', origin: 'Messages', screen: 'SupportInbox',
    tap: async (view) => { await fireEvent.press(await view.findByTestId('messages-no-coach-support')); } },
  { name: 'C3 MessagesScreen.tsx:591, no-coach code sheet "Choose a plan"', origin: 'Messages', screen: 'ClientPackages',
    tap: async (view) => {
      await fireEvent.press(await view.findByTestId('messages-no-coach-code'));
      await waitFor(() => expect(mockSheetProps).not.toBeNull());
      await act(async () => mockSheetProps!.onChoosePlan(null));
    } },
  { name: 'C4 useOpenSupport.ts:32, openSupportFrom on Home > MessagesInbox', origin: 'MessagesInbox', screen: 'SupportInbox',
    tap: async (_view, ref) => { await act(async () => { expect(openSupportFrom(leafNav(ref))).toBe(true); }); } },
];

async function fire(m: Member, before?: (ref: Ref) => Promise<void>) {
  mockBodies[HOME] = m.body;
  const { ref, view } = await launch();
  await before?.(ref);
  await toOrigin(m.origin)(ref);
  expect(ref.getCurrentRoute()?.name).toBe(m.origin);
  await m.tap(view, ref);
  await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe(m.screen));
  return ref;
}

beforeEach(() => {
  Object.assign(mockFlags, SWITCHES);
  for (const k of Object.keys(mockBodies)) delete mockBodies[k];
  dunningLockoutStore.__resetForTests();
});

describe.each([true, false])('youTabV2 %s (MoreIndex is YouScreen or MoreScreen; the shallow leaf keeps the route name)', (youTabV2) => {
  beforeEach(() => { mockFlags.youTabV2 = youTabV2; });

  describe('a. members fired from inside the navigator, the You tab never opened: the You home under the screen', () => {
    it.each(MEMBERS.map((m) => [m.name, m] as const))('%s', async (_name, m) => {
      const ref = await fire(m, async (r) => { expect(stackOf(r, 'MoreTab')).toBeUndefined(); });
      expect(await landed(ref)).toEqual(overYouHome(m.screen));
    });
  });

  describe('b. controls: the same at main and with the fix', () => {
    it('C1 with the You tab already open on its home: one You home under Edit profile', async () => {
      const ref = await fire(MEMBERS[0], openYou());
      expect(await landed(ref)).toEqual(overYouHome('EditProfile'));
    });

    it('C1 with the You tab open on Membership: Membership kept under Edit profile', async () => {
      const ref = await fire(MEMBERS[0], openYou('Membership'));
      expect(await landed(ref)).toEqual({
        tab: 'MoreTab', stack: ['MoreIndex', 'Membership', 'EditProfile'], params: undefined, canGoBack: true,
        back: ['MoreTab', 'Membership'], youShows: 'Membership',
      });
    });

    it('useOpenSupport.ts:27-29 from a You-stack leaf (Settings) opens Support by name', async () => {
      const { ref } = await launch();
      await act(async () => ref.navigate('MoreTab', { screen: 'Settings', initial: false }));
      await act(async () => { expect(openSupportFrom(leafNav(ref))).toBe(true); });
      expect(await landed(ref)).toEqual({
        tab: 'MoreTab', stack: ['MoreIndex', 'Settings', 'SupportInbox'], params: undefined, canGoBack: true,
        back: ['MoreTab', 'Settings'], youShows: 'Settings',
      });
    });

    it.each([
      ['over the You home', { initial: false }, ['MoreIndex', 'CheckoutReturn']],
      ['alone (as a checkout link opens it)', {}, ['CheckoutReturn']],
    ] as const)('N8 CheckoutReturnScreen.tsx:273, the You tab holding Checkout return %s: Back to plans pushes over it', async (_l, extra, held) => {
      const { ref, view } = await launch();
      await act(async () => ref.navigate('MoreTab', { screen: 'CheckoutReturn', params: { outcome: 'cancel' }, ...extra }));
      expect(stackOf(ref, 'MoreTab')).toEqual(held);
      await fireEvent.press(await view.findByText('Back to plans'));
      await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe('ClientPackages'));
      expect(stackOf(ref, 'MoreTab')).toEqual([...held, 'ClientPackages']);
      await act(async () => leafNav(ref).goBack());
      expect([focusedTab(ref), ref.getCurrentRoute()?.name]).toEqual(['MoreTab', 'CheckoutReturn']);
    });
  });

  // RootNavigator's six calls use its module-private ref (the pin pair): rootNavigatorInAppBack.test.tsx and
  // rootNavigatorPackagePromptGate.test.tsx:364 pin each exact argument; these send that argument through a real
  // container ref, once as main sends it and once as this PR does.
  describe('c. RootNavigator\'s six through the container ref, main\'s argument and this PR\'s', () => {
    const SIX: [string, string, object | undefined][] = [
      ['RootNavigator.tsx:337 openDataExport', 'DataExport', undefined],
      ['RootNavigator.tsx:341 openDeleteAccount', 'DeleteAccount', undefined],
      ['RootNavigator.tsx:346 openUpdateCard', 'UpdateCard', { autostart: true }],
      ['RootNavigator.tsx:988 Day 1 "Log your starting weight"', 'Progress', undefined],
      ['RootNavigator.tsx:1082 onOpenPlans (package_prompt)', 'ClientPackages', undefined],
      ['RootNavigator.tsx:1113 onOpenPlans (student)', 'ClientPackages', undefined],
    ];
    it.each(SIX.flatMap(([name, screen, params]) => (['main', 'head'] as const).map((shape) => [name, shape, screen, params] as const)))(
      '%s, %s argument, the You tab never opened', async (_name, shape, screen, params) => {
        const { ref } = await launch();
        await act(async () => ref.navigate('MoreTab', arg(shape, screen, params)));
        const headerBack = mockHeaderBack.get(ref.getCurrentRoute()!.key);
        expect(await landed(ref)).toEqual(shape === 'head' ? overYouHome(screen, params) : alone(screen, 'HomeMain', params));
        // Progress's stack header (backOnlyHeader, ClientNavigator.tsx:586): a back button only with a route under it.
        if (screen === 'Progress') expect(headerBack !== undefined).toBe(shape === 'head');
      });
  });

  describe('d. the lockout (real DunningLockoutProvider around the real ClientNavigator), main\'s argument and this PR\'s', () => {
    it.each([
      ['Download my data', 'dunning-lockout-data-export', 'DataExport'],
      ['Delete my account', 'dunning-lockout-delete-account', 'DeleteAccount'],
      ['Update card', 'dunning-lockout-update-card', 'UpdateCard'],
    ].flatMap((c) => (['main', 'head'] as const).map((shape) => [...c, shape] as const)))(
      '%s from the lockout over Home (%s, %s argument): no lockout over the screen; Back keeps the lockout, with no lockout Back',
      async (_label, testID, screen, shape) => {
        const { ref, view } = await launch({ lockout: shape });
        await act(async () => { dunningLockoutStore.reportLocked({ requestId: 'req-1' }); });
        await view.findByTestId('dunning-lockout-overlay');
        await fireEvent.press(view.getByTestId(testID));
        await waitFor(() => expect(ref.getCurrentRoute()?.name).toBe(screen));
        expect(view.queryByTestId('dunning-lockout-overlay')).toBeNull(); // T4: the screen stays reachable while locked
        expect(stackOf(ref, 'MoreTab')).toEqual(shape === 'head' ? ['MoreIndex', screen] : [screen]);
        await act(async () => leafNav(ref).goBack());
        expect([focusedTab(ref), ref.getCurrentRoute()?.name]).toEqual(shape === 'head' ? ['MoreTab', 'MoreIndex'] : ['Home', 'HomeMain']);
        expect(await view.findByTestId('dunning-lockout-overlay')).toBeTruthy();
        expect(view.queryByTestId('dunning-lockout-back')).toBeNull();
      });
  });
});
