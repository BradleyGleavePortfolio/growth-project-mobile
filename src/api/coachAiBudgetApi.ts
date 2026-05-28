/**
 * coachAiBudgetApi — typed client for the AI budget + credit pack endpoints.
 *
 * Endpoints (Stream 1 backend):
 *   GET  /coach/ai/budget                       getBudget()
 *   POST /coach/ai/credit-packs/checkout        createCheckout({ amount_cents })
 *
 * `amount_cents` must be one of the pack tiers (1000, 2500, 9900) or a custom
 * value within [1000, 50000]. The backend re-validates — the UI rejects out-of-
 * range custom values before sending to keep the round-trip honest.
 *
 * Routes pass through the shared axios instance (`src/services/api.ts`) so JWT
 * attach + 401-refresh stay uniform with the rest of the app.
 */

import api from '../services/api';
import type { CoachAIBudgetResponse } from './types/coachAIBudget';

/** Backend response shape for `POST /coach/ai/credit-packs/checkout`. */
export interface CreateCheckoutResponse {
  /** Stripe Checkout Session URL — open this in a WebView. */
  url: string;
  /** Stripe Checkout Session id (echoed for telemetry / debugging only). */
  session_id: string;
}

export interface CreateCheckoutInput {
  /** Face-value cents the coach is paying. 1000 = $10, 9900 = $99. */
  amount_cents: number;
}

/** Minimum custom pack value, in cents ($10). Mirrored from spec §0. */
export const CUSTOM_PACK_MIN_CENTS = 1000;
/** Maximum custom pack value, in cents ($500). Mirrored from spec §0. */
export const CUSTOM_PACK_MAX_CENTS = 50000;

export const coachAiBudgetApi = {
  /** Read the current period's budget for the authenticated coach. */
  getBudget: () => api.get<CoachAIBudgetResponse>('/coach/ai/budget'),

  /**
   * Mint a Stripe Checkout Session for a credit pack. The returned `url`
   * is opened inside `CreditPackCheckoutScreen` via react-native-webview.
   *
   * Per spec §3 the route is rate-limited to 5 requests / 60s via the named
   * throttle bucket `COACH_AI_CREDIT_PACK_CHECKOUT` — callers should expect
   * a 429 on rapid retries and surface it as a friendly retry-soon message.
   */
  createCheckout: (input: CreateCheckoutInput) =>
    api.post<CreateCheckoutResponse>('/coach/ai/credit-packs/checkout', input),
};
