/**
 * CF-MONEY-MEMBER-128 (FW-MONEY-128 B-3, U-4). Fails on main e634d19e:
 * - B-3: a client linked to a coach but with no plan read "Active"
 *   (accessGranted = Boolean(coach_id)), while Log and Workout asked them to choose a plan;
 * - U-4: the screen said "Pull to refresh" with no RefreshControl, and its primary action
 *   was an ink "MESSAGE YOUR COACH" instead of one forest plans action.
 */
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
const mockParentNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRefreshEntitlement = jest.fn(async () => true);
let mockFocus: (() => void) | null = null;
let mockUser: { id: string; email?: string; coach_id?: string | null; createdAt?: string } = { id: 'u1' };
let mockEntitlementActive: boolean | null = null;
let mockPlan: unknown = null;
let mockHidden = false;

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, getParent: () => ({ navigate: mockParentNavigate }) }),
  useFocusEffect: (cb: () => void) => {
    mockFocus = cb;
  },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../entitlements/EntitlementProvider', () => ({
  useEntitlement: () => ({ entitlementActive: mockEntitlementActive, refreshEntitlement: mockRefreshEntitlement }),
}));
jest.mock('../../../services/api', () => ({
  aiApi: { getStructuredContext: jest.fn(async () => ({ data: { coach: { name: 'Dana' } } })) },
  usersApi: { getFoundingNumber: jest.fn(async () => ({ data: null })) },
}));
jest.mock('../../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getPaymentStatus: jest.fn(async () => mockPlan) },
}));
jest.mock('../../../config/purchaseSurfaces', () => ({ nonP2PPurchasesHidden: () => mockHidden }));
jest.mock('../../../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../../../theme/tokens').default;
  return {
    useTheme: () => ({
      colors: jest.requireActual('../../../constants/colors').default,
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});

import MembershipScreen from '../MembershipScreen';
import { clientPaymentsApi } from '../../../api/clientPaymentsApi';
import { lightTokens } from '../../../theme/tokens';
import { HELP_CONTACT_URL } from '../../../config/env';

const NONE = { state: 'none', purchase_id: null, package_id: null, package_name: null, current_period_end: null, trial_ends_at: null, cancel_at_period_end: false, access_expires_at: null, dunning: null };
const plan = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: { ...NONE, state: 'active', purchase_id: 'p1', package_id: 'pkg1', package_name: 'Strength', current_period_end: '2026-10-30T12:00:00Z', ...over },
});
const NO_PLAN = { ok: true, data: NONE };
const PLAN_FAILED = { ok: false, reason: 'error', message: 'Network Error' };

async function renderScreen() {
  const s = await render(<MembershipScreen />);
  await waitFor(() => expect(s.getByText('How access works')).toBeTruthy());
  return s;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus = null;
  mockUser = { id: 'u1', email: 'client@example.test', coach_id: 'c1', createdAt: '2026-01-01T00:00:00Z' };
  mockEntitlementActive = null;
  mockPlan = NO_PLAN;
  mockHidden = false;
});

