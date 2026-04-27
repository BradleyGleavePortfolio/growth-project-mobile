# Auth screens

Pre-login surface area: welcome, login, invite-gated signup, password reset, and one-time role selection. Everything in this folder is mounted under `AuthNavigator` and is the only place where the user is allowed to be without a backend session.

## Purpose

- Land an unauthenticated user on a calm welcome screen.
- Sign them in (email/password or Google through Supabase OAuth).
- Sign them up — invite-gated by default. The signup form mirrors whatever the backend returns from `/auth/signup-policy`, so flipping a server flag changes the form without a release.
- Capture a deep-linked invite code (`tgp://join/<code>` or `https://app.trygrowthproject.com/join/<code>`) and prefill the signup form so the user only fills in name, email, and password.
- Pin the new account to its coach. Either the dedicated `signupWithCode` route stamps `coach_id` atomically at signup time, or the codeless flow reaches `RoleSelection` where the user can attach a code post-hoc.
- Run the password-reset flow (Supabase magic link).

## Key files

| File | What it does |
| --- | --- |
| `WelcomeScreen.tsx` | Brand-first landing screen — bone background, Cormorant headline, "Get Started" / "Log In" CTAs. |
| `LoginScreen.tsx` | Email + password form. Calls `authApi.login`, persists tokens, hands off to `RootNavigator`. Google button delegates to `signInWithGoogle`. |
| `CreateAccountScreen.tsx` | Two-step signup: register (form), then verify (poll until email confirmed). Reads `/auth/signup-policy` on mount; falls back to "require invite" on failure. Auto-previews invite codes from deep-link params. |
| `ForgotPasswordScreen.tsx` | Triggers Supabase's reset-password flow via `/auth/forgot-password`. |
| `RoleSelectionScreen.tsx` | One-shot screen that fires after a Google sign-in or codeless email signup. Hardcodes `selectRole('student', …)` — there is no self-serve "Become a coach" surface. |

## Data flow

```
Welcome ─► Login ─► (set token) ─► RootNavigator.bootstrapAuth
            │
            └─► Google button ─► utils/googleAuth.signInWithGoogle
                                   │
                                   ├─► Supabase OAuth in WebBrowser
                                   ├─► /auth/google { token, invite_code? }
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

## Security and tenancy

- The mobile build does **not** embed any Google client ID. Sign-in is brokered entirely through Supabase. The OAuth secret lives in the Supabase dashboard.
- Invite codes are validated server-side. The mobile validation call (`/auth/validate-invite-code`) is a UX preflight; the authoritative check is the `signupWithCode` endpoint, which stamps `coach_id` in the same transaction that creates the user.
- Codeless signups are allowed only when `/auth/signup-policy` returns `require_invite_code: false`. If the policy fetch fails, the form falls back to the strictest setting — never accidentally let a codeless client through.
- `RoleSelectionScreen` only ever calls `selectRole('student', …)`. There is no client-side path to elevate to a coach role.
- Passwords are checked against four rules client-side (length, uppercase, digit, symbol) before submission. The backend re-validates.

## Environment variables

| Variable | Read by | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | `services/api.ts` | All `authApi.*` calls go through this base URL. |
| `EXPO_PUBLIC_SUPABASE_URL` | `utils/googleAuth.ts`, `services/api.ts` | Builds the Supabase OAuth authorize URL and the refresh client. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | same | Anon JWT for Supabase client constructor. |

If any of the three are missing, `src/config/env.ts` throws at module load, which means the app never reaches the welcome screen — splash + native error. This loud-fail is intentional; a silent fallback is what shipped a hardcoded anon key in an earlier round.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| "Cannot reach server" on Login | Backend cold start (Fly.io free tier ~25 s) or no network | Retry — the form keeps state. |
| "An invite code from your coach is required" | `require_invite_code: true` from policy and the field is empty | User must obtain a code from their coach. |
| "That invite code is not valid" | Code expired, revoked, or `max_uses` reached | Coach issues a new code from `coach/InviteCodesScreen`. |
| "Email not yet verified" on the verify step | User has not opened the Supabase confirmation email | Re-tap the verify button after opening the link. |
| Google flow returns to the app on a blank screen | Redirect URI not allowlisted in Supabase | Add `tgp://auth/callback` (and the universal-link URL if used) to Supabase auth → URL configuration. |
| RoleSelection asked twice | `needs_role_selection` was not cleared on first save | Clearing happens inside `RoleSelectionScreen.handleContinue`; if it crashed mid-write, `RootNavigator` will route the user back here on next launch. |

## Tests

There are no jest tests for the auth screens themselves — they are integration-heavy (TextInput, navigation, network) and the smoke matrix in `docs/RELEASE_SMOKE.md` covers them manually. The closest unit coverage is in `src/utils/__tests__/` for the helpers these screens lean on. Run:

```bash
npm test
```

## Release notes

- The signup form is invite-gated by default. Reviewers (Play / App Store) cannot self-register; either supply pre-created accounts or a working invite code in the listing's "App access" notes. See `PLAY_STORE_READINESS.md` §9.
- The Google button is hidden when `/auth/signup-policy` returns `google_signin_enabled: false`. This is the kill switch if Supabase OAuth ever needs to be cut without a release.
- Deep links into the signup screen depend on hosted `assetlinks.json` / `apple-app-site-association`. Until those go live, the `https://` form opens a chooser; the `tgp://` form works because it does not need verification.
