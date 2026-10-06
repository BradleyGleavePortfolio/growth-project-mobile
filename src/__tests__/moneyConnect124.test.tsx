import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import api from '../services/api';
import { adaptPublicPackage, coachPackagesApi, fromBackend, toBackendCreate } from '../api/packagesApi';
import CoachConnectScreen from '../screens/coach/payments/CoachConnectScreen';
import CoachPackageSubscribersScreen from '../screens/coach/payments/CoachPackageSubscribersScreen';
import CoachPackageEditScreen from '../screens/coach/payments/CoachPackageEditScreen';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../theme/tokens').default;
  return { useTheme: () => ({
    colors: jest.requireActual('../constants/colors').default,
    tokens, semanticColors: tokens.lightTokens, colorScheme: 'light',
  }) };
});
jest.mock('expo-font', () => ({ isLoaded: () => true }));
jest.mock('../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../utils/haptics', () => ({
  lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), successTap: jest.fn(),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-1', email: 'coach@example.com', name: 'Coach' }),
}));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../services/authActions', () => ({ signOut: jest.fn() }));
const mockOpenAuth = jest.fn();
const mockOpenBrowser = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuth(...args),
  openBrowserAsync: (...args: unknown[]) => mockOpenBrowser(...args),
  dismissAuthSession: jest.fn(),
  WebBrowserPresentationStyle: { PAGE_SHEET: 'pageSheet' },
}));

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const nav = { navigate: jest.fn(), goBack: jest.fn(), dispatch: jest.fn() } as never;
const RAW_STATUS = {
  configured: true, account_id: 'acct_1', state: 'active',
  charges_enabled: true, payouts_enabled: true, details_submitted: true,
  action_required: true, disabled_reason: null,
  requirements: { currently_due: ['external_account'], past_due: [],
    eventually_due: [], pending_verification: [], current_deadline: null },
};
const RAW_PACKAGE = {
  id: 'pkg-49', coach_id: 'coach-1', name: 'Coaching', description: 'Weekly check-in',
  amount_cents: 4900, currency: 'gbp', billing_type: 'recurring', interval: 'month',
  interval_count: 1, is_active: true, published_at: '2026-10-01T12:00:00Z',
  subscriber_count: 1, monthly_revenue_cents: 4900,
};
const RAW_BUYER = {
  id: 'purchase-1', client_user_id: 'client-1', package_id: 'pkg-49',
  client: { name: 'Sam', email: 'sam@example.com' },
  amount_cents: 4900, currency: 'gbp', billing_type: 'recurring',
  status: 'active', entitlement_active: true, cancel_at_period_end: false,
  current_period_end: '2026-11-01T12:00:00Z', created_at: '2026-10-01T12:00:00Z', source: null,
};
function page(over = {}, buyer = {}) {
  return {
    package_id: 'pkg-49', currency: 'gbp', subscriber_count: 1,
    monthly_revenue_cents: 4900, next_offset: null,
    subscribers: [{ ...RAW_BUYER, ...buyer }], ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  get.mockImplementation(async (url: string) => {
    if (url === '/coach/connect/status') return { data: RAW_STATUS };
    if (url === '/v1/connect/accounts/me') return { data: {
      connected: true, ...RAW_STATUS, stripe_account_id: 'acct_1',
      is_fully_onboarded: true, requirements_due: RAW_STATUS.requirements,
    } };
    if (url.endsWith('/subscribers')) return { data: page() };
    if (url === '/v1/coach/packages') return { data: { packages: [RAW_PACKAGE] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  post.mockImplementation(async (url: string) => {
    if (url.endsWith('/onboarding-link')) return { data: {
      url: 'https://connect.stripe.com/setup/c/test',
      expires_at: '2026-10-01T12:30:00Z',
    } };
    if (url.endsWith('/status/refresh')) return { data: { ...RAW_STATUS, refreshed: true } };
    throw new Error(`Unexpected POST ${url}`);
  });
  mockOpenAuth.mockResolvedValue({ type: 'success', url: 'tgp://connect/onboarding/return' });
  mockOpenBrowser.mockResolvedValue({ type: 'dismiss' });
});

describe('MONEY-CONNECT-124 normal coach money flows', () => {
  it('B-CONNECT-1: active payouts still show currently-due requirements and a fix action', async () => {
    const r = await render(<CoachConnectScreen navigation={nav} />);
    await r.findByText('Stripe needs an update from you');
    expect(r.getByText('Update details with Stripe')).toBeTruthy();
    expect(r.getByText(/Bank account for payouts/)).toBeTruthy();
    expect(r.queryByText('Identity verified')).toBeNull();
  });

  it('B-CONNECT-2: hosted onboarding returns to the app and re-reads Stripe', async () => {
    const r = await render(<CoachConnectScreen navigation={nav} />);
    await r.findByText('Update details with Stripe');
    await fireEvent.press(r.getByLabelText('Update details with Stripe'));
    await waitFor(() => expect(mockOpenAuth).toHaveBeenCalledWith(
      'https://connect.stripe.com/setup/c/test', 'tgp://connect/onboarding',
    ));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/coach/connect/status/refresh'));
    expect(mockOpenBrowser).not.toHaveBeenCalled();
  });

  it.each(['paid', 'granted', 'expired', 'payment_failed', 'pending', 'revoked'])(
    'B-PACKAGE-2: actual purchase state %s renders without a crash or invented paid total',
    async (status) => {
      get.mockResolvedValue({ data: page({}, { status }) });
      const r = await render(<CoachPackageSubscribersScreen navigation={nav}
        route={{ params: { packageId: 'pkg-49', title: 'Coaching' } } as never} />);
      await r.findByText('Sam');
      expect(r.queryByText('Total paid')).toBeNull();
      expect(r.getAllByText(/£49\.00/).length).toBeGreaterThan(0);
      expect(r.queryByText('$49.00')).toBeNull();
    },
  );

  it('B-PACKAGE-2: the adapter names the actual purchase terms, currency and renewal', async () => {
    const result = await coachPackagesApi.subscribers('pkg-49');
    expect(result.data.subscribers[0]).toMatchObject({
      userId: 'client-1', name: 'Sam', amountCents: 4900, currency: 'gbp',
      nextRenewalAt: '2026-11-01T12:00:00Z',
    });
    expect(result.data).toMatchObject({
      totalActive: 1, monthlyRecurringRevenueCents: 4900, currency: 'gbp',
    });
  });

  it('B-PACKAGE-3: a quarterly package is one quarter, and roundtrips to three months', () => {
    const pkg = fromBackend({ ...RAW_PACKAGE, interval_count: 3 });
    expect(pkg.billingInterval).toBe('quarterly');
    expect(pkg.intervalCount).toBe(1);
    expect(toBackendCreate({
      title: pkg.title, priceCents: pkg.priceCents, currency: pkg.currency,
      billingInterval: pkg.billingInterval, intervalCount: pkg.intervalCount,
    })).toMatchObject({ amount_cents: 4900, billing_interval: 'month', billing_interval_count: 3 });
    expect(fromBackend({ ...RAW_PACKAGE, interval_count: 4 })).toMatchObject({
      billingInterval: 'monthly', intervalCount: 4,
    });
    expect(adaptPublicPackage({ billing_cycle: 'quarterly' })).toMatchObject({
      billingInterval: 'quarterly', intervalCount: 1,
    });
  });

  it('B-PACKAGE-4: editing a GBP package labels its existing currency honestly', async () => {
    const original = fromBackend(RAW_PACKAGE);
    const r = await render(<CoachPackageEditScreen navigation={nav}
      route={{ params: { packageId: original.id, initialPackage: original } } as never} />);
    expect(r.getByText('Price (GBP)')).toBeTruthy();
    expect(r.queryByText('Price (USD)')).toBeNull();
  });

  it('U-PACKAGE-1: the management catalog requests archived packages', async () => {
    await coachPackagesApi.list();
    expect(get).toHaveBeenCalledWith('/v1/coach/packages', { params: { include_archived: true } });
  });
});
