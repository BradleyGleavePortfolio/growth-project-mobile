# Auth screens

Pre-login surface area: welcome, login, invite-gated signup, password reset, and one-time role selection. Everything in this folder is mounted under `AuthNavigator` and is the only place where the user is allowed to be without a backend session.

## Purpose

- Land an unauthenticated user on a calm welcome screen.
- Sign them in (email/password, Google through Supabase OAuth, or Apple Sign-In on iOS).
- Sign them up — invite-gated by default. The signup form mirrors whatever the backend returns from `/auth/signup-policy`, so flipping a server flag changes the form without a release.
- Capture a deep-linked invite code (`tgp://join/<code>` or `https://app.trygrowthproject.com/join/<code>`) and prefill the signup form so the user only fills in name, email, and password.
- Pin the new account to its coach. Either the dedicated `signupWithCode` route stamps `coach_id` atomically at signup time, or the codeless flow reaches `RoleSelection` where the user can attach a code post-hoc.
- Run the password-reset flow (Supabase magic link).

## Key files

| File | What it does |
| --- | --- |
| `WelcomeScreen.tsx` | Scrollable bone landing with an outlined GP mark, one Cormorant title, forest "Sign in" → Login and text "Create account" → CreateAccount. Optional coach-code note retained. Uses semantic theme colors. |
| `LoginScreen.tsx` | Hairline email/password form with Inter labels and one forest sign-in action. Calls `authApi.login`, persists tokens, hands off to `RootNavigator`. Google button delegates to `signInWithGoogle`; provider sizing, typography and handlers are unchanged. Apple button (iOS only) delegates to `signInWithApple` and POSTs the identity token to `/auth/apple`. While the policy has `role_choice`, both provider buttons first ask "Already have an account?" with secondary text actions. Forgot password, signup, failure support and coach-recovery actions remain reachable. Uses semantic theme colors; error mapping is unchanged. |
| `CreateAccountScreen.tsx` | Signup: optional role step (only when the policy has `role_choice` and no invite code), register (form), then verify (poll until email confirmed). Reads `/auth/signup-policy` on mount; falls back to "require invite" on failure. Auto-previews invite codes from deep-link params. Apple Sign-Up button (iOS only) is required by App Store Review whenever Google sign-in is offered. |
| `ForgotPasswordScreen.tsx` | Scrollable, keyboard-aware hairline form for `/auth/forgot-password`. Submission confirms only the request, never mail delivery; Contact support → SupportInbox and Back to login → Login remain available. Semantic colors, Inter controls, 44 pt back target. |
| `ResetPasswordScreen.tsx` | Scrollable, keyboard-aware recovery-link form with hairline password inputs, visibility toggle and forest update action. Token gate, validator, Supabase session/update/sign-out and error handling are unchanged. Invalid-link back and success login routes remain available. Semantic colors and Inter controls. |
| `EmailVerifiedScreen.tsx` | Landing for the sign-up confirmation link `tgp://verified` (HUNT-01-124). Says the email is confirmed and offers Sign in, or Continue back to an open sign-up screen so "I verified my email" finishes. An expired or used link (`error_code=otp_expired`) gets its own copy and Contact support. The linking config drops the session tokens Supabase appends (`emailVerifiedPath` in `navigation/deepLinkUtils.ts`). Supabase must allow-list `tgp://verified` under Authentication > URL Configuration > Redirect URLs. |
| `RoleSelectionScreen.tsx` | One-shot screen that fires after a Google sign-in or codeless email signup. Hardcodes `selectRole('student', …)` — there is no self-serve "Become a coach" surface. Shows the C13 `signupNotice` (param or persisted) when a role request did not end as chosen. |

## Endpoints consumed