describe('Membership status is the real plan (B-3)', () => {
  it('a coach link without a plan is not Active', async () => {
    mockEntitlementActive = false;
    const s = await renderScreen();
    expect(s.getByText('No active plan')).toBeTruthy();
    expect(s.getByText('To start one, open View coaching plans or message your coach.')).toBeTruthy();
    expect(s.queryByText('Active')).toBeNull();
    expect(s.queryByText(/Access provided by/)).toBeNull();
  });

  it('a renewing plan shows its name and its next renewal', async () => {
    mockPlan = plan();
    const s = await renderScreen();
    expect(s.getByText('Active')).toBeTruthy();
    expect(s.getByText('Strength')).toBeTruthy();
    expect(s.getByText('Renews Oct 30, 2026')).toBeTruthy();
  });

  it('an ended plan says when it ends and that nothing more is charged', async () => {
    mockPlan = plan({ cancel_at_period_end: true });
    const s = await renderScreen();
    expect(s.getByText('Active')).toBeTruthy();
    expect(s.getByText('Ends Oct 30, 2026. Nothing more is charged.')).toBeTruthy();
    expect(s.queryByText(/Renews/)).toBeNull();
  });

  it('a one-time plan says when its access runs out', async () => {
    mockPlan = plan({ current_period_end: null, access_expires_at: '2026-11-15T12:00:00Z' });
    const s = await renderScreen();
    expect(s.getByText('Access until Nov 15, 2026')).toBeTruthy();
  });

  it('a failed payment says so and where to fix it', async () => {
    mockPlan = plan({ state: 'past_due' });
    const s = await renderScreen();
    expect(s.getByText('Payment did not go through')).toBeTruthy();
    expect(s.getByText('To keep this plan, update your card in Your plans.')).toBeTruthy();
    expect(s.queryByText('Active')).toBeNull();
  });

  it('a coachless account still awaits coach access', async () => {
    mockUser = { id: 'u1', email: 'client@example.test', coach_id: null };
    const s = await renderScreen();
    expect(s.getByText('Awaiting coach access')).toBeTruthy();
    expect(s.getByText('Access starts when a coach invite is attached to this account.')).toBeTruthy();
  });

  it('when the plan read fails, a server entitlement still reads Active', async () => {
    mockPlan = PLAN_FAILED;
    mockEntitlementActive = true;
    const s = await renderScreen();
    expect(s.getByText('Active')).toBeTruthy();
    expect(s.getByText('Access provided by Dana.')).toBeTruthy();
    expect(s.getByText('Plan details could not be loaded. Pull down to try again.')).toBeTruthy();
  });

  it('when the plan read fails, an inactive entitlement reads No active plan', async () => {
    mockPlan = PLAN_FAILED;
    mockEntitlementActive = false;
    const s = await renderScreen();
    expect(s.getByText('No active plan')).toBeTruthy();
    expect(s.queryByText('Active')).toBeNull();
  });

  it('when nothing is known, the status says so instead of guessing', async () => {
    mockPlan = PLAN_FAILED;
    const s = await renderScreen();
    expect(s.getByText('Status unavailable')).toBeTruthy();
    expect(s.getByText('Plan details could not be loaded. Pull down to try again.')).toBeTruthy();
    expect(s.queryByText('Active')).toBeNull();
  });
});

describe('Refresh is real (U-4)', () => {
  it('pull to refresh reads the plan and the entitlement again', async () => {
    mockPlan = PLAN_FAILED;
    const s = await renderScreen();
    expect(s.getByText('Status unavailable')).toBeTruthy();
    mockPlan = plan();
    const refresh = s.getByTestId('membership-scroll').props.refreshControl;
    expect(refresh).toBeTruthy();
    await act(async () => {
      await refresh.props.onRefresh();
    });
    expect(clientPaymentsApi.getPaymentStatus).toHaveBeenCalledTimes(2);
    expect(mockRefreshEntitlement).toHaveBeenCalledTimes(1);
    expect(s.getByText('Strength')).toBeTruthy();
    expect(s.queryByText('Plan details could not be loaded. Pull down to try again.')).toBeNull();
  });

  it('coming back to the screen (after ending a plan in Your plans) reads the plan again', async () => {
    mockPlan = plan();
    const s = await renderScreen();
    expect(s.getByText('Renews Oct 30, 2026')).toBeTruthy();
    mockPlan = plan({ cancel_at_period_end: true });
    await act(async () => {
      mockFocus?.();
    });
    await waitFor(() => expect(s.getByText('Ends Oct 30, 2026. Nothing more is charged.')).toBeTruthy());
  });
});

describe('Routes and actions parity', () => {
  it('keeps Back, plans, Message your coach and Contact support; plans is the one forest primary', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockPlan = plan();
    const s = await renderScreen();
    const primary = s.getByTestId('membership-plans');
    expect(s.getByLabelText('Your plans')).toBeTruthy();
    expect(StyleSheet.flatten(primary.props.style).backgroundColor).toBe(lightTokens.accent);
    expect(s.queryByText('MESSAGE YOUR COACH')).toBeNull();
    await fireEvent.press(s.getByLabelText('Back'));
    expect(mockGoBack).toHaveBeenCalled();
    await fireEvent.press(primary);
    expect(mockNavigate).toHaveBeenLastCalledWith('ClientPackages');
    await fireEvent.press(s.getByLabelText('Message your coach'));
    expect(mockParentNavigate).toHaveBeenLastCalledWith('Home', { screen: 'Messages' });
    await fireEvent.press(s.getByLabelText('Contact support'));
    expect(Linking.openURL).toHaveBeenCalledWith(HELP_CONTACT_URL);
  });

  it('with no plan the same primary reads View coaching plans; hidden iOS builds drop only the website link', async () => {
    mockHidden = true;
    const s = await renderScreen();
    expect(s.getByLabelText('View coaching plans')).toBeTruthy();
    await fireEvent.press(s.getByTestId('membership-plans'));
    expect(mockNavigate).toHaveBeenLastCalledWith('ClientPackages');
    expect(s.getByLabelText('Message your coach')).toBeTruthy();
    expect(s.queryByLabelText('Contact support')).toBeNull();
  });
});
