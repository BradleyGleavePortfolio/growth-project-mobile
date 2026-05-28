/**
 * coachAiBudgetApi — typed client for the AI budget + credit pack endpoints.
 *
 * Endpoints (Stream 1 backend):
 *   GET  /coach/ai/budget                       getBudget()
 *   POST /coach/ai/credit-packs/checkout        createCheckout({ tier, amount_cents? })
 *
 * Wire contract (matches backend `CreditPackCheckoutRequestDto`):
 *   - `tier` is REQUIRED. Backend rejects with 400 if missing.
 *     Locked tiers: 'small' ($10) | 'medium' ($25) | 'large' ($99) | 'custom'.
 *   - `amount_cents` is REQUIRED only when `tier === 'custom'`, and must be
 *     an integer in [1000, 50000] (validated server-side via class-validator
 *     `@Min(1000) @Max(50000)`).
 *   - `success_url` / `cancel_url` are optional. If unset, the backend uses
 *     its configured defaults from `STRIPE_CHECKOUT_{SUCCESS,CANCEL}_URL`.
 *
 * Response shape (matches backend `CreditPackCheckoutResponseDto`):
 *   `{ checkout_session_id, checkout_url, amount_cents }`. The session is
 *   opened in a WebView; the session id is echoed for telemetry.
 *
 * Routes pass through the shared axios instance (`src/services/api.ts`) so
 * JWT attach + 401-refresh stay uniform with the rest of the app.
 */

import api from '../services/api';
import type { CoachAIBudgetResponse } from './types/coachAIBudget';

/**
 * The four pack tiers the backend `class-validator` `@IsIn(...)` accepts.
 * The mobile surfaces speak in cents internally and map to a tier at the
 * API boundary via {@link tierForCents}.
 */
export type CreditPackTier = 'small' | 'medium' | 'large' | 'custom';

/** Backend response shape for `POST /coach/ai/credit-packs/checkout`. */
export interface CreateCheckoutResponse {
  /** Stripe Checkout Session URL — open this in a WebView. */
  checkout_url: string;
  /** Stripe Checkout Session id (echoed for telemetry / debugging only). */
  checkout_session_id: string;
  /** Face-value cents the session was minted for. Echoed by the backend so
   *  the client can confirm what the coach is actually being charged for
   *  (e.g. before opening the WebView). */
  amount_cents: number;
}

export interface CreateCheckoutInput {
  /** Pack tier — REQUIRED. Backend `@IsIn(['small','medium','large','custom'])`
   *  rejects any other value with 400. */
  tier: CreditPackTier;
  /** Face-value cents. REQUIRED when `tier === 'custom'`; ignored for the
   *  locked tiers (backend pins the amount from the tier). Must be an
   *  integer in [1000, 50000]. */
  amount_cents?: number;
  /** Optional override for the post-success deep link. Backend falls back to
   *  `STRIPE_CHECKOUT_SUCCESS_URL` when unset. */
  success_url?: string;
  /** Optional override for the post-cancel deep link. Backend falls back to
   *  `STRIPE_CHECKOUT_CANCEL_URL` when unset. */
  cancel_url?: string;
}

/** Minimum custom pack value, in cents ($10). Mirrored from spec §0. */
export const CUSTOM_PACK_MIN_CENTS = 1000;
/** Maximum custom pack value, in cents ($500). Mirrored from spec §0. */
export const CUSTOM_PACK_MAX_CENTS = 50000;

/**
 * Map a face-value cents amount to the backend tier name. Mobile UI
 * speaks in cents end-to-end; the wire contract speaks in tiers. This
 * keeps the mapping in ONE place so a future tier change (e.g. mid-tier
 * $50) is a single-line edit.
 *
 * The three locked tiers must match `STREAM_1_AI_CREDITS_SPEC.md` §0 and
 * the backend `CoachAiCreditPackService.resolveTier()` switch verbatim.
 */
export function tierForCents(amountCents: number): CreditPackTier {
  switch (amountCents) {
    case 1000:
      return 'small';
    case 2500:
      return 'medium';
    case 9900:
      return 'large';
    default:
      return 'custom';
  }
}

/**
 * Inverse of {@link tierForCents} for the locked tiers. Returns null for
 * `custom` because the cents amount is open-ended there.
 */
export function centsForLockedTier(tier: CreditPackTier): number | null {
  switch (tier) {
    case 'small':
      return 1000;
    case 'medium':
      return 2500;
    case 'large':
      return 9900;
    case 'custom':
    default:
      return null;
  }
}

/**
 * Convenience builder: turn a cents amount into the request body the
 * backend expects. Used by the checkout screen so the cents-vs-tier
 * mapping never leaks beyond this module.
 */
export function buildCheckoutInput(
  amountCents: number,
  extras?: Pick<CreateCheckoutInput, 'success_url' | 'cancel_url'>,
): CreateCheckoutInput {
  const tier = tierForCents(amountCents);
  return {
    tier,
    // For locked tiers the backend pins the amount from the tier, but
    // sending `amount_cents` is harmless and lets the server cross-check.
    // For 'custom' it's required.
    amount_cents: amountCents,
    ...extras,
  };
}

export const coachAiBudgetApi = {
  /** Read the current period's budget for the authenticated coach. */
  getBudget: () => api.get<CoachAIBudgetResponse>('/coach/ai/budget'),

  /**
   * Mint a Stripe Checkout Session for a credit pack. The returned
   * `checkout_url` is opened inside `CreditPackCheckoutScreen` via
   * react-native-webview.
   *
   * Per spec §3 the route is rate-limited to 5 requests / 60s via the named
   * throttle bucket `COACH_AI_CREDIT_PACK_CHECKOUT` — callers should expect
   * a 429 on rapid retries and surface it as a friendly retry-soon message.
   */
  createCheckout: (input: CreateCheckoutInput) =>
    api.post<CreateCheckoutResponse>('/coach/ai/credit-packs/checkout', input),
};