| Method | Path | Auth | Request body | Response shape |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/login` | none | `{ email, password }` | `{ access_token, refresh_token, user }` |
| `POST` | `/auth/register` | none | `{ email, password, name, phone?, invite_code?, intended_role? }` (`intended_role` only when the policy has `role_choice` and there is no code) | `{ requires_verification, role? }` (`role` from backend #597) |
| `POST` | `/auth/signup-with-code` | none | `{ email, password, name, phone?, invite_code }` | `{ user }` |
| `POST` | `/auth/google` | none | `{ token, invite_code? }` or `{ token, intended_role? }` (never both) | `{ access_token, refresh_token, user, is_new_user }` |
| `POST` | `/auth/apple` | none | `{ token, full_name?: string, invite_code? }` plus `intended_role?` only when codeless and the policy has `role_choice` (only keys the live DTO whitelists; see `buildAppleAuthBody`) | `{ access_token, refresh_token, user, is_new_user, invite_attached?, invite_attach_error? }` |
| `POST` | `/auth/select-role` | JWT | `{ role, coach_code? }` | `{ user }` |
| `POST` | `/auth/attach-invite-code` | JWT | `{ invite_code }` | `{ user }` |
| `POST` | `/auth/forgot-password` | none | `{ email }` | `{ sent: true }` |
| `POST` | `/auth/validate-invite-code` | none | `{ code }` | `InvitePreview` |
| `GET` | `/invite/:code/preview` | none | — | `InvitePreview` |
| `GET` | `/auth/signup-policy` | none | — | `{ invite_code_required, coach_code_required, providers[], role_choice?, role_choice_field?, role_choice_values? }` (read via `lib/signupPolicy.normalizeSignupPolicy`; legacy `require_invite_code` / `google_signin_enabled` are a fallback only; `role_choice` defaults to off) |

## Screens and state machine

| Screen | Entry condition | Exit condition |
| --- | --- | --- |
| `WelcomeScreen` | No session token in SecureStore | Taps "Sign in" → `LoginScreen`. Taps "Create account" → `CreateAccountScreen`. |
| `LoginScreen` | From WelcomeScreen | Successful login → `authEvents.emit()`. |
| `CreateAccountScreen` | From WelcomeScreen or deep link with invite code | Successful signup + email verify → `authEvents.emit()`. New/unroled user → `RoleSelectionScreen`. |
| `ForgotPasswordScreen` | From LoginScreen | Request-submitted state (delivery not confirmed) → support or `LoginScreen`. |
| `RoleSelectionScreen` | `needs_role_selection === 'true'` in AsyncStorage | Role saved → `needs_role_selection` cleared → `authEvents.emit()`. |

## Data flow

```
Welcome ─► Login ─► (set token) ─► RootNavigator.bootstrapAuth
            │
            ├─► Google button ─► utils/googleAuth.signInWithGoogle
            │                     │
            │                     ├─► Supabase OAuth in WebBrowser
            │                     ├─► /auth/google { token, invite_code? }
            │                     └─► (new user) ─► RoleSelection
            │
            └─► Apple button (iOS) ─► utils/appleAuth.signInWithApple
                                       │
                                       ├─► expo-apple-authentication native sheet
                                       ├─► /auth/apple { token, … }
                                       └─► (new user) ─► RoleSelection

Welcome ─► CreateAccount ─► /auth/signup-policy            (gate)
                          ─► /auth/validate-invite-code    (preflight)
                          ─► /auth/signup-with-code OR /auth/register
                          ─► (verify step polls /auth/login until 200)
                          ─► RoleSelection (writes needs_role_selection=true)

Deep link tgp://join/<code> ───────► CreateAccount route param invite_code
Universal https://.../join/<code> ─►   (RootNavigator linking config)
```

Persisted state, in order of write:

- `pending_email` (AsyncStorage) — set when the verify step starts so the user can resume after killing the app.
- `supabase_token` / `supabase_refresh_token` — written via `secureStorage` (Keychain / Keystore), never plain AsyncStorage.
- `user_data` — JSON blob with `{ id, email, name, role, coach_id }`.
- `needs_role_selection` — sentinel that keeps `RootNavigator` in the `unauthenticated` branch until `RoleSelectionScreen` clears it.

## App-store / deep-link dependencies

- The signup screen is the only screen reachable through a deep link; the linking config in `navigation/RootNavigator.tsx` only registers the unauthenticated path. A signed-in user opening a `tgp://join/<code>` link is a no-op until they sign out.
- For Android App Links to verify silently, `assetlinks.json` must be hosted at `https://app.trygrowthproject.com/.well-known/assetlinks.json`. See `docs/well-known/README.md`.
- For iOS Universal Links, `apple-app-site-association` must be hosted at the same `.well-known` path.
- The Supabase OAuth redirect URI used by `signInWithGoogle` is `tgp://auth/callback`. It must be allowlisted in the Supabase auth dashboard, otherwise Google returns the user to a blank page.
- **Apple Sign-In (one-time portal steps):** In Apple Developer portal → App IDs → `com.growthproject.app` → enable "Sign In with Apple" capability. Regenerate the provisioning profile (`eas build` picks it up automatically). In Supabase Dashboard → Auth → Providers → Apple: enable, paste the Apple Services ID and key. The mobile client does not embed an Apple client ID; verification happens server-side at `/auth/apple`.

