/**
 * AUD-SOL-W4-124: ordinary plan actions must update the enclosing plans
 * screen, not just the Your plans panel. Real screen, API derivation,
 * panel, and action parsers; HTTP and native boundary doubles only.
 */
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('../theme/ThemeProvider', () => {
  const tokens = jest.requireActual('../theme/tokens').default;
  return { useTheme: () => ({ tokens, semanticColors: tokens.lightTokens, colorScheme: 'light' }) };
});
jest.mock('../ui/skeletons/Skeleton', () => ({ SkeletonScreen: () => null }));
jest.mock('@react-navigation/native', () => {
  const react = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: jest.fn(), canGoBack: () => false }),
    useFocusEffect: (cb: () => void) => react.useEffect(cb, []),
  };
});
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));
jest.mock('../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('@stripe/stripe-react-native', () => ({
  initStripe: jest.fn(async () => undefined),
  initPaymentSheet: jest.fn(async () => ({})),
  presentPaymentSheet: jest.fn(async () => ({})),
}));

import ClientPackagesScreen from '../screens/client/ClientPackagesScreen';

const END = '2026-11-02T12:00:00.000Z';
const PKG = {
  id: 'pkg-monthly', name: 'Monthly coaching', amount_cents: 4900,
  currency: 'usd', billing_type: 'recurring', interval: 'month',
  description: null, features: [],
};
let purchase: Record<string, unknown>;
let plan: Record<string, unknown>;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_build';
  purchase = {
    id: 'purchase-1', package_id: PKG.id, status: 'active',
    entitlement_active: true, access_expires_at: null,
    current_period_end: END, cancel_at_period_end: false,
    canceled_at: null, created_at: '2026-10-02T12:00:00.000Z',
  };
  plan = {
    purchase_id: 'purchase-1', package_id: PKG.id, package_name: PKG.name,
    state: 'active', status: 'active', entitlement_active: true,
    amount_cents: 4900, currency: 'usd', interval: 'month', interval_count: 1,
    current_period_end: END, next_charge_at: END, cancel_at_period_end: false,
    access_ends_at: null, can_cancel: true, can_resume: false,
  };
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/v1/clients/me/coach') return { data: { name: 'Coach Lee' } };
    if (url === '/v1/clients/me/coach/packages') return { data: [PKG] };
    if (url === '/v1/checkout/purchases') return { data: { purchases: [{ ...purchase }], next_cursor: null } };
    if (url === '/v1/checkout/subscriptions') return { data: { plans: [{ ...plan }] } };
    throw Object.assign(new Error('404'), { response: { status: 404, data: {} } });
  });
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    buttons?.find((button) => button.style === 'destructive')?.onPress?.();
  });
});

afterEach(() => jest.restoreAllMocks());

it('End my plan updates Current plan without requiring a manual refresh', async () => {
  mockPost.mockImplementation(async (url: string) => {
    if (url !== '/v1/checkout/subscriptions/purchase-1/cancel') throw new Error(url);
    purchase = { ...purchase, cancel_at_period_end: true };
    plan = { ...plan, cancel_at_period_end: true, access_ends_at: END, next_charge_at: null, can_cancel: false, can_resume: true };
    return { data: { outcome: 'scheduled', access_ends_at: END, voided_amount_cents: 0, currency: 'usd', paid_period_kept: false } };
  });
  const screen = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(screen.getByTestId('your-plan-end-purchase-1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('your-plan-end-purchase-1'));
  await waitFor(() => expect(screen.getByTestId('your-plan-line-purchase-1').props.children).toContain('will not renew'));
  expect(screen.getByTestId('current-plan-line').props.children).toBe('Ends Nov 2, 2026. Nothing more is charged.');
});

it('ending an overdue plan now immediately permits starting that ended plan again', async () => {
  purchase = { ...purchase, status: 'past_due' };
  plan = { ...plan, state: 'past_due', status: 'past_due' };
  mockPost.mockImplementation(async (url: string) => {
    if (url !== '/v1/checkout/subscriptions/purchase-1/cancel') throw new Error(url);
    purchase = { ...purchase, status: 'canceled', entitlement_active: false };
    plan = { ...plan, state: 'ended', status: 'canceled', entitlement_active: false, next_charge_at: null, can_cancel: false, can_resume: false };
    return { data: { outcome: 'ended', access_ends_at: null, voided_amount_cents: 4900, currency: 'usd', paid_period_kept: false } };
  });
  const screen = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(screen.getByTestId('your-plan-end-purchase-1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('your-plan-end-purchase-1'));
  await waitFor(() => expect(screen.getByTestId('your-plan-line-purchase-1').props.children).toContain('This plan has ended'));
  expect(screen.getByTestId('buy-plan-pkg-monthly').props.accessibilityState.disabled).toBe(false);
});

it('Keep my plan restores the renewal claim in Current plan immediately', async () => {
  purchase = { ...purchase, cancel_at_period_end: true };
  plan = { ...plan, cancel_at_period_end: true, next_charge_at: null, access_ends_at: END, can_cancel: false, can_resume: true };
  mockPost.mockImplementation(async (url: string) => {
    if (url !== '/v1/checkout/subscriptions/purchase-1/resume') throw new Error(url);
    purchase = { ...purchase, cancel_at_period_end: false };
    plan = { ...plan, cancel_at_period_end: false, next_charge_at: END, access_ends_at: null, can_cancel: true, can_resume: false };
    return { data: { ...plan } };
  });
  const screen = await render(<ClientPackagesScreen />);
  await waitFor(() => expect(screen.getByTestId('your-plan-keep-purchase-1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('your-plan-keep-purchase-1'));
  await waitFor(() => expect(screen.getByTestId('your-plan-line-purchase-1').props.children).toContain('Next charge'));
  expect(screen.getByTestId('current-plan-line').props.children).toBe('Renews Nov 2, 2026');
});
