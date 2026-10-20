/**
 * OR-113-2: Apple Pay and Google Pay in the PaymentSheet are off by config —
 * no wallet, no error, no dead button — until a merchant ID / switch exists.
 * Also checks app.config.js adds the Stripe config plugin only then.
 * Failing before: src/config/wallets.ts did not exist and app.config.js had
 * no wallet plugin logic.
 */
import * as path from 'path';
import { resolveWalletConfig } from '../wallets';

const NAMES = [
  'EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER',
  'EXPO_PUBLIC_GOOGLE_PAY_ENABLED',
  'EXPO_PUBLIC_STRIPE_MERCHANT_COUNTRY',
] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => NAMES.forEach((n) => (saved[n] = process.env[n])));
afterAll(() =>
  NAMES.forEach((n) => {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }),
);
beforeEach(() => NAMES.forEach((n) => delete process.env[n]));

const base = { currency: 'usd', publishableKey: 'pk_test_x' };

describe('resolveWalletConfig', () => {
  it('everything off when nothing is configured, on both platforms', () => {
    expect(resolveWalletConfig({ ...base, os: 'ios' })).toEqual({});
    expect(resolveWalletConfig({ ...base, os: 'android' })).toEqual({});
  });

  it('Apple Pay needs a valid merchant.* ID and iOS', () => {
    process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER = 'not-a-merchant-id';
    expect(resolveWalletConfig({ ...base, os: 'ios' })).toEqual({});
    process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER = 'merchant.com.example.tgp';
    expect(resolveWalletConfig({ ...base, os: 'ios' })).toEqual({
      merchantIdentifier: 'merchant.com.example.tgp',
      applePay: { merchantCountryCode: 'US' },
    });
    expect(resolveWalletConfig({ ...base, os: 'android' })).toEqual({});
  });

  it('Google Pay needs the switch and Android; test keys use the test environment', () => {
    process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED = '0';
    expect(resolveWalletConfig({ ...base, os: 'android' })).toEqual({});
    process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED = 'true';
    process.env.EXPO_PUBLIC_STRIPE_MERCHANT_COUNTRY = 'gb';
    expect(resolveWalletConfig({ ...base, os: 'android' })).toEqual({
      googlePay: { merchantCountryCode: 'GB', currencyCode: 'USD', testEnv: true },
    });
    expect(
      resolveWalletConfig({ currency: 'eur', publishableKey: 'pk_live_x', os: 'android' }).googlePay,
    ).toEqual({ merchantCountryCode: 'GB', currencyCode: 'EUR', testEnv: false });
    expect(resolveWalletConfig({ ...base, os: 'ios' })).toEqual({});
  });
});

describe('app.config.js Stripe wallet plugin', () => {
  function plugins(): unknown[] {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const factory = require('../../../app.config.js');
    return (factory({}).plugins ?? []) as unknown[];
  }
  const stripeEntry = (list: unknown[]) =>
    list.find((p) => (Array.isArray(p) ? p[0] : p) === '@stripe/stripe-react-native');

  it('absent without a merchant ID or the Google Pay switch', () => {
    expect(stripeEntry(plugins())).toBeUndefined();
  });

  it('present with the merchant ID entitlement when configured', () => {
    process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER = 'merchant.com.example.tgp';
    expect(stripeEntry(plugins())).toEqual([
      '@stripe/stripe-react-native',
      { merchantIdentifier: 'merchant.com.example.tgp', enableGooglePay: false },
    ]);
  });

  it('Google Pay only', () => {
    process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED = '1';
    expect(stripeEntry(plugins())).toEqual(['@stripe/stripe-react-native', { enableGooglePay: true }]);
  });

  // APPLE-PAY-ID: eas.json build.production.env carries the registered Apple merchant ID, so the
  // production profile and every profile that extends it (testing and the store builds) get the
  // Apple Pay entitlement and the PaymentSheet Apple Pay option. Failing before: no profile set it.
  describe('eas.json profiles built from production', () => {
    const MERCHANT = 'merchant.com.growthproject.app';
    const { loadEas, resolveProfile } = require('../../../scripts/eas-profile.js');
    const eas = loadEas(path.join(__dirname, '..', '..', '..'));
    const fromProduction = (name: string): boolean =>
      name === 'production' || (!!eas.build[name].extends && fromProduction(eas.build[name].extends));
    const names = Object.keys(eas.build);
    const built = names.filter(fromProduction);
    const useEnv = (name: string) => {
      const env = resolveProfile(eas, name).env as Record<string, string | undefined>;
      for (const n of NAMES) {
        if (env[n] === undefined) delete process.env[n];
        else process.env[n] = env[n];
      }
    };

    it('production, testing and both store builds set the registered merchant ID', () => {
      expect(built).toEqual(expect.arrayContaining(['production', 'testing']));
      expect(built).toHaveLength(4);
      for (const name of built) {
        const value = resolveProfile(eas, name).env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER;
        expect(value).toMatch(/^merchant\.[A-Za-z0-9.-]+$/);
        expect(value).toBe(MERCHANT);
      }
    });

    it('their env adds the Apple Pay entitlement and offers Apple Pay on iOS only', () => {
      for (const name of built) {
        useEnv(name);
        expect(stripeEntry(plugins())).toEqual([
          '@stripe/stripe-react-native',
          { merchantIdentifier: MERCHANT, enableGooglePay: false },
        ]);
        const live = { currency: 'usd', publishableKey: 'pk_live_x' };
        expect(resolveWalletConfig({ ...live, os: 'ios' })).toEqual({
          merchantIdentifier: MERCHANT,
          applePay: { merchantCountryCode: 'US' },
        });
        expect(resolveWalletConfig({ ...live, os: 'android' })).toEqual({});
      }
    });

    it('development and preview stay without it (no plugin, as before)', () => {
      expect(names.filter((n) => !fromProduction(n)).sort()).toEqual(['development', 'preview']);
      for (const name of ['development', 'preview']) {
        useEnv(name);
        expect(stripeEntry(plugins())).toBeUndefined();
      }
    });
  });
});
