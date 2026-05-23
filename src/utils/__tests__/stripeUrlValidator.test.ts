// Behavioral test for the REAL Stripe URL allow-list guard.
// No mocks here — we are proving the actual production validator
// accepts every legitimate Stripe payment-flow host (invoice, portal,
// checkout, Connect dashboard) and rejects everything else.

import { validateStripeUrl, assertStripeUrl } from '../stripeUrlValidator';

describe('stripeUrlValidator (real)', () => {
  describe('validateStripeUrl', () => {
    it.each([
      'https://checkout.stripe.com/c/pay/cs_test_abc',
      'https://connect.stripe.com/setup/c/acct_123',
      'https://dashboard.stripe.com/connect/accounts/acct_123',
      'https://billing.stripe.com/p/session/test_abc',
      'https://invoice.stripe.com/i/abc123',
      'https://pay.stripe.com/invoice/abc',
      'https://files.stripe.com/files/abc',
    ])('accepts legitimate Stripe payment URL: %s', (url) => {
      // files.stripe.com is a subdomain of stripe.com — but our allow-list
      // is hostname-only, so it should be REJECTED. Toggle assertion based
      // on whether the host is in the allow-list.
      const allowed = [
        'checkout.stripe.com',
        'connect.stripe.com',
        'dashboard.stripe.com',
        'billing.stripe.com',
        'invoice.stripe.com',
        'pay.stripe.com',
      ];
      const host = new URL(url).hostname;
      const expected = allowed.includes(host);
      expect(validateStripeUrl(url)).toBe(expected);
    });

    it('rejects malicious lookalike URLs', () => {
      expect(validateStripeUrl('https://stripe.com.evil.test/x')).toBe(false);
      expect(validateStripeUrl('https://evil.test/stripe.com')).toBe(false);
      expect(validateStripeUrl('https://billing-stripe.com/x')).toBe(false);
    });

    it('rejects non-HTTPS schemes even on allow-listed hosts', () => {
      expect(validateStripeUrl('http://billing.stripe.com/p/x')).toBe(false);
      expect(validateStripeUrl('javascript:alert(1)')).toBe(false);
    });

    it('rejects malformed input', () => {
      expect(validateStripeUrl('')).toBe(false);
      expect(validateStripeUrl('not a url')).toBe(false);
      // Defensive: validator accepts only strings.
      expect(validateStripeUrl(null as unknown as string)).toBe(false);
      expect(validateStripeUrl(undefined as unknown as string)).toBe(false);
    });
  });

  describe('assertStripeUrl', () => {
    it('does not throw for valid invoice URL (production regression guard)', () => {
      expect(() =>
        assertStripeUrl('https://invoice.stripe.com/i/abc', 'test'),
      ).not.toThrow();
    });

    it('does not throw for valid portal/checkout/connect URLs', () => {
      expect(() =>
        assertStripeUrl('https://billing.stripe.com/p/session/abc', 'test'),
      ).not.toThrow();
      expect(() =>
        assertStripeUrl('https://checkout.stripe.com/c/pay/cs_test_abc', 'test'),
      ).not.toThrow();
      expect(() =>
        assertStripeUrl('https://dashboard.stripe.com/connect/accounts/acct_123', 'test'),
      ).not.toThrow();
      expect(() =>
        assertStripeUrl('https://pay.stripe.com/invoice/abc', 'test'),
      ).not.toThrow();
    });

    it('throws STRIPE_URL_REJECTED for a malicious URL', () => {
      expect(() =>
        assertStripeUrl('https://evil.example.com/phish', 'test'),
      ).toThrow('STRIPE_URL_REJECTED');
    });
  });
});