## Security and tenancy

- The mobile build does **not** embed any Google client ID. Sign-in is brokered entirely through Supabase. The OAuth secret lives in the Supabase dashboard.
- Invite codes are validated server-side. The mobile validation call (`/auth/validate-invite-code`) is a UX preflight; the authoritative check is the `signupWithCode` endpoint, which stamps `coach_id` in the same transaction that creates the user.
- Codeless signups are allowed only when `/auth/signup-policy` returns `invite_code_required: false`. If the policy fetch fails, the form falls back to the strictest setting — never accidentally let a codeless client through.
- `RoleSelectionScreen` only ever calls `selectRole('student', …)`. There is no client-side path to elevate to a coach role.
- Passwords are checked against four rules client-side (length, uppercase, digit, symbol) before submission. The backend re-validates.
- Raw upstream auth errors are never echoed to the UI. `LoginScreen` and `CreateAccountScreen` route every error through `utils/authErrorMessage.toFriendlyAuthError`, which maps Supabase strings, Google OAuth (`access_denied`, `redirect_uri_mismatch`), network failures, and our backend responses into safe, quiet copy. Cancellations stay silent — no banner, no alert, no jargon. See `src/utils/__tests__/authErrorMessage.test.ts` for the contract.
- Apple identity tokens are never logged client-side and are never written to AsyncStorage. The token goes directly from `expo-apple-authentication` to the POST body, and the backend session tokens that come back are written to `expo-secure-store` (Keychain/Keystore).

## Environment variables

| Variable | Required | Read by | Purpose |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | yes (non-dev) | `services/api.ts` | All `authApi.*` calls go through this base URL. |
| `EXPO_PUBLIC_SUPABASE_URL` | yes | `utils/googleAuth.ts`, `services/api.ts` | Builds the Supabase OAuth authorize URL and the refresh client. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | yes | same | Anon JWT for Supabase client constructor. |

Apple Sign-In has no mobile-side env vars — the Apple bundle ID is read from `app.json` at build time by `expo-apple-authentication`. The server-side Apple JWKS verification uses the Apple Team ID and bundle ID configured in the backend (`APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` on the backend env).

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| "Cannot reach server" on Login | Backend cold start (Fly.io free tier ~25 s) or no network | Retry — the form keeps state. |
| "An invite code from your coach is required" | `invite_code_required: true` from policy and the field is empty | User must obtain a code from their coach. |
| "That invite code is not valid" | Code expired, revoked, or `max_uses` reached | Coach issues a new code from `coach/InviteCodesScreen`. |
| "Email not yet verified" on the verify step | User has not opened the Supabase confirmation email | Re-tap the verify button after opening the link. |
| Google flow returns to the app on a blank screen | Redirect URI not allowlisted in Supabase | Add `tgp://auth/callback` (and the universal-link URL if used) to Supabase auth → URL configuration. |
| Apple Sign-In sheet does not appear | Device does not support Sign in with Apple, or `ios.usesAppleSignIn` not set in `app.json` | The `AppleSignInButton` renders nothing when `isAvailableAsync()` returns false; no user-visible error. |
| "Apple sign-in is temporarily unavailable" | Backend `/auth/apple` returned an error | Backend issue; errors are routed through `toFriendlyAuthError` — raw token never shown. |
| RoleSelection asked twice | `needs_role_selection` was not cleared on first save | Clearing happens inside `RoleSelectionScreen.handleContinue`; if it crashed mid-write, `RootNavigator` will route the user back here on next launch. |

## Tests

| Test file | What it asserts |
| --- | --- |
| `src/utils/__tests__/appleAuth.test.ts` | Apple sign-in happy path (token persisted to SecureStore), user cancellation (silent, no API call), backend error (friendly message returned), non-iOS guard (rejects immediately without calling native sheet). |
| `src/hooks/__tests__/useBiometricGate.test.ts` | Opt-in off → unlocked without biometric prompt. Opt-in on + success → unlocked. Opt-in on + failure → stays locked, retry works. No hardware → unlocked (never locks out). Not enrolled → unlocked (never locks out). |
| `src/utils/__tests__/authErrorMessage.test.ts` | Maps Supabase, Google OAuth, network, and backend error strings to quiet human copy. Cancellation returns `cancelled: true`. |

