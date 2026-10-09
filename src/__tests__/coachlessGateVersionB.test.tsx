import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import type { CurrentUser } from '../hooks/useCurrentUser';

let mockUser: CurrentUser;
let mockCachedUser: CurrentUser | null = null;
let mockHidden = false;
const mockMessageCoach = jest.fn();
const mockOpenPlans = jest.fn();
const mockParentNavigate = jest.fn();
const mockGetEntitlement = jest.fn();
const mockGetPackages = jest.fn();
const mockGetPaymentStatus = jest.fn();
const mockAttachInviteCode = jest.fn();

jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../lib/userCache', () => ({
  readUserCacheSync: () => mockCachedUser,
  patchUserCache: async (patch: Partial<CurrentUser>) => {
    mockCachedUser = { ...mockUser, ...patch };
  },
}));
jest.mock('../config/purchaseSurfaces', () => ({
  ...jest.requireActual('../config/purchaseSurfaces'),
  nonP2PPurchasesHidden: () => mockHidden,
}));
jest.mock('../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../theme/tokens').default;
  return { useTheme: () => ({
    colors: new Proxy({}, { get: () => '#2C4A36' }),
    semanticColors: tokens.lightTokens, tokens, colorScheme: 'light',
  }) };
});
jest.mock('../theme/useTheme', () => ({
  useTheme: () => jest.requireMock('../theme/ThemeProvider').useTheme(),
}));
jest.mock('../entitlements/EntitlementProvider', () => ({ useEntitlement: () => ({
  entitlementActive: false, status: 'inactive', openPlans: mockOpenPlans,
  messageCoach: mockMessageCoach, refreshEntitlement: jest.fn(async () => false),
}) }));
jest.mock('../api/clientPaymentsApi', () => ({ clientPaymentsApi: {
  getEntitlement: () => mockGetEntitlement(),
  getPackages: () => mockGetPackages(),
  getPaymentStatus: () => mockGetPaymentStatus(),
} }));
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({
      navigate: jest.fn(), canGoBack: () => false,
      getParent: () => ({ navigate: mockParentNavigate }),
    }),
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(cb, []),
  };
});
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: jest.fn(async () => ({ data: {} })) },
  authApi: { attachInviteCode: (code: string) => mockAttachInviteCode(code) },
}));
jest.mock('../hooks/usePackagePurchase', () => ({ usePackagePurchase: () => ({
  state: { phase: 'idle', packageId: null }, busy: false,
  start: jest.fn(), reset: jest.fn(),
}) }));
jest.mock('../components/purchase/usePaymentSheetAppearance', () => ({
  usePaymentSheetAppearance: () => ({ appearance: {}, colorScheme: 'light' }),
}));
jest.mock('../components/purchase/YourPlansPanel', () => () => null);
jest.mock('../entitlements/dunning/DunningBanner', () => ({ DunningBanner: () => null }));
jest.mock('../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));
jest.mock('../components/PackageSelectionSheet', () => () => null);
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../services/firstWinApi', () => ({ firstWinApi: { complete: jest.fn() } }));

import { ProtectedScreen } from '../entitlements/ProtectedScreen';
import { PaywallSheet, COACH_MANAGED_TITLE, COACH_MANAGED_BODY } from '../entitlements/PaywallSheet';
import ClientPackagesScreen from '../screens/client/ClientPackagesScreen';
import Day1WinScreen from '../screens/client/Day1WinScreen';
import { useCoachlessClient } from '../hooks/useCoachlessClient';
import { pairWithCoach } from '../screens/day-one/api';
import { claimPendingInviteCode } from '../lib/pendingInviteCode';

const TITLE = 'This part comes with a coach';
const BODY = 'Join a coach with their code. Each coach sets up what their coaching includes.';
const CTA = 'Enter a coach code';
function CoachlessProbe() {
  return <Text testID="coachless-probe">{useCoachlessClient() ? 'coachless' : 'connected'}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAttachInviteCode.mockReset();
  mockUser = { id: 'client-1', email: 'client@example.test', role: 'student' };
  mockCachedUser = null;
  mockHidden = false;
  mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false } });
  mockGetPackages.mockResolvedValue({ ok: true, data: [] });
  mockGetPaymentStatus.mockResolvedValue({ ok: true, data: { state: 'none' } });
});

