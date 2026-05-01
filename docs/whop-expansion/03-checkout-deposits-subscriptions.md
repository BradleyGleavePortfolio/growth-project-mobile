# 03 — Checkout, deposits, and subscriptions

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app
**Owner:** Mobile client team, with payments-engine ownership shared
with backend.

## WHY

Every paid surface in this pack — storefront purchases, application
deposits, paid spaces, paid event seats, rewards redemption — flows
through one checkout module. Without a single checkout abstraction:

- Each surface re-implements Stripe handling and gets it slightly
  wrong.
- TGP-balance partial-pay (rewards / referral payouts applied at
  checkout) becomes impossible to roll out cleanly.
- App Store / Play Store policy reviews on payment surfaces have to
  be argued per-surface instead of once.

This brief defines the checkout abstraction once. Other features
in this pack reference it.

## WHEN to build

After:
- Backend #119 (payments engine) exposes a `payment_session` create
  endpoint that returns a *typed action* (web fallback URL, native
  PaymentSheet token, or "balance only" complete) per the contract
  below.
- Backend #120 (TGP-balance ledger) exposes a `balance` read and a
  `partial_pay_intent` write so a client can apply some balance and
  pay the remainder.

Before:
- [01-coach-storefront](./01-coach-storefront.md) flips on for paid
  offers (the storefront can ship with free-only offers ahead of
  this).
- [04-application-funnel](./04-application-funnel.md) — the funnel's
  "Apply" CTA collects a deposit through this module.
- [09-rewards-bounties](./09-rewards-bounties.md) — TGP-balance
  redemption uses the same shape.

## WHERE in the repo

- New module: `src/services/checkout/` (own README per doctrine §8).
  - `index.ts` — public API (`startCheckout`, `applyBalance`,
    `cancelCheckout`).
  - `paymentSession.ts` — fetches and resolves the typed session.
  - `webFallback.ts` — opens the in-app browser for sessions that
    require a web rail (e.g. unsupported native methods, App Store
    policy edge cases).
- New screen: `src/screens/client/CheckoutScreen.tsx` — the in-app
  checkout summary (line items, balance toggle, total, CTA).
- New screen: `src/screens/client/CheckoutResultScreen.tsx` — success
  / failure / pending render after returning from the payment rail.
- API: `src/services/api.ts` — `paymentsApi.createSession`,
  `paymentsApi.confirmSession`, `paymentsApi.getSession`,
  `paymentsApi.cancelSession`, `walletApi.getBalance`.
- Type: `src/types/payments.ts`.

## WHO owns and uses it

- **Builder:** Mobile client team, paired with backend payments
  owner during the typed-action contract negotiation.
- **Caller:** Any feature in this pack with a paid surface. Callers
  do not see Stripe; they call `startCheckout({ offerId, options })`
  and receive a `CheckoutResult`.
- **Audience:** Buyers (clients).

## WHAT MVP includes

- **Typed payment session.** The backend returns one of:
  - `nativeSheet` — present a native Stripe PaymentSheet (Apple
    Pay / Google Pay / saved card).
  - `webRedirect` — open the in-app browser to a hosted checkout
    page; mobile listens for the deep-link return.
  - `balanceOnly` — TGP-balance covers the full amount; no
    payment rail; confirm immediately.
  - `applicationHold` — application kind; hold a deposit and
    capture only on coach approval (see
    [04](./04-application-funnel.md)).
- **CheckoutScreen** — line items (offer title + price), optional
  balance toggle ("Apply $X balance"), total, CTA ("Pay" / "Apply"
  / "Confirm"). Locale-aware money formatting.
