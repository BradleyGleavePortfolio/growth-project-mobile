/**
 * coachAiBudgetApi — wire-contract tests against the backend DTO.
 *
 * The backend's `CreditPackCheckoutRequestDto` requires a `tier` field
 * from `{small, medium, large, custom}` and an optional `amount_cents`
 * in [1000, 50000]. The mobile UI speaks in cents end-to-end; the cents
 * → tier mapping lives in `tierForCents` / `buildCheckoutInput`. These
 * tests pin that mapping so a future tier-table change cannot silently
 * fall back to 'custom' (which would bypass the locked-tier price pin
 * the backend applies in `CoachAiCreditPackService.resolveTier`).
 *
 * Audit reference: STREAM_1_MOBILE_AUDIT_1779954976.md P0-1.
 */

import {
  buildCheckoutInput,
  centsForLockedTier,
  tierForCents,
  type CreditPackTier,
} from '../coachAiBudgetApi';

describe('coachAiBudgetApi — wire contract for /coach/ai/credit-packs/checkout', () => {
  describe('tierForCents — locked tier mapping', () => {
    it.each([
      [1000, 'small'],
      [2500, 'medium'],
      [9900, 'large'],
    ] as Array<[number, CreditPackTier]>)(
      'maps %i cents → %s',
      (cents, expected) => {
        expect(tierForCents(cents)).toBe(expected);
      },
    );

    it('routes any non-locked amount to "custom"', () => {
      expect(tierForCents(1500)).toBe('custom');
      expect(tierForCents(5000)).toBe('custom');
      expect(tierForCents(50_000)).toBe('custom');
      expect(tierForCents(1)).toBe('custom'); // bounds checking is server-side
    });
  });

  describe('centsForLockedTier — inverse mapping', () => {
    it.each([
      ['small', 1000],
      ['medium', 2500],
      ['large', 9900],
    ] as Array<[CreditPackTier, number]>)('inverts %s → %i cents', (tier, expected) => {
      expect(centsForLockedTier(tier)).toBe(expected);
    });

    it('returns null for custom (cents is open-ended)', () => {
      expect(centsForLockedTier('custom')).toBeNull();
    });
  });

  describe('buildCheckoutInput — request body shape', () => {
    // Mirror the backend `class-validator` rules from
    // `src/ai-credits/credit-pack-checkout.dto.ts`:
    //   @IsIn(['small','medium','large','custom']) tier!
    //   @IsOptional() @IsInt() @Min(1000) @Max(50000) amount_cents?
    const VALID_TIERS: ReadonlyArray<CreditPackTier> = [
      'small',
      'medium',
      'large',
      'custom',
    ];

    it.each([
      [1000, 'small'],
      [2500, 'medium'],
      [9900, 'large'],
    ] as Array<[number, CreditPackTier]>)(
      'locked tier $%i body carries tier=%s',
      (cents, tier) => {
        const body = buildCheckoutInput(cents);
        expect(body.tier).toBe(tier);
        expect(VALID_TIERS).toContain(body.tier);
        expect(body.amount_cents).toBe(cents);
      },
    );

    it('custom amount $50 body carries tier=custom + amount_cents=5000', () => {
      const body = buildCheckoutInput(5000);
      expect(body.tier).toBe('custom');
      expect(body.amount_cents).toBe(5000);
    });

    it('custom amount $25.50 body carries tier=custom + amount_cents=2550', () => {
      const body = buildCheckoutInput(2550);
      expect(body.tier).toBe('custom');
      expect(body.amount_cents).toBe(2550);
    });

    it('custom amount at lower bound ($10 → 1000) keeps tier=small (locked)', () => {
      // The locked tier $10 takes precedence over the custom branch because
      // the cents value exactly matches the locked tier. This is intentional:
      // backend `resolveTier('small')` and `resolveTier('custom', 1000)`
      // produce the same Stripe Product name; using 'small' is the
      // canonical path and lets server-side reporting bucket the purchase
      // under the named tier.
      const body = buildCheckoutInput(1000);
      expect(body.tier).toBe('small');
    });

    it('passes through optional success_url and cancel_url', () => {
      const body = buildCheckoutInput(2500, {
        success_url: 'tgp://billing/success',
        cancel_url: 'tgp://billing/cancel',
      });
      expect(body.success_url).toBe('tgp://billing/success');
      expect(body.cancel_url).toBe('tgp://billing/cancel');
    });

    it('always emits a tier on every output (backend @IsIn requires it)', () => {
      // Random-ish sample across the [0, 50000] range to catch a future
      // regression that returns `tier: undefined` for some branch.
      for (const cents of [0, 1, 999, 1000, 1500, 2500, 2501, 9900, 9901, 50_000]) {
        const body = buildCheckoutInput(cents);
        expect(VALID_TIERS).toContain(body.tier);
      }
    });
  });

  describe('response shape — backend authority', () => {
    // This is a type-level contract pin: if a future edit renames the
    // response field, TypeScript catches it AND this test documents the
    // expected wire field names so the failure is obvious.
    it('CreateCheckoutResponse documents checkout_url / checkout_session_id / amount_cents', () => {
      // We can't import the type at runtime; assert via a fake matching
      // object that the property names match what the backend returns.
      const fakeBackendResponse = {
        checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_xyz',
        checkout_session_id: 'cs_test_xyz',
        amount_cents: 2500,
      };
      // Type-checking this assignment IS the contract — if the type loses
      // any of these fields the test file stops compiling.
      const typed: import('../coachAiBudgetApi').CreateCheckoutResponse =
        fakeBackendResponse;
      expect(typed.checkout_url).toContain('checkout.stripe.com');
      expect(typed.checkout_session_id).toMatch(/^cs_/);
      expect(typed.amount_cents).toBe(2500);
    });
  });
});
