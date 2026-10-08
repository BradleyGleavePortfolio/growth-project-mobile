/**
 * CF-MONEY-PLANS-128 (FW-MONEY-128 MONEY-PLANS-128): the plans screen tells
 * the truth.
 *
 * B-1 — failing before: the refund line sent the client on a three-step path
 * (You > Settings > Support) with no support action on the screen, and said a
 * plan can be ended "through your coach", which no coach tool does.
 * U-3 — failing before: a client who already used the coach's free trial
 * (trial_offer.available false) was still told "7-day free trial".
 * U-5 — failing before: a failed list read showed the transport text
 * ("Request failed with status code 500 Tap to retry.").
 * U-7 — failing before: one renewing plan showed three times: Your plans, the
 * Current plan card and a "Current" pill on its package.
 *
 * Real clientPaymentsApi, YourPlansPanel and ClientPackagesScreen; only HTTP,
 * navigation, Linking and the clipboard are mocked.
 */
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({ tokens: realTokens, semanticColors: realTokens.lightTokens, colorScheme: 'light' }),
  };
});
jest.mock('../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, deliverables: true } };
});
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      canGoBack: () => true,
      getParent: () => ({ navigate: mockNavigate }),
    }),
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(cb, []),
  };
});
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client-plans', role: 'student', coach_id: 'coach-1' }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
}));

import ClientPackagesScreen from '../screens/client/ClientPackagesScreen';
import { purchasableFromCoachPackage } from '../lib/planTerms';
import { SUPPORT_EMAIL } from '../constants/support';

const MONTHLY = {
  id: 'pkg-monthly', name: 'Monthly coaching', amount_cents: 4900, currency: 'usd',
  billing_type: 'recurring', interval: 'month', description: null, features: [],
};
const QUARTERLY = {
  id: 'pkg-quarterly', name: 'Quarterly coaching', amount_cents: 12900, currency: 'usd',
  billing_type: 'recurring', interval: 'month', interval_count: 3, description: null, features: [],
};
const ONCE = {
  id: 'pkg-once', name: 'Six-week block', amount_cents: 29900, currency: 'usd',
  billing_type: 'one_time', interval: null, description: null, features: [],
};
const trialPackage = (offer: Record<string, unknown>) => ({
  ...MONTHLY, id: 'pkg-trial', name: 'Trial coaching', trial_days: 7, trial_offer: offer,
});

const PERIOD_END = '2030-11-02T12:00:00.000Z';
const RENEWING_ROW = {
  id: 'purchase-1', package_id: 'pkg-monthly', status: 'active', entitlement_active: true,
  access_expires_at: '2030-11-03T12:00:00.000Z', current_period_end: PERIOD_END, cancel_at_period_end: false,
  canceled_at: null, created_at: '2030-10-02T12:00:00.000Z',
};
const ONE_TIME_ROW = {
  id: 'purchase-2', package_id: 'pkg-once', status: 'paid', entitlement_active: true,
  access_expires_at: '2030-12-01T12:00:00.000Z', current_period_end: null, cancel_at_period_end: false,
  canceled_at: null, created_at: '2030-10-02T12:00:00.000Z',
};
const livePlan = (over: Record<string, unknown> = {}) => ({
  purchase_id: 'purchase-1', package_id: 'pkg-monthly', package_name: 'Monthly coaching', state: 'active',
  entitlement_active: true, amount_cents: 4900, currency: 'usd', interval: 'month', interval_count: 1,
  next_charge_at: PERIOD_END, cancel_at_period_end: false, access_ends_at: null, can_cancel: true,
  can_resume: false, ...over,
});
const httpError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: {}, headers: {} },
    config: { headers: {} },
  });

let packages: unknown[] = [];
let purchases: unknown[] = [];
let plans: unknown[] | Error = [];
let packagesError: Error | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_build';
  packages = [MONTHLY];
  purchases = [];
  plans = [];
  packagesError = null;
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/v1/clients/me/coach') return { data: { name: 'Coach Lee' } };
    if (url === '/v1/clients/me/coach/packages') {
      if (packagesError) throw packagesError;
      return { data: { packages } };
    }
    if (url === '/v1/checkout/purchases') return { data: { purchases, next_cursor: null } };
    if (url === '/v1/checkout/subscriptions') {
      if (plans instanceof Error) throw plans;
      return { data: { plans } };
    }
    throw Object.assign(new Error('404'), { response: { status: 404, data: {} } });
  });
  mockPost.mockImplementation(async (url: string) => {
    throw new Error(`unexpected POST ${url}`);
  });
});
afterEach(() => jest.restoreAllMocks());

describe('B-1: the refund line is true and has its own support action', () => {
  it('says who issues refunds, never "through your coach", and opens a support email in one tap', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('plans-refund-support')).toBeTruthy());
    expect(
      r.getByText(/Refunds are issued by The Growth Project team; to ask for one, email support\./),
    ).toBeTruthy();
    expect(r.queryByText(/through your coach/)).toBeNull();
    expect(r.queryByText(/Settings > Support/)).toBeNull();
    await fireEvent.press(r.getByTestId('plans-refund-support'));
    expect(open).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Refund request')}`);
  });

  it('shows the address to copy when the phone cannot open an email app', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('plans-refund-support')).toBeTruthy());
    await fireEvent.press(r.getByTestId('plans-refund-support'));
    await waitFor(() =>
      expect(r.getByTestId('plans-refund-support-fallback-address').props.children).toBe(SUPPORT_EMAIL),
    );
  });
});