it.each([false, true])('ProtectedScreen coachless copy and action (hidden=%s)', async (hidden) => {
  mockHidden = hidden;
  const r = await render(<ProtectedScreen><Text>Paid content</Text></ProtectedScreen>);
  expect(r.getByText(TITLE)).toBeTruthy();
  expect(r.getByText(BODY)).toBeTruthy();
  expect(r.queryByText('Paid content')).toBeNull();
  expect(r.queryByText('View Plans')).toBeNull();
  expect(r.queryByText('Message your coach')).toBeNull();
  await fireEvent.press(r.getByText(CTA));
  expect(mockMessageCoach).toHaveBeenCalledTimes(1);
  expect(mockOpenPlans).not.toHaveBeenCalled();
});

it.each([false, true])('ProtectedScreen connected clients retain copy (hidden=%s)', async (hidden) => {
  mockHidden = hidden;
  mockUser.coach_id = 'coach-1';
  const r = await render(<ProtectedScreen><Text>Paid content</Text></ProtectedScreen>);
  expect(r.getByText(hidden ? COACH_MANAGED_TITLE : 'Choose a Plan')).toBeTruthy();
  expect(r.getByText(hidden ? COACH_MANAGED_BODY : 'Select a coaching package to access this feature.')).toBeTruthy();
  expect(r.getByText(hidden ? 'Message your coach' : 'View Plans')).toBeTruthy();
});

it.each([false, true])('PaywallSheet coachless copy, no packages, one primary action (hidden=%s)', async (hidden) => {
  const onMessageCoach = jest.fn();
  const onSubscribe = jest.fn();
  const r = await render(<PaywallSheet visible purchasesHidden={hidden}
    message="Choose a plan to continue." onClose={jest.fn()}
    onSubscribe={onSubscribe} onMessageCoach={onMessageCoach} />);
  expect(r.getByText(TITLE)).toBeTruthy();
  expect(r.getByText(BODY)).toBeTruthy();
  expect(r.queryByText('Choose a plan to continue.')).toBeNull();
  expect(r.queryByText('Subscribe')).toBeNull();
  expect(mockGetPackages).not.toHaveBeenCalled();
  await fireEvent.press(r.getByText(CTA));
  expect(onMessageCoach).toHaveBeenCalledTimes(1);
  expect(onSubscribe).not.toHaveBeenCalled();
});

it('PaywallSheet connected client retains the hidden-build copy', async () => {
  mockUser.coach_id = 'coach-1';
  const r = await render(<PaywallSheet visible purchasesHidden
    onClose={jest.fn()} onSubscribe={jest.fn()} onMessageCoach={jest.fn()} />);
  expect(r.getByText(COACH_MANAGED_TITLE)).toBeTruthy();
  expect(r.getByText(COACH_MANAGED_BODY)).toBeTruthy();
  expect(r.getByText('Message your coach')).toBeTruthy();
});

it.each(['empty', 'not_configured', 'error'])('ClientPackages coachless gate (%s) reuses Home > Messages', async (state) => {
  if (state !== 'empty') {
    mockGetPackages.mockResolvedValue({ ok: false, reason: state, message: 'Unavailable' });
    mockGetPaymentStatus.mockResolvedValue({ ok: false, reason: state, message: 'Unavailable' });
  }
  const r = await render(<ClientPackagesScreen />);
  expect(await r.findByText(TITLE)).toBeTruthy();
  expect(r.getByText(BODY)).toBeTruthy();
  expect(r.queryByText('Message your coach')).toBeNull();
  await fireEvent.press(r.getByText(CTA));
  expect(mockParentNavigate).toHaveBeenCalledWith('Home', {
    screen: 'Messages', params: { openCoachCode: true },
  });
});

