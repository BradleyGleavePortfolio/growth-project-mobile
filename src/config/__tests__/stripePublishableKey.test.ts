/**
 * S-ENVTRUTH — the package checkout reads the Stripe publishable key from the
 * name EAS actually stores (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY), with the
 * legacy EXPO_PUBLIC_STRIPE_PK as a fallback.
 */
import * as fs from 'fs';
import * as path from 'path';

import { resolveStripePublishableKey } from '../stripe';

const KEYS = ['EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_STRIPE_PK'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveStripePublishableKey', () => {
  it('prefers EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_canonical_value';
    process.env.EXPO_PUBLIC_STRIPE_PK = 'pk_legacy_value';
    expect(resolveStripePublishableKey()).toBe('pk_canonical_value');
  });

  it('falls back to EXPO_PUBLIC_STRIPE_PK when the canonical name is unset or blank', () => {
    process.env.EXPO_PUBLIC_STRIPE_PK = 'pk_legacy_value';
    expect(resolveStripePublishableKey()).toBe('pk_legacy_value');
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = '   ';
    expect(resolveStripePublishableKey()).toBe('pk_legacy_value');
  });

  it('returns empty (caller fails closed) when neither is set', () => {
    expect(resolveStripePublishableKey()).toBe('');
  });

  it('reads both names as literal process.env members (inlined into release bundles)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'stripe.ts'), 'utf8');
    expect(src).toContain('process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY');
    expect(src).toContain('process.env.EXPO_PUBLIC_STRIPE_PK');
    expect(src).not.toMatch(/process\.env\[/);
  });

  it('the shared purchase flow uses the resolver; no sell surface reads EXPO_PUBLIC_STRIPE_PK directly', () => {
    const read = (...rel: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...rel), 'utf8');
    // B-RECUR-MOB: the PaymentSheet is initialised in one place for every surface.
    expect(read('hooks', 'usePackagePurchase.ts')).toContain('resolveStripePublishableKey()');
    for (const rel of [
      ['components', 'PackageSelectionSheet.tsx'],
      ['hooks', 'usePackagePurchase.ts'],
      ['screens', 'client', 'ClientPackagesScreen.tsx'],
      ['screens', 'client', 'PackageCheckoutScreen.tsx'],
    ]) {
      expect(read(...rel)).not.toMatch(/process\.env\.EXPO_PUBLIC_STRIPE_PK/);
    }
    expect(read('components', 'PackageSelectionSheet.tsx')).toContain('usePackagePurchase(');
  });
});
