/**
 * App Review 3.1 removal: with purchases hidden (iOS + flag), an inactive
 * client sees the neutral invite-code state, never "View Plans"/checkout.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as fs from 'fs';
import * as path from 'path';

const mockHidden = jest.fn(() => true);
jest.mock('../config/purchaseSurfaces', () => ({
  ...jest.requireActual('../config/purchaseSurfaces'),
  clientPurchasesHidden: () => mockHidden(),
}));
const mockAttach = jest.fn();
jest.mock('../services/api', () => ({ authApi: { attachInviteCode: (c: string) => mockAttach(c) } }));
jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    tokens: { typography: { h2: { fontSize: 24 }, body: { fontSize: 16 }, bodyMd: { fontSize: 16 } } },
  }),
}));

import { ProtectedScreen } from '../entitlements/ProtectedScreen';
import * as Provider from '../entitlements/EntitlementProvider';
import { withPurchaseSurfaceGate } from '../entitlements/withPurchaseSurfaceGate';

type Ctx = ReturnType<typeof Provider.useEntitlement>;
function mockEntitlement(ctx: Partial<Ctx>) {
  const value: Ctx = {
    entitlementActive: null, checking: false, status: 'unknown',
    refreshEntitlement: jest.fn(async () => true), openPlans: jest.fn(),
    paywallVisible: false, paywallMessage: null, dismissPaywall: jest.fn(), ...ctx,
  };
  jest.spyOn(Provider, 'useEntitlement').mockReturnValue(value);
  return value;
}
const Child = () => <Text testID="paid-content">Paid</Text>;

afterEach(() => {
  jest.restoreAllMocks();
  mockHidden.mockReturnValue(true);
  mockAttach.mockReset();
});

describe('ProtectedScreen with purchases hidden', () => {
  it('inactive client sees the neutral invite-code state, not View Plans', async () => {
    mockEntitlement({ status: 'inactive', entitlementActive: false });
    const { getByText, queryByTestId, getByTestId } = await render(<ProtectedScreen><Child /></ProtectedScreen>);
    expect(getByTestId('neutral-access-state')).toBeTruthy();
    expect(getByText('Ask your coach for an invite code')).toBeTruthy();
    expect(queryByTestId('protected-screen-view-plans')).toBeNull();
    expect(queryByTestId('paid-content')).toBeNull();
  });

  it('a valid code attaches and re-checks the entitlement', async () => {
    const ctx = mockEntitlement({ status: 'inactive', entitlementActive: false });
    mockAttach.mockResolvedValue({ data: { ok: true } });
    const { getByTestId } = await render(<ProtectedScreen><Child /></ProtectedScreen>);
    await fireEvent.changeText(getByTestId('neutral-access-code-input'), 'gp-pnw1');
    await fireEvent.press(getByTestId('neutral-access-submit'));
    await waitFor(() => expect(mockAttach).toHaveBeenCalledWith('GP-PNW1'));
    await waitFor(() => expect(ctx.refreshEntitlement).toHaveBeenCalled());
  });

  it('a bad code shows calm copy (no raw server text)', async () => {
    mockEntitlement({ status: 'inactive', entitlementActive: false });
    mockAttach.mockRejectedValue({ response: { status: 400, data: { message: 'P2002 unique constraint' } } });
    const { getByTestId, findByText, queryByText } = await render(<ProtectedScreen><Child /></ProtectedScreen>);
    await fireEvent.changeText(getByTestId('neutral-access-code-input'), 'GP-BAD1');
    await fireEvent.press(getByTestId('neutral-access-submit'));
    expect(await findByText(/That code did not work/)).toBeTruthy();
    expect(queryByText(/P2002/)).toBeNull();
  });

  it('active (comp) client sees the content', async () => {
    mockEntitlement({ status: 'active', entitlementActive: true });
    const { getByTestId } = await render(<ProtectedScreen><Child /></ProtectedScreen>);
    expect(getByTestId('paid-content')).toBeTruthy();
  });

  it('with purchases visible, the legacy View Plans paywall is unchanged', async () => {
    mockHidden.mockReturnValue(false);
    mockEntitlement({ status: 'inactive', entitlementActive: false });
    const { getByTestId, queryByTestId } = await render(<ProtectedScreen><Child /></ProtectedScreen>);
    expect(getByTestId('protected-screen-view-plans')).toBeTruthy();
    expect(queryByTestId('neutral-access-state')).toBeNull();
  });
});

describe('withPurchaseSurfaceGate', () => {
  const Checkout = () => <Text testID="checkout-body">Checkout</Text>;
  const Gated = withPurchaseSurfaceGate(Checkout);

  it('replaces checkout screens with the neutral state when hidden', async () => {
    mockEntitlement({ status: 'inactive', entitlementActive: false });
    const { queryByTestId, getByTestId } = await render(<Gated />);
    expect(getByTestId('purchase-surface-hidden')).toBeTruthy();
    expect(queryByTestId('checkout-body')).toBeNull();
  });

  it('renders the real screen when purchases are visible', async () => {
    mockHidden.mockReturnValue(false);
    mockEntitlement({ status: 'inactive', entitlementActive: false });
    const { getByTestId } = await render(<Gated />);
    expect(getByTestId('checkout-body')).toBeTruthy();
  });
});

describe('every client purchase entry point consults the gate (source guard)', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  it('ClientNavigator wraps ClientPackages, PackageCheckout and BrandedCheckoutWebView', () => {
    const src = read('navigation/ClientNavigator.tsx');
    expect(src).toMatch(/component=\{GatedClientPackagesScreen\}/);
    expect(src).toMatch(/component=\{GatedPackageCheckoutScreen\}/);
    expect(src).toMatch(/component=\{GatedBrandedCheckoutWebViewScreen\}/);
  });
  it('EntitlementProvider swaps PaywallSheet for NeutralAccessSheet and never opens plans', () => {
    const src = read('entitlements/EntitlementProvider.tsx');
    expect(src).toMatch(/clientPurchasesHidden\(\) \? \(\s*\/\/[^\n]*\n\s*<NeutralAccessSheet/);
    expect(src).toMatch(/if \(onOpenPlans && !clientPurchasesHidden\(\)\) onOpenPlans\(\)/);
  });
  it('Day1Win and the 24h package_prompt use shouldOfferPackagePrompt', () => {
    expect(read('screens/client/Day1WinScreen.tsx')).toMatch(/if \(!\(await shouldOfferPackagePrompt\(\)\)\)/);
    expect(read('navigation/RootNavigator.tsx')).toMatch(/elapsed > TWENTY_FOUR_HOURS && \(await shouldOfferPackagePrompt\(\)\)/);
  });
  it('Membership hides the View coaching plans button', () => {
    expect(read('screens/client/MembershipScreen.tsx')).toMatch(/\{purchasesHidden \? null : \(/);
  });
});
