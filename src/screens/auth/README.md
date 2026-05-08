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
| `WelcomeScreen.tsx` | Brand-first landing screen — bone background, Cormorant headline, "Get Started" / "Log In" CTAs. |
| `LoginScreen.tsx` | Email + password form. Calls `authApi.login`, persists tokens, hands off to `RootNavigator`. Google button delegates to `signInWithGoogle`. Apple button (iOS only) delegates to `signInWithApple` and POSTs the identity token to `/auth/apple`. |
| `CreateAccountScreen.tsx` | Two-step signup: register (form), then verify (poll until email confirmed). Reads `/auth/signup-policy` on mount; falls back to "require invite" on failure. Auto-previews invite codes from deep-link params. Apple Sign-Up button (iOS only) is required by App Store Review whenever Google sign-in is offered. |
| `ForgotPasswordScreen.tsx` | Triggers Supabase's reset-password flow via `/auth/forgot-password`. |
| `RoleSelectionScreen.tsx` | One-shot screen that fires after a Google sign-in or codeless email signup. Hardcodes `selectRole('student', …)` — there is no self-serve "Become a coach" surface. |

## Endpoints consumed

| Method | Path | Auth | Request body | Response shape |
| --- | --- | --- | --- | --- |
| `POST` | `/auth/login` | none | `{ email, password }` | `{ access_token, refresh_token, user }` |
| `POST` | `/auth/register` | none | `{ email, password, name, phone?, invite_code? }` | `{ user }` |
| `POST` | `/auth/signup-with-code` | none | `{ email, password, name, phone?, invite_code }` | `{ user }` |
| `POST` | `/auth/google` | none | `{ token, invite_code? }` | `{ access_token, refresh_token, user, is_new_user }` |
| `POST` | `/auth/apple` | none | `{ identity_token, authorization_code?, email?, full_name?, invite_code? }` | `{ access_token, refresh_token, user, is_new_user }` |
| `POST` | `/auth/select-role` | JWT | `{ role, coach_code? }` | `{ user }` |
| `POST` | `/auth/attach-invite-code` | JWT | `{ invite_code }` | `{ user }` |
| `POST` | `/auth/forgot-password` | none | `{ email }` | `{ sent: true }` |
| `POST` | `/auth/validate-invite-code` | none | `{ code }` | `InvitePreview` |
| `GET` | `/invite/:code/preview` | none | — | `InvitePreview` |
| `GET` | `/auth/signup-policy` | none | — | `{ require_invite_code, google_signin_enabled }` |

## Screens and state machine

| Screen | Entry condition | Exit condition |
| --- | --- | --- |
| `WelcomeScreen` | No session token in SecureStore | Taps "Log In" → `LoginScreen`. Taps "Get Started" → `CreateAccountScreen`. |
| `LoginScreen` | From WelcomeScreen | Successful login → `authEvents.emit()`. |
| `CreateAccountScreen` | From WelcomeScreen or deep link with invite code | Successful signup + email verify → `authEvents.emit()`. New/unroled user → `RoleSelectionScreen`. |
| `ForgotPasswordScreen` | From LoginScreen | Email sent toast → back to `LoginScreen`. |
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
                                       ├─► /auth/apple { identity_token, … }
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
- Codeless signups are allowed only when `/auth/signup-policy` returns `require_invite_code: false`. If the policy fetch fails, the form falls back to the strictest setting — never accidentally let a codeless client through.
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
| "An invite code from your coach is required" | `require_invite_code: true` from policy and the field is empty | User must obtain a code from their coach. |
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
- The Google button is hidden when `/auth/signup-policy` returns `google_signin_enabled: false`. This is the kill switch if Supabase OAuth ever needs to be cut without a release.
- Deep links into the signup screen depend on hosted `assetlinks.json` / `apple-app-site-association`. Until those go live, the `https://` form opens a chooser; the `tgp://` form works because it does not need verification.
- The Apple Sign-In button renders nothing on Android and on iOS devices where `isAvailableAsync()` returns false (very old hardware, non-Apple-ID accounts). The layout does not shift — the container has a `minHeight: 48` so there is no jump.

## Known limits / follow-ups

- Manual on-device verification of Apple Sign-In requires a real iOS device; the native sheet does not work in most simulator configurations. Confirm on device before marking the PR ready for App Store submission.
- The Apple Developer portal capability ("Sign In with Apple" on `com.growthproject.app`) must be enabled by the account owner before the production build can call the native sheet. EAS will regenerate the provisioning profile automatically on the next `eas build --platform ios --profile production`.