it.each(['empty', 'not_configured'])('ClientPackages connected client retains gate copy (%s)', async (state) => {
  mockUser.coach_id = 'coach-1';
  if (state === 'not_configured') {
    mockGetPackages.mockResolvedValue({ ok: false, reason: 'not_configured' });
    mockGetPaymentStatus.mockResolvedValue({ ok: false, reason: 'not_configured' });
  }
  const r = await render(<ClientPackagesScreen />);
  expect(await r.findByText('No self-serve plans yet')).toBeTruthy();
  expect(r.getByText('Message your coach')).toBeTruthy();
  expect(r.queryByText(TITLE)).toBeNull();
});

it('ClientPackages uses the freshly patched coach cache after a code join', async () => {
  const r = await render(<ClientPackagesScreen />);
  expect(await r.findByText(TITLE)).toBeTruthy();
  mockCachedUser = { ...mockUser, coach_id: 'coach-1' };
  await r.rerender(<ClientPackagesScreen />);
  expect(await r.findByText('No self-serve plans yet')).toBeTruthy();
  expect(r.queryByText(TITLE)).toBeNull();
});

it.each(['day1', 'pending-invite'])('%s attach clears coachless status and exposes the coach plans', async (path) => {
  mockAttachInviteCode.mockResolvedValueOnce({ data: { coach_id: 'coach-1' } });
  const result = await (path === 'day1'
    ? pairWithCoach('GP-COACH')
    : claimPendingInviteCode('GP-COACH'));
  expect(result.ok).toBe(true);
  expect(mockAttachInviteCode).toHaveBeenCalledWith('GP-COACH');
  mockGetPackages.mockResolvedValue({ ok: true, data: [{
    id: 'plan-1', name: 'Coach plan', currency: 'USD', price: 49,
    type: 'recurring', interval: 'month', trial_days: null, features: [],
  }] });
  const r = await render(<><CoachlessProbe /><ClientPackagesScreen /></>);
  expect(r.getByTestId('coachless-probe').props.children).toBe('connected');
  expect(await r.findByText('Coach plan')).toBeTruthy();
  expect(r.queryByText(TITLE)).toBeNull();
});

it('ClientPackages keeps the other empty-list copy for a connected client with a current plan', async () => {
  mockUser.coach_id = 'coach-1';
  mockGetPaymentStatus.mockResolvedValue({ ok: true, data: { state: 'active' } });
  const r = await render(<ClientPackagesScreen />);
  expect(await r.findByText('No plans available right now')).toBeTruthy();
  expect(r.getByText("Your coach hasn't published a plan yet. Message them to ask what's available.")).toBeTruthy();
});

// B-SMALLFIX-135: every Day 1 card is basic self logging (weight, check-in,
// meal), so no client sees fewer cards for having no coach or no package.
it.each([
  ['coached, plan inactive', 'coach-1', { ok: true, data: { active: false } }],
  ['coached, check unavailable', 'coach-1', { ok: false, reason: 'error', message: 'Network unavailable' }],
  ['coached, plan active', 'coach-1', { ok: true, data: { active: true } }],
  ['coachless, no plan', undefined, { ok: true, data: { active: false } }],
])('Day 1 shows all three self-logging cards (%s) and never reads the entitlement for them', async (_label, coachId, result) => {
  mockUser = { ...mockUser, coach_id: coachId };
  mockGetEntitlement.mockResolvedValue(result);
  const r = await render(<Day1WinScreen onComplete={jest.fn()} />);
  expect(r.getByTestId('day1win-card-logged_first_weight')).toBeTruthy();
  expect(r.getByTestId('day1win-card-first_checkin')).toBeTruthy();
  expect(r.getByTestId('day1win-card-first_meal')).toBeTruthy();
  expect(mockGetEntitlement).not.toHaveBeenCalled();
});
