/**
 * Owner decision: on iOS hide only purchases that are NOT 1:1
 * person-to-person services. Client 1:1 coach packages stay (3.1.3(d),
 * Stripe); coach AI credit packs and subscription/seat CTAs are hidden.
 */
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';

let mockHidden = true;
jest.mock('../config/purchaseSurfaces', () => {
  const actual = jest.requireActual('../config/purchaseSurfaces');
  return { ...actual, nonP2PPurchasesHidden: () => mockHidden, digitalPurchasesHidden: () => mockHidden };
});
const mockColors = new Proxy({}, { get: () => '#000000' });
jest.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ colors: mockColors, semanticColors: mockColors }) }));
jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({ colors: mockColors, tokens: jest.requireActual('../theme/tokens') }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import { withNonP2PPurchaseGate } from '../components/purchases/withNonP2PPurchaseGate';
import { PackOptionsRow } from '../components/coach/ai-budget/PackOptionsRow';
import AIBudgetBanner from '../components/coach/ai-budget/AIBudgetBanner';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const budget = { remaining_displayed_cents: 120, period_end: '2026-10-31T00:00:00Z' } as never;

describe('iOS non-P2P purchase hiding', () => {
  afterEach(() => {
    mockHidden = true;
  });

  it('credit-pack route renders the neutral state when hidden, the screen otherwise', async () => {
    const Screen = () => <Text>checkout</Text>;
    const Gated = withNonP2PPurchaseGate(Screen);
    const hidden = await render(<Gated />);
    expect(hidden.getByTestId('non-p2p-purchase-hidden')).toBeTruthy();
    expect(hidden.queryByText('checkout')).toBeNull();
    expect(hidden.queryByText(/\$|buy/i)).toBeNull();
    mockHidden = false;
    const shown = await render(<Gated />);
    expect(shown.getByText('checkout')).toBeTruthy();
  });

  it('PackOptionsRow (tutorial + hard-pause modals) renders nothing when hidden', async () => {
    const onSelect = jest.fn();
    const hidden = await render(<PackOptionsRow options={[1000, 2500]} onSelect={onSelect} />);
    expect(hidden.queryByTestId('ai-pack-options')).toBeNull();
    mockHidden = false;
    const shown = await render(<PackOptionsRow options={[1000, 2500]} onSelect={onSelect} />);
    expect(shown.getByTestId('ai-pack-option-1000')).toBeTruthy();
  });

  it('AI budget banner has no Buy credits CTA without a handler', async () => {
    const withoutCta = await render(<AIBudgetBanner budget={budget} />);
    expect(withoutCta.queryByTestId('ai-budget-banner-cta')).toBeNull();
    const withCta = await render(<AIBudgetBanner budget={budget} onBuyCredits={jest.fn()} />);
    expect(withCta.getByTestId('ai-budget-banner-cta')).toBeTruthy();
  });

  it('wiring: credit-pack route gated, meter/banner CTAs dropped, billing CTAs hidden', () => {
    expect(read('navigation/CoachNavigator.tsx')).toMatch(/component=\{GatedCreditPackCheckoutScreen\}/);
    const mount = read('components/coach/ai-budget/AIBudgetMount.tsx');
    expect(mount).toMatch(/onPress=\{purchasesHidden \? undefined :/);
    expect(mount).toMatch(/onBuyCredits=\{purchasesHidden \? undefined :/);
    const billing = read('screens/coach/CoachBillingScreen.tsx');
    expect(billing).toMatch(/\{purchasesHidden \? null : \(/);
    expect(billing).toMatch(/purchasesHidden \? IOS_BILLING_NOTE/);
  });

  it('1:1 client packages are NOT gated on iOS and name the individual coach', () => {
    const clientNav = read('navigation/ClientNavigator.tsx');
    expect(clientNav).toMatch(/name="ClientPackages"\s+component=\{ClientPackagesScreen\}/);
    expect(clientNav).not.toMatch(/withNonP2PPurchaseGate|withPurchaseSurfaceGate/);
    expect(read('screens/client/PackageCheckoutScreen.tsx')).toMatch(/oneToOneCoachingLabel\(pkg\?\.coach\?\.displayName\)/);
    expect(read('screens/client/ClientPackagesScreen.tsx')).toMatch(/oneToOneCoachingLabel\(coachName\)/);
    // Fix round #304 B1: the feature gates (ProtectedScreen / PaywallSheet)
    // DO consult the iOS gate, because they sit in front of app features and
    // must never sell a package "to unlock this feature" (3.1.1). The 1:1
    // coaching screen itself stays ungated (asserted above).
    expect(read('entitlements/ProtectedScreen.tsx')).toMatch(/nonP2PPurchasesHidden\(\)/);
    expect(read('entitlements/PaywallSheet.tsx')).toMatch(/nonP2PPurchasesHidden\(\)/);
  });
});