- **CheckoutResultScreen** — three end states:
  - success: entitlement granted; CTA to open the entitlement.
  - failure: typed reason ("card declined", "insufficient
    balance", "session expired"); retry CTA where applicable.
  - pending: webhook hasn't arrived yet; show a "We're confirming
    your payment" surface with a polling refresh.
- **Cancel.** Back-button or explicit "Cancel" cancels the session
  server-side and returns to the previous screen with the offer
  intact.
- **Resume.** A pending session can be resumed from the
  CheckoutResultScreen by deep-link or from a "your last payment"
  pill on the relevant offer detail.

### Out of scope for v1

- Saved-card management UI (Stripe handles this; we expose the
  PaymentSheet which already shows saved cards).
- Refund self-serve (refunds are coach-initiated server-side; a
  buyer-side refund request flow is later).
- Gift purchases / buy-for-someone-else.
- Multi-currency in a single transaction.
- Apple Pay / Google Pay merchant configuration changes (these
  are EAS-side; coordinate via `docs/platform-readiness/01`).
- Crypto / BNPL.

## HOW to implement safely

1. **Mobile never parses a Stripe object.** The session contract
   gives mobile typed actions. If the backend ever returns a raw
   Stripe object, treat it as a contract bug and refuse to render
   it. This is an audit-friendly invariant — log it, fix it,
   don't paper over.
2. **App Store / Play Store policy.** Digital services sold for
   coach delivery are services rendered (not in-app digital
   content), and Apple/Google generally allow Stripe for these.
   That said, *if* a future surface is judged in-app digital
   content, the abstraction must be able to swap to IAP without
   re-touching every caller. Keep the public API
   (`startCheckout`) policy-neutral — callers pass an
   `offerId`, not a payment kind.
3. **TGP-balance is a payment rail too.** The same `startCheckout`
   path applies balance optionally; the typed action `balanceOnly`
   skips the rail entirely. This means rewards
   ([09](./09-rewards-bounties.md)) and referral payouts
   ([05](./05-affiliate-referral-dashboards.md)) need no separate
   redemption flow.
4. **Idempotency.** Every `createSession` call sends an
   idempotency key; the backend dedupes. Mobile retries on
   network failure are safe.
5. **Deep-link return.** Web-fallback uses `tgp://checkout/return?session=<id>`
   on iOS and Android. The parser must route to
   `CheckoutResultScreen` with the session id. Add to the deep-link
   parser change in [01](./01-coach-storefront.md) so the EAS
   build covers both routes.
6. **Pending state is normal.** Webhook latency means the success
   screen sometimes lands before the entitlement does. Poll
   `getSession` with backoff; do not block the UI on it.

## Screens / navigation sketch

```
Caller (storefront / funnel / event RSVP / reward)
  └─ startCheckout({ offerId, applyBalance? })
       └─ CheckoutScreen
            ├─ Line items
            ├─ "Apply $X balance" toggle (if balance > 0)
            ├─ Total
            └─ CTA  ──► resolveTypedAction
                          ├─ nativeSheet  → Stripe PaymentSheet → return
                          ├─ webRedirect  → InAppBrowser → tgp://checkout/return → return
                          ├─ balanceOnly  → confirmSession → return
                          └─ applicationHold → confirmSession (hold) → CheckoutResultScreen.pending

CheckoutResultScreen
  ├─ success → "Open <entitlement>" CTA
  ├─ failure → typed reason + Retry / Cancel
  └─ pending → "Confirming..." with poll → resolves to success/failure
```

## API contract dependency

- `POST /payments/sessions` body
  `{ offerId, applyBalanceMinor?: number, idempotencyKey: string }`
  → `PaymentSession`
- `GET /payments/sessions/:id` → `PaymentSession`
- `POST /payments/sessions/:id/confirm` → `PaymentSession`
- `POST /payments/sessions/:id/cancel` → `PaymentSession`
- `GET /me/wallet/balance` → `{ balanceMinor: number, currency: string,
  pending: { incoming: number, outgoing: number } }`

`PaymentSession` (mobile's target consumption contract):

```ts
type PaymentAction =
  | { kind: 'nativeSheet'; paymentIntentClientSecret: string;
      ephemeralKey: string; customerId: string;
      merchantDisplayName: string; allowApplePay: boolean;
      allowGooglePay: boolean }
  | { kind: 'webRedirect'; url: string; returnUrl: string }
  | { kind: 'balanceOnly' }
  | { kind: 'applicationHold'; paymentIntentClientSecret: string;
      ephemeralKey: string; customerId: string };

type PaymentSession = {
  id: string;
  status: 'pending' | 'requiresAction' | 'succeeded' | 'failed' |
          'cancelled' | 'expired';
  action: PaymentAction;
  total: Money;
  appliedBalance: Money | null;
  remainder: Money;
  failureReason: 'card_declined' | 'insufficient_balance' |
                  'session_expired' | 'unknown' | null;
  entitlementGrantedId: string | null; // present iff status === 'succeeded'
};
```

## Stripe / TGP-balance abstraction (the canonical statement)

Mobile sees a single object — `PaymentSession.action` — and
implements one switch over its `kind`. The mobile app does not
import the Stripe SDK in any caller outside `services/checkout/`;
the SDK lives only behind the `nativeSheet` branch. TGP-balance is
a payment rail in this model: when balance covers the full total,
the action becomes `balanceOnly` and the rail is just a server
write. This abstraction is the contract every other feature in
this pack relies on. If it changes, every caller is updated through
this module; no caller writes its own integration.

## Loading / error / empty states

- **Loading (creating session):** non-blocking spinner inside the
  CTA button; the CTA disables.
- **Loading (confirming):** full-screen loader with copy
  "Confirming your payment..." (≤ 2s typical, ≤ 8s before fallback).
- **Empty (no balance):** balance toggle hidden.
- **Failure:** typed reason rendered with the right CTA — retry
  for declined; "Add funds" deferred (out of scope v1); "Try again
  later" for expired.
- **Pending:** poll up to 30s with exponential backoff; at 30s,
  surface "We'll email you when the payment confirms" and route
  out — do not strand the user.

## Accessibility

- Money values are read with currency name, not symbol (screen
  readers).
- The balance toggle's state change is announced ("Applied 12 USD
  balance, total now 38 USD").
- Buttons in error/pending states do not change label silently —
  use polite live-region announcements.
- Web-fallback hands off to the in-app browser, which has its own
  a11y; do not embed it in a WebView (privacy + a11y reasons).

## Analytics

- `checkout_started` — `{ offerId, offerKind, hasBalance: bool }`
- `checkout_action_resolved` — `{ kind: PaymentAction['kind'] }`
- `checkout_succeeded` — `{ offerId, totalMinor, currency,
  appliedBalanceMinor }`
- `checkout_failed` — `{ offerId, reason }`
- `checkout_cancelled` — `{ offerId, stage }`

No card metadata, no email, no full names. PostHog already
respects `EXPO_PUBLIC_POSTHOG_KEY` as a kill switch.

## Feature flags / entitlements

- Flag: `features.checkout`. Off by default until the contract is
  signed off in staging. When off, every caller's "buy" CTA
  routes to a "Coming soon" screen — but only if a flag-on caller
  exists.
- Sub-flag: `features.checkout.balance`. Hides the balance
  toggle. Useful if TGP-balance ([09](./09-rewards-bounties.md))
  is not yet GA but checkout is.
- No buyer-side entitlement gating (anyone with a coach-issued
  offer can buy). Coach-side entitlement gating happens in the
  builder ([02](./02-offer-builder.md)).

## Privacy / moderation

- Webhook handling and PII live server-side. The mobile client
  never stores card data.
- Receipts are emailed by the backend; mobile shows a "Receipt
  sent to <email>" line on success, with the email masked.
- Failed payments do not log card metadata anywhere — Sentry
  events scrub `paymentIntentClientSecret` via the existing
  Sentry breadcrumb sanitizer.

## Rollout

1. Land behind `features.checkout`, off. Verify the typed-action
   switch with a stub backend that returns each `kind` in turn.
2. Flip on for one internal coach with one paid free-trial-style
   offer end-to-end (`oneTime`, low amount, native sheet).
3. Add `webRedirect` for any payment method not supported in the
   native sheet for that region; verify return deep-link cold
   and warm.
4. Add `balanceOnly` once #120 is in staging.
5. Add `applicationHold` alongside [04](./04-application-funnel.md).
6. GA — flip on for the 5–10 coach storefront ring.

## Tests

- Unit: typed-action switch — every `PaymentAction['kind']`
  routes correctly.
- Unit: idempotency-key generation; retries reuse the key.
- Unit: deep-link parser — `tgp://checkout/return?session=<id>`.
- Component: CheckoutScreen with each session status; balance
  toggle interaction; locale formatting (USD/GBP/EUR).
- Integration: success / failure / pending end-to-end with a
  mock backend; resume from CheckoutResultScreen.
- Manual: real Stripe test card on a TestFlight build; web
  fallback on Android with a redirect-only method; cold-start
  return deep-link.

## Risks

- **Store policy reinterpretation.** If Apple/Google decide a
  surface is in-app digital content, the abstraction must be able
  to substitute IAP. Keeping callers policy-neutral is the
  insurance — do not let any caller introspect `PaymentAction`.
- **Pending-state UX.** A user staring at a pending screen for
  more than 8s will hit retry; the backend must be webhook-safe
  to retried confirmations. Idempotency key carries.
- **Currency confusion.** Mixing currencies between balance and
  offer is forbidden in v1; the backend must reject it; mobile
  must not show the toggle when currencies differ.
- **Web-fallback abandonment.** A user who closes the in-app
  browser without completing leaves an open session. Cancel on
  unmount of the result screen; the backend cleans up expired
  sessions.

## Dependencies

- Backend #119 payments engine (typed-action contract).
- Backend #120 TGP-balance ledger.
- `docs/platform-readiness/07` loading/error/empty patterns.
- `docs/platform-readiness/09` API contract compatibility.
- [01](./01-coach-storefront.md), [04](./04-application-funnel.md),
  [05](./05-affiliate-referral-dashboards.md),
  [09](./09-rewards-bounties.md) as callers.

## Acceptance criteria

- [ ] Flag off → no caller can reach checkout; CTAs render the
      "coming soon" placeholder.
- [ ] Flag on → every `PaymentAction['kind']` resolves to the
      right end state on iOS and Android.
- [ ] Idempotent retries do not double-charge (verified with
      backend test).
- [ ] Pending state polls with backoff and resolves within 30s
      or routes to a non-stranded surface.
- [ ] Balance toggle hides when balance is 0 or currencies differ.
- [ ] No Stripe SDK import outside `services/checkout/`.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The first card-declined dialog is the most important UX in this
  pack. Get the copy reviewed by support before flipping on for
  external coaches.
- Web fallback is the policy escape hatch — do not delete it
  even if the native sheet covers every case in v1; it is the
  insurance for surface-level App Store rulings.
- The "Cancel" path on a pending session is intentionally
  non-destructive: it cancels the session but leaves the
  entitlement query untouched. The backend grants entitlement on
  webhook; mobile only invalidates the cache.
