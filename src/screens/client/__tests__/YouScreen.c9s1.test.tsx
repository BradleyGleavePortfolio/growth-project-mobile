/**
 * C9-S1: the You home (MOCK-C9 Style C) behind featureFlags.youTabV2. Every
 * tap lands on a registered route; coachless clients get every row (only
 * Roman needs a coach); the Sleep and recovery slot draws nothing yet.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Alert, Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
let mockFocus: (() => void) | null = null;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, getParent: () => ({ navigate: mockParentNavigate }) }),
  useFocusEffect: (cb: () => void) => { mockFocus = cb; }, // the test calls it when You comes back into view
}));
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../config/featureFlags', () => ({
  featureFlags: new Proxy({}, { get: (_t, k: string) => mockFlags[k] ?? false }),
}));
let mockHealthConnect = false;
jest.mock('../../../config/healthConnect', () => ({ isAndroidHealthConnectEnabled: () => mockHealthConnect }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/roman/RomanAvatar', () => () => null);
jest.mock('../../../components/tutorial/TutorialTarget', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), softImpact: jest.fn() } }));
jest.mock('../../../utils/haptics', () => ({ warningTap: jest.fn() }));
let mockUser: Record<string, unknown> | null = null;
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
let mockNeedsCoach = false;
jest.mock('../../../components/coachless/JoinCoachState', () => ({ useClientNeedsCoach: () => mockNeedsCoach }));
let mockAssignments: Array<{ scheduled_for: string; completed_at: string | null }> = [];
jest.mock('../../../hooks/useWorkoutBuilder', () => ({ useMyWorkoutAssignments: () => ({ data: mockAssignments }) }));
const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: (...a: unknown[]) => mockGet(...a) } }));
let mockPlans: unknown[] = [];
const mockListPlans = jest.fn();
jest.mock('../../../lib/packagePayment', () => ({
  ...jest.requireActual('../../../lib/packagePayment'),
  listClientPlans: () => mockListPlans(),
}));
const mockConfirm = jest.fn();
const mockSignOut = jest.fn();
jest.mock('../../../services/authActions', () => ({
  prepareSignOutConfirm: (...a: unknown[]) => mockConfirm(...a),
  signOut: (...a: unknown[]) => mockSignOut(...a),
}));
let mockSheet: Record<string, () => void> | null = null;
jest.mock('../../../components/coachless/CoachCodeSheet', () => (props: Record<string, () => void>) => {
  mockSheet = props;
  return require('react').createElement(require('react-native').Text, { testID: 'coach-code-sheet' }, 'sheet');
});
let mockRing: { segments: string[]; label: string } | null = null;
jest.mock('../../../ui/charts', () => ({
  SegmentedRing: ({ segments, label, children }: { segments: string[]; label: string; children: React.ReactNode }) => {
    mockRing = { segments, label };
    const { View: V } = require('react-native');
    return require('react').createElement(V, { accessible: true, accessibilityLabel: label }, children);
  },
}));

import YouScreen, { SLEEP_AND_RECOVERY_ROW, nextChargeLine, weekSegments } from '../YouScreen';
import { planDate } from '../../../lib/planActions';
import { clearPendingJoin } from '../../../lib/joinPackage';
import { YOUR_PLANS_QUERY_KEY } from '../../../components/purchase/YourPlansPanel';

const NAV = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'navigation', 'ClientNavigator.tsx'), 'utf8');
const stackRoutes = (v: string) => Array.from(NAV.matchAll(new RegExp(`<${v}\\.Screen\\s+name="(\\w+)"`, 'g')), (m) => m[1]);

const COACHED = { id: 'u1', email: 'jordan@example.test', name: 'Jordan Lee', role: 'student', coach_id: 'c1', createdAt: '2026-03-04T12:00:00Z' };
const NEXT = '2026-11-14T12:00:00Z';
const ACTIVE_PLAN = {
  purchaseId: 'p1', packageId: 'k1', packageName: 'Strength', state: 'active', entitlementActive: true, amountCents: 14900,
  currency: 'usd', interval: 'month', intervalCount: 1, nextChargeAt: NEXT, cancelAtPeriodEnd: false, accessEndsAt: null,
  trialEndsAt: null, canCancel: true, canResume: false, checkoutState: null,
};

const REAL_OS = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });
afterAll(() => setOS(REAL_OS));

let client: QueryClient;
function draw() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><YouScreen /></QueryClientProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockFlags)) delete mockFlags[k];
  mockUser = COACHED;
  mockNeedsCoach = false;
  mockAssignments = [];
  mockPlans = [];
  mockListPlans.mockImplementation(async () => mockPlans);
  mockFocus = null;
  mockSheet = null;
  mockRing = null;
  mockHealthConnect = false;
  setOS('ios');
  mockGet.mockResolvedValue({ data: { id: 'c1', name: 'Sam Rivera', avatar_url: null } });
});

describe('week ring and plan line', () => {
  it('one segment per session this week (Monday to Sunday), in date order', () => {
    const now = new Date(2026, 9, 14, 12); // Wednesday
    const at = (d: number, h = 9) => new Date(2026, 9, d, h).toISOString();
    expect(weekSegments([
      { scheduled_for: at(16), completed_at: null },
      { scheduled_for: at(12), completed_at: at(12, 10) },
      { scheduled_for: at(13), completed_at: null },
      { scheduled_for: at(14, 18), completed_at: null },
      { scheduled_for: at(11), completed_at: null },
      { scheduled_for: at(19), completed_at: null },
    ], now)).toEqual(['done', 'missed', 'planned', 'planned']);
  });

  it('names the next charge only for a renewing active plan', () => {
    expect(nextChargeLine([ACTIVE_PLAN as never])).toBe(`Next charge of $149.00 on ${planDate(NEXT)}.`);
    expect(nextChargeLine([{ ...ACTIVE_PLAN, cancelAtPeriodEnd: true } as never])).toBeNull();
    expect(nextChargeLine([])).toBeNull();
    // The server lists the newest purchase first; the older plan charges sooner, so it is the one named.
    const SOONER = { ...ACTIVE_PLAN, purchaseId: 'p0', amountCents: 4900, nextChargeAt: '2026-10-30T12:00:00Z' };
    expect(nextChargeLine([ACTIVE_PLAN, SOONER] as never)).toBe(`Next charge of $49.00 on ${planDate(SOONER.nextChargeAt)}.`);
  });
});

describe('You home', () => {
  it('coached: masthead, ring, coach card and every row land on a real route', async () => {
    const at = (offset: number) => new Date(Date.now() + offset * 3600e3).toISOString();
    mockAssignments = [{ scheduled_for: at(0), completed_at: at(0) }];
    mockPlans = [ACTIVE_PLAN];
    await draw();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('Your details, your coach and your account.')).toBeTruthy();
    expect(screen.getByText('Member since March\u00a02026')).toBeTruthy();
    expect(mockRing).toEqual({ segments: ['done'], label: 'This week, 1 of 1 done' });
    // The ring speaks the week; the line under the name is the same words, hidden from the reader.
    expect(screen.getByText('This week · 1 of 1 done', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('This week · 1 of 1 done')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Jordan Lee, Edit'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ProfileMain');

    expect(await screen.findByText('Sam Rivera')).toBeTruthy();
    expect(screen.getByText('Your coach')).toBeTruthy();
    await fireEvent.press(screen.getByText('Message Sam'));
    expect(mockParentNavigate).toHaveBeenLastCalledWith('Home', { screen: 'Messages', initial: false });

    const plansLabel = `Your plans, Next charge of $149.00 on ${planDate(NEXT)}., Active`;
    await fireEvent.press(await screen.findByLabelText(plansLabel));
    expect(mockNavigate).toHaveBeenLastCalledWith('ClientPackages');
    await fireEvent.press(screen.getByLabelText('Notifications, Coach messages, reminders and quiet hours'));
    expect(mockNavigate).toHaveBeenLastCalledWith('NotificationSettings');

    const more = stackRoutes('MoreStackNav');
    const tabs: Record<string, string[]> = { Home: stackRoutes('HomeStackNav'), WorkoutTab: stackRoutes('WorkoutStackNav') };
    expect(more).toEqual(expect.arrayContaining(['ProfileMain', 'ClientPackages', 'NotificationSettings']));
    expect(tabs.Home).toContain('Messages');
    const rows = screen.getAllByTestId(/^you-row-/).filter((r) => !/-(plans|notifications)$/.test(r.props.testID));
    expect(rows.map((r) => r.props.accessibilityLabel.split(',')[0])).toEqual([
      'Health and sleep', 'Connected devices', 'Meal plan', 'Macro targets', 'Progress', 'Habits and check-in', 'Timeline',
      'Exercise library', 'Community', 'Membership', 'Recipes', 'Fasting', 'Settings', 'Report', 'Learn', 'Shortcuts',
      'Grocery list', 'Prep guide',
    ]);
    for (const r of rows) {
      mockNavigate.mockClear();
      mockParentNavigate.mockClear();
      await fireEvent.press(r);
      const [stack] = mockNavigate.mock.calls;
      const [tab] = mockParentNavigate.mock.calls;
      if (stack) expect(more).toContain(stack[0]);
      else expect(tabs[tab[0]]).toContain(tab[1].screen);
    }
    // Profile's home is Edit; the Sleep slot draws nothing until its page ships.
    expect(screen.queryByText('Profile')).toBeNull();
    expect(SLEEP_AND_RECOVERY_ROW).toBeNull();
  });

  it("coachless: Join a coach opens the coach-code sheet; every row stays (Roman opens today's Roman works with a coach page)", async () => {
    mockUser = { ...COACHED, coach_id: undefined };
    mockNeedsCoach = true;
    mockFlags.romanChat = true;
    await draw();
    expect(mockRing).toBeNull();
    expect(screen.queryByText(/This week/, { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText('Your coach')).toBeNull();
    expect(screen.getByText('Join a coach')).toBeTruthy();
    expect(screen.getByText('A coach builds your plan, checks in on you and unlocks Roman. Your own logging stays open.')).toBeTruthy();
    expect(screen.getByLabelText('Your plans')).toBeTruthy();
    expect(screen.getByLabelText(/^Roman,/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Enter a coach code'));
    expect(screen.getByTestId('coach-code-sheet')).toBeTruthy();
    mockSheet?.onChoosePlan();
    expect(mockNavigate).toHaveBeenLastCalledWith('ClientPackages');
    mockSheet?.onMessageCoach();
    expect(mockParentNavigate).toHaveBeenLastCalledWith('Home', { screen: 'Messages', initial: false });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('coach error: says so, and Try again reads the coach again', async () => {
    mockGet.mockRejectedValueOnce(new Error('offline'));
    await draw();
    expect(await screen.findByText('Your coach did not load. Check the connection and try again.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Sam Rivera')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('loading: the identity and coach wait, the rows are already there', async () => {
    mockUser = null;
    await draw();
    expect(screen.getAllByLabelText('Loading your account')).toHaveLength(2);
    expect(screen.getByLabelText('Your plans')).toBeTruthy();
  });

  it('Health and devices follows the wearable rule (hidden on Android without Health Connect)', async () => {
    setOS('android');
    await draw();
    expect(screen.queryByText('Health and devices')).toBeNull();
    expect(screen.queryByLabelText(/^Connected devices/)).toBeNull();
  });

  it("sign out uses today's confirm", async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockConfirm.mockResolvedValueOnce(null).mockResolvedValueOnce('Are you sure you want to sign out?');
    await draw();
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith('u1'));
    expect(alert).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Sign out'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    const [title, message, buttons] = alert.mock.calls[0] as unknown as [string, string, Array<{ text: string; onPress?: () => void }>];
    expect([title, message, buttons.map((b) => b.text)]).toEqual(['Sign out', 'Are you sure you want to sign out?', ['Cancel', 'Sign out']]);
    buttons[1].onPress?.();
    expect(mockSignOut).toHaveBeenCalled();
    expect(screen.getByText('The Growth Project v1.0.0')).toBeTruthy();
  });
});

describe('B1: the Your plans line follows the plans', () => {
  const ENDING = { ...ACTIVE_PLAN, cancelAtPeriodEnd: true, nextChargeAt: null, accessEndsAt: NEXT, canCancel: false, canResume: true };
  const CHARGE = `Your plans, Next charge of $149.00 on ${planDate(NEXT)}., Active`;
  const shows = (charge: boolean) => waitFor(() => expect(screen.getByLabelText(charge ? CHARGE : 'Your plans')).toBeTruthy());

  it.each<[string, unknown[], unknown[], 'back' | 'attached' | 'paid']>([
    ['ends the plan on Your plans, then comes Back', [ACTIVE_PLAN], [ENDING], 'back'],
    ['buys a renewing plan on Your plans, then comes Back', [], [ACTIVE_PLAN], 'back'],
    ['joins a coach whose code grants a plan, in the code sheet on You', [], [ACTIVE_PLAN], 'attached'],
    ['pays for a coach-code join in the package sheet over You', [], [ACTIVE_PLAN], 'paid'],
  ])('%s', async (_what, before, after, how) => {
    mockNeedsCoach = how !== 'back';
    if (mockNeedsCoach) mockUser = { ...COACHED, coach_id: undefined };
    mockPlans = [...before];
    await draw();
    if (how === 'attached') await fireEvent.press(screen.getByText('Enter a coach code'));
    await shows(before.length > 0);
    mockPlans = [...after];
    await act(async () => {
      if (how === 'back') mockFocus?.();
      else if (how === 'attached') mockSheet?.onAttached();
      else await clearPendingJoin(); // the paid join clears once the server shows the coach
    });
    await shows(after.includes(ACTIVE_PLAN));
  });

  it('End on Your plans outdates the line at once, before the new read answers', async () => {
    mockPlans = [ACTIVE_PLAN];
    await draw();
    await shows(true);
    let answer: (plans: unknown[]) => void = () => undefined;
    mockListPlans.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    await act(async () => { void client.invalidateQueries({ queryKey: YOUR_PLANS_QUERY_KEY }); });
    await shows(false);
    await act(async () => answer([ENDING]));
    await shows(false);
  });

  it('a failed read promises no charge (the earlier line is not shown again)', async () => {
    mockPlans = [ACTIVE_PLAN];
    await draw();
    await shows(true);
    mockListPlans.mockRejectedValueOnce(new Error('offline'));
    await act(async () => mockFocus?.());
    await shows(false);
  });
});

describe('flag and tab', () => {
  it('youTabV2 is off by default; on, MoreIndex is You and the tab reader says You', () => {
    expect(jest.requireActual('../../../config/featureFlags').featureFlags.youTabV2).toBe(false);
    expect(NAV).toContain('name="MoreIndex"    component={featureFlags.youTabV2 ? YouScreen : MoreScreen}');
    expect(NAV).toContain("tabBarAccessibilityLabel: featureFlags.youTabV2 ? 'You' : 'Profile and more'");
  });
});
