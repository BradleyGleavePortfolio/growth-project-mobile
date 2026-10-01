# Payment lockout (Smart Dunning v2)

Client-side half of the backend's 10-day non-payment sequence (`FEATURE_DUNNING_V2`).

| Day | Backend | App |
|---|---|---|
| 0-9 | Stripe retries the charge (Days 1, 3, 7); the client keeps full access | `DunningBanner` on Home and Plans: amount, failure date, lock date, Update card, Message coach |
| 10+ | `DunningLockoutGuard` answers non-allowed routes with `403 { code: 'LOCKED_DUNNING' }` | `DunningLockoutProvider` shows one full-screen `DunningLockoutScreen` |
| Paid | `invoice.paid` clears the lock immediately | Status refresh clears the store, paid queries refetch |

## Files

- `dunningLockoutStore.ts`: module-level signal. The axios interceptor in `src/services/api.ts` calls `reportLocked` on every 403 `LOCKED_DUNNING`. `EntitlementProvider` reads it so the paywall sheet never stacks on top of the lockout.
- `dunningApi.ts`: `GET /v1/checkout/dunning` (status, reachable while locked) and `POST /v1/checkout/billing-portal`.
- `updateCard.ts`: mints the Stripe Billing Portal session, refuses non-Stripe URLs (`assertStripeUrl`), opens it with `WebBrowser.openAuthSessionAsync`.
- `dunningErrorCopy.ts`: specific copy per failure (offline, rate limited, no billing account, Stripe unavailable, link rejected, session ended). Unknown failures show the request reference and the support address, and are reported to Sentry.
- `DunningLockoutProvider.tsx`: mounted in `RootNavigator` around `ClientNavigator` (clients only). It steps aside while `DataExport`, `DeleteAccount` or `Messages` is focused, the same set the backend allow-list keeps reachable.
- `DunningLockoutScreen.tsx`, `DunningBanner.tsx`: UI. No exclamation marks, no emoji.

## Recovery note

Updating the card in the Stripe portal does not, by itself, charge the open invoice once Stripe's retries are exhausted. The lockout copy therefore tells the client to pay the open invoice under Invoice history. The portal must have invoice history enabled.

With the backend flag off, the status route returns `enabled: false` and nothing here renders.
