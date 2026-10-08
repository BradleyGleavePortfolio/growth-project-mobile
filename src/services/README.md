# Services

Network, auth, observability, and offline-queue glue. The screens never call `axios` or `@supabase/supabase-js` directly — they go through the typed wrappers in this directory.

## Purpose

- One axios instance, one auth interceptor, one refresh path. Token refresh under concurrent 401s is a coordination problem; this directory owns the solution.
- Token storage in the secure enclave (Keychain / Keystore) instead of plain AsyncStorage.
- A single React Query client with sensible mobile defaults (no focus refetch, persisted cache).
- A Realtime broadcast channel that pings clients to refetch — no PII over the WebSocket.
- A small offline queue for food logs so a user logging breakfast on the subway doesn't lose their entry.
- Sentry init, scoped to fail closed when the DSN is missing.

## Key files

| File | What it does |
| --- | --- |
| `api.ts` | Axios instance, auth interceptor, single-flight refresh, all typed API surfaces (`authApi`, `profileApi`, `foodApi`, `logApi`, `aiApi`, `workoutApi`, `coachApi`, `messagesApi`, `nudgesApi`, `recipesApi`, `listsApi`, …). |
| `api.ts` water/fast removal | `waterApi.deleteEntry(id)` calls `DELETE /nutrition/water/:id`; `fastingApi.deleteFast(id)` calls `DELETE /fasting/:id`. Both use the existing authenticated instance and the deployed [backend #858](https://github.com/BradleyGleavePortfolio/growth-project-backend/pull/858) caller-owned deletion contract. `WaterEntry` describes the saved id, ml amount and logged date returned by water reads/adds. No new auth, flag or dependency. |
| `accountBinding.ts` | Binds a request to one account and sign-in (`AccountBinding`: token subject + auth epoch). The request interceptor sends a bound request only with that account's credential and sign-in, every `authEvents` emit bumps the epoch and aborts bound reads in flight. Used by the Roman chat history and delete calls (mobile #331). |
| `sessionFence.ts` | One ordering rule for every write of the session credential pair (`supabase_token` / `supabase_refresh_token`): sign-in and sign-out writes, the token refresh commit, the refresh-failure sign-out and the one-time legacy AsyncStorage copy each hold the fence for their whole native write; a session generation moves on every sign-in / sign-out write, so a refresh or copy started under an older session publishes nothing (mobile #331). |
| `authActions.ts` | `signOut()` and `refreshProfile()` — the only callers that touch `SIGN_OUT_KEYS` directly. Emits `authEvents`. |
| `secureStorage.ts` | `getItem` / `setItem` / `removeItem` shim that uses `expo-secure-store` on native and `AsyncStorage` on web. Migrates legacy AsyncStorage tokens on first read. |
| `realtime.ts` | Subscribes to Supabase Realtime broadcast channels. Used only for "ping → go fetch" — never for row delivery. |
| `queryClient.ts` | The shared `QueryClient` plus an AsyncStorage-backed cache persister. Defaults: 30 s stale, 10 min gc, no focus refetch, 2 retries on read, 0 on mutate. |
| `foodLogQueue.ts` | Offline queue for `POST /log/food`. Stored as a JSON array under `pending_food_logs`. Flushed by `RootNavigator` on offline → online. |
| `refreshQueue.ts` | Single-flight refresh coordinator (currently unwired; `api.ts` has its own equivalent). Kept as a tested helper for a follow-up consolidation. |
| `sentry.ts` | `initSentry`, `wrap`, `captureError`, `captureErrorWithoutPii` (same, but the event drops the signed-in user, request data and breadcrumbs via `stripPersonalData`), `setSentryUser`. No-ops when `EXPO_PUBLIC_SENTRY_DSN` is missing. |

## Data flow

```
Screen ──► api.<surface>.<method>(...)
        ▲
        │ request interceptor:
        │   secureStorage.getItem('supabase_token') ─► Authorization: Bearer
        │
        └─ response interceptor:
            ├─ no response  ─► reject with friendly "Cannot reach server"
            ├─ 401 + !_retry ─► coalesce into refreshPromise
            │                  │
            │                  ├─ success ─► retry original with new token
            │                  ├─ no answer ─► reject as "Cannot reach server", session kept
            │                  └─ refused ─► sign out (once)
            └─ otherwise ─► reject

Realtime:
  subscribeToMessages(userId, refetch) ─► channel `messages:<userId>`
                                       └─► ping ─► caller refetches via REST

Food log offline:
  enqueueSearchLog / enqueueManualLog ─► AsyncStorage('pending_food_logs')
                                       │
                                       └─► flush() ─► foodApi.create + logApi.logFood

Sentry:
  initSentry() ─► reads EXPO_PUBLIC_SENTRY_DSN
              ─► strips Authorization / Cookie before send
  setSentryUser({id}) ─► tags subsequent events with the account id only (never the email)
```

### Token-refresh contract

The header comment in `api.ts` is the canonical write-up. Short version:

- One `refreshPromise` is in flight at a time. Concurrent 401s queue on it.
- A refresh the sign-in service refuses (invalid, expired or revoked refresh token) signs out exactly once (`signOut()`, which emits `authEvents.emit('logout')`).
- A refresh that gets no answer (no signal, a timeout, a gateway error, the sign-in service answering 429 or 5xx) never signs out (SESSION-KEEP-130): the waiting requests reject like a request with no answer ("Cannot reach server", no `response`), the stored session is kept and the next 401 tries the refresh again. Sign-out removes the workouts and foods still waiting on the phone, so it is never triggered by a weak signal.
- A voluntary sign-out first makes one bounded try (4 s) to send the foods saved offline and the finished workouts waiting on the phone (`sendUnsyncedLogs`). The client Settings and Profile confirms come from `prepareSignOutConfirm`, which names anything still unsent, for example "2 workouts and 1 food have not synced yet and will be removed from this phone." The sign-out after a refused refresh skips the send: that session can no longer send anything.
- The `_retry` flag prevents an infinite loop if the retried request also returns 401.

## App-store / deep-link dependencies

None directly, but several side-effects matter for review:

- `sentry.ts` applies the content policy in `sentryPrivacy.ts` through `beforeBreadcrumb`, `beforeSend` and `beforeSendTransaction`: console breadcrumbs are dropped; request URLs keep only their route (no query, fragment or credentials, ID-like path segments become `:id`); other breadcrumbs lose free text; events keep `user.id` only; `Authorization` and `Cookie` headers, request bodies, cookies and query strings are removed. The native SDKs get `enableNetworkBreadcrumbs: false` / `enableNetworkTracking: false` (iOS) and the `io.sentry.breadcrumbs.network-events=false` manifest flag (Android) so native capture stays quiet after JS re-initializes it. Auditors checking the Data Safety form rely on this.
- `services/realtime.ts` is the reason the Data Safety form lists *App activity → analytics* but **not** *Personal communications* over a WebSocket — Realtime here carries no PII.
- `secureStorage.ts` is the implementation behind the security claim that auth tokens are stored encrypted at rest on device.

## Security and tenancy

- All secrets are read from `EXPO_PUBLIC_*` env vars via `src/config/env.ts`. The Supabase anon key is public by design (anon role); the service-role key never touches the mobile app.
- JWT tokens move from Supabase → SecureStore → axios `Authorization` header. Refresh tokens follow the same path. Plain AsyncStorage is **only** used for non-sensitive flags (`user_data`, `onboarding_complete`, `pending_email`).
- `signOut` clears the access token, refresh token, role flag, onboarding flag, macros, pending email, and resets PostHog identity. It does not clear `user_data` immediately — that's intentional so the subsequent welcome screen can show the last-used email.
- The Realtime client is constructed with `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`. It does not hold the user's session and cannot read RLS-protected rows. Channel name (`messages:<userId>`) is the only addressing primitive.

## Environment variables

| Variable | Required | Read by |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | yes (non-dev) | `api.ts` (via `config/env.ts`). Dev fallback exists for local boots. |
| `EXPO_PUBLIC_SUPABASE_URL` | yes | `api.ts`, `realtime.ts`, `utils/googleAuth.ts`, `utils/supabaseAuth.ts`. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | yes | same as above. |
| `EXPO_PUBLIC_SENTRY_DSN` | no | `sentry.ts`. Missing DSN → no-op. |
| `EXPO_PUBLIC_ENVIRONMENT` | no | `sentry.ts` `environment` tag (defaults to `'production'`). |

Missing required env throws at module load — see `src/config/env.ts`.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Every request fails with "Cannot reach server" | Backend cold start (Fly.io free tier) or no network | The 30 s axios timeout covers cold starts. The interceptor surfaces the message but does not log the user out — `error.response` is undefined for network errors. |
| One 401 logs the user out | `_retry` was already set on a request that came back 401 the second time | Expected: the server rejected the refreshed token. User must sign in again. |
| "Cannot reach server" right after a 401, still signed in | The session refresh got no answer (signal dropped, sign-in service down) | Expected (SESSION-KEEP-130): the session is kept; the next request renews it once the signal is back. |
| Burst of 401s logs the user out | Should not happen — `loggedOutOnce` guards the emit. If you see it, check `refreshPromise` is being cleared correctly in `.finally`. | File a bug; the contract is documented in the `api.ts` header. |
| Realtime ping never arrives | WebSocket dropped (background → foreground), or the backend never broadcast | The screens that use Realtime keep a 60 s safety poll; foreground transition refetches. |
| Food log queue grows but never flushes | `flushFoodLogQueue` only runs on offline → online transition or on explicit caller invocation | Trigger a network change; a future round will add a periodic flush. |
| Sentry sees no events | `EXPO_PUBLIC_SENTRY_DSN` missing or invalid | Expected when running locally without secrets. `initSentry` is a no-op in that path. |

## Tests

```bash
npm test                # jest
npm run typecheck       # tsc --noEmit
npm run lint            # eslint --max-warnings 99999
```

Unit tests of interest:

- `services/__tests__/foodLogQueue.test.ts` — enqueue/flush round-trip.
- `services/__tests__/refreshQueue.test.ts` — single-flight semantics.
- `services/__tests__/secureStorage.test.ts` — migration from legacy AsyncStorage.

## Release notes

- The auth interceptor is allergic to changes. The header comment in `api.ts` lists the five concurrency scenarios it handles; do not edit the refresh path without re-running through that list.
- `EXPO_PUBLIC_API_URL` is required for production builds. The dev fallback is gated on `__DEV__` and will throw in a release build that is missing the var. This is intentional; `npm run validate:config` catches it before `eas build`.
- `secureStorage.ts` is the single security-critical file in this directory. The migration step exists so existing logged-in users don't get logged out on the upgrade that introduced SecureStore — leave it alone unless you intend to force re-login.
- Realtime is best-effort. The 60 s polling fallback is the contract; do not rely on the WebSocket for correctness.
- SecureStore keys owned by the app: `supabase_token`, `supabase_refresh_token`, and `biometric_unlock_enabled` (the opt-in flag for `BiometricUnlockGate`, owned by `src/hooks/useBiometricGate.ts`).
- `403 { code: 'LOCKED_DUNNING' }` (Smart Dunning v2 Day-10 lockout) is caught in the response interceptor. It reports to `dunningLockoutStore` with the backend request id and sets a specific `error.message`. The app shows one lockout screen (`src/entitlements/dunning`) and individual screens do not render their own error for it.