Run:

```bash
npm test
npm run typecheck
npm run lint
```

## Release notes

- The signup form is invite-gated by default. Reviewers (Play / App Store) cannot self-register; either supply pre-created accounts or a working invite code in the listing's "App access" notes. See `PLAY_STORE_READINESS.md` §9.
- Welcome surfaces a quiet *"By invitation only — request access"* mailto link, and `CreateAccountScreen` shows a *"Don't have a code? Request access"* hint under the invite-code field when the policy requires one. There is no fake self-serve flow — the access posture is legible.
- The Google button is shown only when `/auth/signup-policy` `providers` includes `google` (strict default: hidden). This is the kill switch if Supabase OAuth ever needs to be cut without a release.
- Deep links into the signup screen depend on hosted `assetlinks.json` / `apple-app-site-association`. Until those go live, the `https://` form opens a chooser; the `tgp://` form works because it does not need verification.
- The Apple Sign-In button renders nothing on Android and on iOS devices where `isAvailableAsync()` returns false (very old hardware, non-Apple-ID accounts). The layout does not shift — the container has a `minHeight: 48` so there is no jump.

## Known limits / follow-ups

- Manual on-device verification of Apple Sign-In requires a real iOS device; the native sheet does not work in most simulator configurations. Confirm on device before marking the PR ready for App Store submission.
- The Apple Developer portal capability ("Sign In with Apple" on `com.growthproject.app`) must be enabled by the account owner before the production build can call the native sheet. EAS will regenerate the provisioning profile automatically on the next `eas build --platform ios --profile production`.

## Invite attach failures (C03)

`/auth/signup-with-code` (and `/auth/apple`) may return `invite_attached: false` plus `invite_attach_error`. The account exists but has no coach. CreateAccount never continues silently: after email verification (or Apple success) it replaces to `RoleSelection` with `{ inviteAttachError, inviteCode }`. RoleSelection then shows a retry banner with friendly copy (`lib/inviteAttachOutcome.inviteAttachErrorMessage`, never the raw reason), prefills the code, and requires a code to continue. An explicit "Continue without a coach for now" link is offered only when the live policy is codeless.

## Paste invite code

Both CreateAccount and RoleSelection have a "Paste invite code" button (`components/invite/PasteInviteCodeButton`, expo-clipboard). The clipboard is read only on tap. It accepts a bare code (`GP-XXXX`) or a join link (`https://app.trygrowthproject.com/join/<code>`, `tgp://join/<code>`, `?code=`); see `lib/inviteCodeInput.extractInviteCode`.

## Signup role choice (C13, backend #597)

Owner ruling (2026-09-30 11:44): anyone can choose client or coach at signup; an invite code always means client. Role choice happens **only at account creation**; the backend fixes the role when it inserts the User row and no auth endpoint changes it later.

**Gate.** The step exists only when the live `GET /auth/signup-policy` says `role_choice: true` (and, when present, `role_choice_field === 'intended_role'` and `role_choice_values` contains both `client` and `coach`); see `lib/signupPolicy.readRoleChoice`. Anything else (the current production backend, `SIGNUP_ROLE_CHOICE_ENABLED=false`, a failed GET with nothing cached, a descriptor this build does not speak) is `roleChoice: false`: no role step, no `intended_role` on any request, exactly the pre-C13 flow. CreateAccount holds the form back (`signup-policy-loading`) until the policy answers, because it cannot know which first step to show.

**Flow (role choice on).**
- `CreateAccount` without a code: "How will you use the app?" (`components/auth/RoleChoice.tsx`) → "I'm here to train" (client form, invite code optional/required per policy) or "I coach clients" (coach form: title "Create your coach account", no code field). A "Coach clients instead?" / "Here to train instead?" link returns to the choice.
- Arriving with `route.params.invite_code` (join link, QR, universal link): the choice is skipped, the user is a client, and a link that arrives while the coach form is open switches to the client form with the code filled in.
- A code typed or pasted into the client form also means client: the coach link is replaced by "An invite code always means a client account." so a code is never silently dropped by switching roles.