describe('U-3: a free trial shows only when this client would get it', () => {
  it('a trial the client already used with this coach is not advertised', async () => {
    packages = [trialPackage({ trial_days: 7, available: false, reason: 'already_used' })];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('buy-plan-pkg-trial')).toBeTruthy());
    expect(r.queryByText(/free trial/i)).toBeNull();
    expect(r.getByText('Subscribe for $49.00 a month')).toBeTruthy();
    expect(r.getByTestId('plan-terms-pkg-trial-first-charge').props.children).toBe(
      'You pay $49.00 today for your first month.',
    );
  });

  it('an offered trial is still shown', async () => {
    packages = [trialPackage({ trial_days: 7, available: true, reason: 'offered' })];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('buy-plan-pkg-trial')).toBeTruthy());
    expect(r.getByText('Start free trial')).toBeTruthy();
    expect(r.getByText('$49.00 a month, 7-day free trial')).toBeTruthy();
  });

  it('a trial no checkout honours yet is not advertised; rows without an offer keep the package trial', () => {
    expect(
      purchasableFromCoachPackage(trialPackage({ trial_days: 7, available: false, reason: 'not_offered_yet' }))
        ?.trialDays,
    ).toBe(0);
    expect(purchasableFromCoachPackage({ ...MONTHLY, trial_days: 7 })?.trialDays).toBe(7);
  });
});

describe('U-5: a failed list read is said in plain words', () => {
  it('never shows the transport text, and the banner retries', async () => {
    packagesError = httpError(500);
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('client-packages-error')).toBeTruthy());
    expect(
      r.getByText("Your coach's plans could not load. Check your connection, then tap to try again."),
    ).toBeTruthy();
    expect(r.queryByText(/status code/)).toBeNull();
    packagesError = null;
    await fireEvent.press(r.getByTestId('client-packages-error'));
    await waitFor(() => expect(r.getByTestId('buy-plan-pkg-monthly')).toBeTruthy());
  });
});

describe('U-7: one plan, one place', () => {
  it('a renewing plan shows once, in Your plans, with its included content there', async () => {
    purchases = [RENEWING_ROW];
    plans = [livePlan()];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('your-plan-purchase-1')).toBeTruthy());
    await waitFor(() => expect(r.queryByTestId('current-plan-card')).toBeNull());
    expect(r.queryByText('Current')).toBeNull();
    expect(r.getByTestId('your-plan-line-purchase-1').props.children).toBe(
      'Next charge of $49.00 a month on November 2, 2030.',
    );
    await fireEvent.press(r.getByTestId('view-deliverables-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Deliverables', {
      purchaseId: 'purchase-1', packageName: 'Monthly coaching',
    });
    // The catalog still marks the plan the client has and never sells it twice.
    expect(r.getByTestId('buy-plan-pkg-monthly').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('a one-time plan, which Your plans does not list, keeps its Current plan card', async () => {
    packages = [MONTHLY, ONCE];
    purchases = [ONE_TIME_ROW];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('current-plan-card')).toBeTruthy());
    expect(r.getByTestId('current-plan-line').props.children).toBe('Access until Dec 1, 2030');
    expect(r.queryByTestId('your-plans')).toBeNull();
    await fireEvent.press(r.getByTestId('view-deliverables-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Deliverables', {
      purchaseId: 'purchase-2', packageName: 'Six-week block',
    });
  });

  it('when Your plans cannot load, the Current plan card still shows the plan', async () => {
    purchases = [RENEWING_ROW];
    plans = httpError(503);
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('your-plans-failed')).toBeTruthy());
    await waitFor(() => expect(r.getByTestId('current-plan-card')).toBeTruthy());
    expect(r.getByTestId('current-plan-line').props.children).toBe('Renews Nov 2, 2030');
  });
});

describe('parity: every route and action on the plans screen stays reachable', () => {
  it('Back, Update card, End my plan, View what\'s included, buy and refund support', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    packages = [MONTHLY, QUARTERLY];
    purchases = [{ ...RENEWING_ROW, status: 'past_due' }];
    plans = [livePlan({ state: 'past_due', next_charge_at: null })];
    const r = await render(<ClientPackagesScreen />);
    await waitFor(() => expect(r.getByTestId('your-plan-update-card-purchase-1')).toBeTruthy());
    await fireEvent.press(r.getByTestId('client-packages-back'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await fireEvent.press(r.getByTestId('your-plan-update-card-purchase-1'));
    expect(mockNavigate).toHaveBeenCalledWith('UpdateCard', { autostart: true });
    expect(r.getByTestId('your-plan-end-purchase-1')).toBeTruthy();
    await fireEvent.press(r.getByTestId('view-deliverables-cta'));
    expect(mockNavigate).toHaveBeenCalledWith('Deliverables', {
      purchaseId: 'purchase-1', packageName: 'Monthly coaching',
    });
    await fireEvent.press(r.getByTestId('plans-refund-support'));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('subject=Refund%20request'));
    await fireEvent.press(r.getByTestId('buy-plan-pkg-quarterly'));
    await waitFor(() =>
      expect(mockPost.mock.calls.some((c) => c[0] === '/v1/checkout/subscription-intent')).toBe(true),
    );
  });
});
