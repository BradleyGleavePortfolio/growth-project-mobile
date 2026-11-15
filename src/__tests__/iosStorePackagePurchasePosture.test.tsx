/**
 * Store package review P0 "iOS purchase posture" (operator 2026-09-30):
 *   - AI credit top-ups are not purchasable in the iOS app unless the build
 *     has the US external link: the checkout route is wrapped by the non-P2P
 *     gate and its hidden state says packs are not sold in this version of
 *     the app, with no link, URL or steering (there is no web checkout).
 *   - Client package purchase on iOS is real-world 1:1 coaching sold by the
 *     coach, only on the clearly labelled coaching screen, and nothing in
 *     the purchase flow presents it as unlocking app features or access.
 *   - ios.supportsTablet is false; ios.buildNumber >= the native anchor.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('../theme/useTheme', () => ({
  useTheme: () => ({
    colors: { background: '#F5EFE4', textPrimary: '#1A1A18', textSecondary: '#6B6B6B' },
    tokens: { typography: { h2: { fontSize: 24 }, body: { fontSize: 16 } } },
  }),
}));

import NonP2PPurchaseHidden from '../components/purchases/NonP2PPurchaseHidden';
import { IOS_P2P_ONLY_MIN_NATIVE_BUILD, NON_P2P_HIDDEN_BODY, NON_P2P_HIDDEN_TITLE } from '../config/purchaseSurfaces';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('AI credit top-ups on iOS', () => {
  it('the hidden state says packs are not sold here, with no web claim, link, URL or call to buy', async () => {
    expect(NON_P2P_HIDDEN_TITLE).toBe('Not available in this app');
    const r = await render(<NonP2PPurchaseHidden />);
    expect(r.getByText('Not available in this app')).toBeTruthy();
    expect(r.getByText(/AI credit packs are not sold in this version of the app/)).toBeTruthy();
    expect(r.queryByRole('link')).toBeNull();
    expect(r.queryByRole('button')).toBeNull();
    for (const s of [NON_P2P_HIDDEN_TITLE, NON_P2P_HIDDEN_BODY]) {
      expect(s).not.toMatch(/https?:|www\.|\.com|visit|go to|buy|purchase|top up|price|\$|on the web|website/i);
    }
  });

  it('the CreditPackCheckout route is registered only through the non-P2P gate', () => {
    const nav = read('src/navigation/CoachNavigator.tsx');
    expect(nav).toMatch(/GatedCreditPackCheckoutScreen = withNonP2PPurchaseGate\(CreditPackCheckoutScreen, creditPacksHidden\)/);
    expect(nav).toMatch(/name="CreditPackCheckout"\s+component=\{GatedCreditPackCheckoutScreen\}/);
    expect(stripComments(nav)).not.toMatch(/component=\{CreditPackCheckoutScreen\}/);
  });
});

describe('client 1:1 coaching purchase on iOS', () => {
  it('the purchase screens are labelled as 1:1 coaching with the coach', () => {
    expect(read('src/screens/client/ClientPackagesScreen.tsx')).toMatch(/oneToOneCoachingLabel\(coachName\)/);
    expect(read('src/screens/client/PackageCheckoutScreen.tsx')).toMatch(/oneToOneCoachingLabel\(/);
  });

  it.each([
    'src/screens/client/ClientPackagesScreen.tsx',
    'src/screens/client/PackageCheckoutScreen.tsx',
    'src/screens/client/CheckoutReturnScreen.tsx',
    'src/screens/client/PurchaseUnpackScreen.tsx',
  ])('%s has no copy that frames the purchase as unlocking app features or access', (rel) => {
    const code = stripComments(read(rel));
    // User-visible string literals and JSX text only.
    const strings = [
      ...(code.match(/'[^'\n]{6,}'/g) ?? []),
      ...(code.match(/"[^"\n]{6,}"/g) ?? []),
      ...(code.match(/`[^`]{6,}`/g) ?? []),
      ...(code.match(/>[^<>{}\n]*[A-Za-z]{3,}[^<>{}\n]*</g) ?? []),
    ].join('\n');
    expect(strings).not.toMatch(/unlock|refresh your access|access opens|access activates|unlock this feature|premium|coming soon/i);
  });

  it('the feature gate never routes to package purchase on hidden iOS (PaywallSheet / ProtectedScreen)', () => {
    expect(read('src/entitlements/PaywallSheet.tsx')).toMatch(/if \(hidden\) \{\s*return \(\s*<CoachManagedAccessSheet/);
    expect(read('src/entitlements/ProtectedScreen.tsx')).toMatch(/entitlementActive !== true && \(nonP2PPurchasesHidden\(\) \|\| noCoach\)/);
  });
});

describe('app.json iOS release config', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = require('../../app.json');
  it('is iPhone-only (no iPad screenshot or iPad review requirement)', () => {
    expect(app.expo.ios.supportsTablet).toBe(false);
  });
  it('build number is at least the native purchase anchor', () => {
    expect(parseInt(app.expo.ios.buildNumber, 10)).toBeGreaterThanOrEqual(IOS_P2P_ONLY_MIN_NATIVE_BUILD);
  });
});