**Wire.** `lib/intendedRole.intendedRoleForRequest(policy.roleChoice, chosen, hasInviteCode)` decides what is sent: `undefined` (field omitted) unless the policy allows it and no code is involved. `/auth/signup-with-code` never carries the field; `/auth/register`, `/auth/apple`, `/auth/google` carry `intended_role: 'client' | 'coach'` only when codeless. With a code, `authApi.googleAuth`/`signInWithApple` drop the field regardless of what the caller passed.

**No silent coach-to-client fallback.** `lib/intendedRole.postWithIntendedRole` retries once without the field only for `'client'` (identical outcome). For `'coach'` an unknown-field 400 (`forbidNonWhitelisted`, which rejects before any handler runs, so nothing was created) becomes `CoachSignupUnavailableError` / `error_code: 'coach_signup_unavailable'` on the Apple and Google results, and CreateAccount shows "Coach sign-up is not available right now. No account was created. …". `googleAuth` also drops the provider session in that case instead of returning a "signed-in" basic user.

**Server-confirmed role only.** `/auth/register` (#597) returns `role`; if the user chose coach and it is not `'coach'`, the verify step shows `coach-request-not-applied-notice`. After a session exists, `routeAfterAuth` routes by `user.role`: `'coach'` → clear `needs_role_selection`, emit `authEvents`, RootNavigator mounts CoachNavigator; otherwise → RoleSelection. `is_new_user === false` on a provider result means the account already existed, so the choice did not apply. The app never calls `selectRole('coach')`.

**Unconfirmed outcome is never reported as a client account (fix round 2, Sol B1).** For a coach request, any backend failure after the Google session (5xx, network, timeout, a response lost after the server committed) makes `signInWithGoogle` return `error_code: 'coach_signup_unconfirmed'`, drop the provider session and clear `user_data`; CreateAccount says "We could not confirm your coach account … An account may or may not have been created. Try again with the same sign-in …". It never says "no account was created" (the server may have committed) and never "created as a client". A retry is safe: if the account exists, `/auth/google` answers with it and its role. `routeAfterAuth` applies the same rule to any provider/email result on the coach form whose `user.role` is missing. Only the ValidationPipe's exact `property intended_role should not exist` refusal counts as "nothing was created" (`isUnknownIntendedRoleError`, Sol C3). Fix round 7 removes the legacy non-coach Google fallback (a provisional Supabase user returned as `success: true, server_confirmed: false`): every backend failure on `/auth/google` now drops the provider session and `user_data` and returns `success: false` with the sanitised `error_detail`, so Login and CreateAccount map it or show a reference with Contact support and report it once to Sentry.

**A policy change mid-flow never switches a coach to a client (fix round 2, Sol B2).** If the cached policy offered the choice, the user chose coach, and the live policy then says `role_choice: false`, CreateAccount keeps the coach intent and shows the `coach-unavailable` step: "Coach sign-up is not available right now … No account has been created" with "Create a client account instead" (explicit re-choice) and "Check again" (re-reads the policy; returns to the coach form if it is back). The form, Apple and Google are not reachable from that step. A live disable before any coach choice still continues as a client.

**Nothing is reported while a request is in flight (fix round 3, Sol B1-R2 / Opus C1).** From the moment Create account, Apple or Google is tapped until that request settles, CreateAccount holds any live policy answer (`deferredPolicyRef`), ignores further submissions from any button, and keeps the role link inert. The held answer is applied after the request settles, with that request's own outcome:
- success: the request's answer decides (verify step, CoachNavigator, or the `coach_request_not_applied` notice); no withdrawal notice.
- server failure (a 4xx answer or the pre-handler refusal): the `coach-unavailable` step says the coach sign-up "was not completed" and offers "Create a client account instead" and "Check again". Only the proven pre-handler refusal says "No account was created".
- lost response (no answer, timeout, 5xx; `lib/intendedRole.classifyCoachSignupFailure`): the step says "we could not confirm what happened. An account may or may not have been created", offers "Sign in to check" (Login, email prefilled), "Check again" and "Contact support", and does not offer a client account until the earlier attempt is resolved.
- nothing sent (cancelled Apple/Google sheet, or no request yet): the round-2 copy, "No account has been created".
The submitted role is snapshotted per attempt (`coachAttemptRef`), so a later policy answer cannot change what the verify step or routing reports. Email coach signups with no answer now show the unconfirmed copy too, and `signInWithApple` returns `coach_signup_unconfirmed` for a coach request with no server answer (same rule as Google).

**Lost-response retry (fix round 3, Opus C4).** An unconfirmed coach attempt leaves a short-lived marker (`lib/coachSignupAttempt`, 30 minutes, bound to the method and, for email, the address; cleared on any server answer and on sign-out). If the safe retry then answers "existing account, not a coach", the notice is `coach_retry_not_applied` ("Coach sign-up was not applied to this account … Your earlier attempt may have created it", with Contact support), never `existing_account`. An email retry that answers 409 says the earlier attempt may have created the account and to sign in.

**Notices that must not be lost** (`lib/signupRoleNotice`). The kind is passed as `RoleSelection` param `signupNotice` *and* persisted in AsyncStorage (`signup_role_notice`); RoleSelection reads either and clears the stored copy once the role step completes (including the auto-skip for users who already have a coach). Kinds: `coach_request_not_applied`, `existing_account`, `coach_retry_not_applied`, `new_account_from_sign_in`. `coach_request_not_applied` and `coach_retry_not_applied` ask the user to contact support, so the verify step and RoleSelection show a "Contact support" link to `SupportInbox`, which is registered in `AuthNavigator` for this (fix round 2, Opus C4).

**Login screen providers.** The first Sign in with Apple / Continue with Google for a provider account creates the account (as a client) and fixes its role. While `roleChoice` is on (or the policy is still loading), tapping a provider button on Login first shows "Already have an account?" with "Yes, sign me in" (runs the provider, no `intended_role`) and "I am new, create an account" (→ CreateAccount, role step first). If the provider still reports `is_new_user: true` (and the server answered), the user is told (`new_account_from_sign_in`; the predicate is `roleChoice !== false`, the same as the confirm panel, so an unknown policy is covered: Opus C3) and continues as a client; there is no backend flag to refuse account creation on `/auth/apple`, so this is the residual case. With `roleChoice` off the Login buttons behave exactly as before.

**An unresolved attempt outlives its request (fix round 4, Sol B1-R3).** The marker now holds one entry per sign-in (method plus email for email; plus the provider email when Google or Apple gave one), and CreateAccount keeps `unresolvedCoachRef` for the life of the screen, loaded from the marker before the first policy answer is applied (so a remount knows too). While it is set, the coach-unavailable step is always the unconfirmed one ("An account may or may not have been created", Sign in to check, Check again, Contact support, no client account), whatever the latest request did: nothing sent, cancelled sheet, a refused retry, or a re-check. Only a server answer for the same sign-in resolves it.

**Shared reconciliation on Login (fix round 4, Sol B2-R3).** `reconcileCoachAttempt` (`lib/coachSignupAttempt`) is used by CreateAccount and by Login for email, Apple and Google. When a sign-in matches an unconfirmed coach attempt and the server answers with a non-coach account that already existed, Login shows "Coach sign-up was not applied" with Continue as a client and Contact support, and enters the client flow only after Continue. While it is shown the notice is persisted and `needs_role_selection` is set, so a cold start cannot enter the client app first. A server coach, a brand-new account, another method, another identity, or the Google legacy fallback (no server answer) are unaffected. RoleSelection no longer auto-skips past an unread notice for a user who already has a coach: it shows the notice with Continue (C1). Sign-out clears the stored notice.

**Email spelling (backend #597, Sol B-597-1).** CreateAccount and Login trim surrounding spaces. Case is left as typed (legacy rows may be mixed case), except that the verify step signs in with the address `/auth/register` returns when it is the same address ignoring case (#597 stores and returns the lower-case form), so it works whether or not the backend's password login is case-insensitive.

**Tests.** `lib/__tests__/intendedRole.test.ts`, `lib/__tests__/signupPolicy.test.ts` (role_choice block), `lib/__tests__/signupRoleNotice.test.ts`, `screens/auth/__tests__/CreateAccountScreen.test.tsx` (C13 block, F1–F5; "#306 fix round 2", "#306 fix round 3" (both audit probes) and "#306 fix round 4" blocks), `screens/auth/__tests__/LoginCoachAttemptRecovery.test.tsx`, `utils/__tests__/googleAuth.test.ts` (real utility: 500, network, response lost), `screens/auth/__tests__/LoginRoleChoiceGate.test.tsx`, `screens/auth/__tests__/RoleSelectionRetry.test.tsx` (notice cases), `utils/__tests__/appleAuth.test.ts`, `lib/__tests__/coachSignupAttempt.test.ts`, `services/__tests__/inviteFlow.test.ts`. Invite-code fixtures use the neutral `GP-TEST1`.
