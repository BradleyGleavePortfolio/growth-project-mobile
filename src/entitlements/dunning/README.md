# Payment lockout (Smart Dunning v2)

Client-side half of the backend's 10-day non-payment sequence (`FEATURE_DUNNING_V2`).

| Day | Backend | App |
|---|---|---|
| 0-9 | Stripe retries the charge (Days 1, 3, 7); the client keeps full access | `DunningBanner` on Home and Plans: amount, failure date, lock date, Update card, Message coach |
| 10+ | `DunningLockoutGuard` answers non-allowed routes with `403 { code: 'LOCKED_DUNNING' }`; every `@OpenToCoachlessClient` route (the client's own logging) passes (b#899) | `DunningLockoutProvider` shows one full-screen `DunningLockoutScreen` on Home and every other screen; the client's own logging stays open (below) |
| Paid | Saving a card in the app pays the open invoice right away (owner 1A); `invoice.paid` also clears the lock | `UpdateCardScreen` shows "Payment received", the status refresh clears the store, paid queries refetch |
| Cancel in dunning | Unpaid invoice voided, plan ends now (owner 2A) | "End my plan" on the lockout and Update card screens, with a confirm dialog |
| Dispute on a recurring plan | R-DISPUTE-PAUSE (D2c `reason: 'dispute_paused'`): access ends at once, billing is paused, nothing restarts on its own, the coach decides on restarting | One sentence on every surface (`disputePauseFacts`): access has ended, billing is paused, the coach decides; no lock date, no card or cancel path, Message coach first. The backend reports an inquiry the same way and an inquiry moves no money, so copy says the bank opened a dispute or inquiry, never that a payment was reversed (B-352-9) |

## Files

- `dunningLockoutStore.ts`: module-level signal. The axios interceptor in `src/services/api.ts` calls `reportLocked` on every 403 `LOCKED_DUNNING`. `EntitlementProvider` reads it so the paywall sheet never stacks on top of the lockout.
- `dunningApi.ts`: `GET /v1/checkout/dunning` (status, reachable while locked), `POST /v1/checkout/payment-method/setup-intent`, `POST /v1/checkout/payment-method/confirm`, `POST /v1/checkout/subscriptions/:purchaseId/cancel`. Strict normalisers; money is integer minor units.
- `updateCard.ts`: the native card update (OR-110-2). The backend creates a SetupIntent on the client's platform Stripe customer. `@stripe/stripe-react-native` PaymentSheet collects the card (`initStripe` with the key from the backend, `initPaymentSheet` with `setupIntentClientSecret`, then `presentPaymentSheet`). Confirm then sets the default card and, in dunning, pays the open invoice. A `requires_action` answer runs `handleNextAction` on the returned PaymentIntent and confirms again. The SDK is required lazily, so a build without the native module shows "update the app" instead of crashing.
- `paymentSheetAppearance.ts`: the PaymentSheet theme built from `theme/tokens` (light and dark semantic tokens, rounded primary button: `radius.sm`, now 12). Fonts are left to the OS, because Stripe looks fonts up by native name.
- `UpdateCardScreen.tsx`: route `UpdateCard` in the More stack. Deep links `tgp://billing/update-card`, `tgp://billing/update` and the universal link `https://app.trygrowthproject.com/billing/update-card` (dunning emails) open it. It says what will be charged before the client acts, shows the outcome (paid, saved, processing, bank confirmation, declined), and offers "Confirm with my bank" and "End my plan instead".
- `dunningErrorCopy.ts`: specific copy for every backend machine code (`CUSTOMER_NOT_FOUND`, `SETUP_INTENT_*`, `BILLING_ACTION_IN_PROGRESS`, `PURCHASE_NOT_FOUND`, `NOT_A_SUBSCRIPTION`, `CANCEL_INCOMPLETE`, `STRIPE_*` per step, `PAYMENTS_NOT_CONFIGURED`), for the native sheet, and for offline, rate-limited and session-ended. A lost answer on a payment never says "nothing changed". Unknown failures show the request reference and the support address, and are reported to Sentry.
- `DunningLockoutProvider.tsx`: mounted in `RootNavigator` around `ClientNavigator` (clients only). It steps aside while `DataExport`, `DeleteAccount`, `Messages` or `UpdateCard` is focused (`REACHABLE_WHILE_LOCKED`, the backend allow-list), and on the client's own logging (`OPEN_FOR_OWN_LOGGING`, below). On a locked screen opened over an open one (Exercise library over Train, Exercise details over a live workout) the lockout shows Back, and Android back returns there; anywhere else Android back is held.
- `DunningLockoutScreen.tsx`, `DunningBanner.tsx`: UI. No exclamation marks, no emoji.
- `DunningOwnScreen.tsx`: `withProtectedScreen` wraps every OWN screen in it. While locked it adds `DunningBanner presentation="locked"` at the foot of the screen, above the tab bar (title from the lockout, Update card, Message coach; no card path for a dispute or refund), hidden while the keyboard is up. The tree is the same locked or not, so a live workout never remounts.

## Own logging stays open (owner ruling 2026-10-08 23:5x)

No client is ever locked out of basic functions. A client at Day 10+, or in a disputed or refunded cycle that uses the same lockout, still logs. `OPEN_FOR_OWN_LOGGING` is every screen `ClientNavigator` wraps OWN plus the Train and Food tabs (`WorkoutTab`, `Log`); `dunningOwnLogging135.test.tsx` holds the set to the navigator. Habits and New routine are OWN too: their `/habits`, `/check-ins` and `/routines` routes pass the lockout on the server, and New routine's exercise list is on the phone. `AIGuide` is OWN but is Roman's guidance on `/ai`, a paid surface the backend keeps locked, so it keeps the lockout. The lockout covers the tab bar, so its "Still available" list leads to Log food, Log a workout and Habits and check-in. Billing, the dispute pause, coach services and Roman are unchanged.

## Recovery

Saving a card on the Update card screen pays the open invoice right away (owner ruling 1A), so a locked client gets access back as soon as the payment clears. No Stripe-hosted portal is involved. The backend keeps `POST /v1/checkout/billing-portal` only for app builds installed before this change.

With the backend flag off, the status route returns `enabled: false` and nothing here renders.
