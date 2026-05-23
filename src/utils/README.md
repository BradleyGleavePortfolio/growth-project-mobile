# Utils

Helpers used across the app. The rule of thumb: if a piece of logic is reused by two or more screens, or talks to a platform API (auth, notifications, haptics), it lives here.

## Purpose

- Carry the auth shape that screens lean on without coupling them to Supabase: `googleAuth`, `supabaseAuth`, `authEvents`.
- Own the platform integrations: `notifications`, `haptics`, `googleAuth`'s WebBrowser dance.
- Hold pure helpers that are easy to test: `date`, `nutrition`, `weekUtils`, `log/*`.
- Keep the AI Guide's mobile-side glue isolated in `aiGuide.ts`. The mobile app never assembles a prompt — this helper just calls `aiApi.chat` and packages the response back as a `ChatMessage`.
- Provide the auth-event bus that lets sign-in / sign-out re-bootstrap `RootNavigator` from anywhere in the tree.

## Key files

### Auth and identity

| File | What it does |
| --- | --- |
| `googleAuth.ts` | Supabase OAuth via `expo-auth-session` + `expo-web-browser`. Builds the redirect URI (`tgp://auth/callback`), opens the consent screen, parses tokens out of the redirect URL (handles both error and success fragments), persists tokens through `secureStorage`, then calls `/auth/google` (with optional invite code) to upsert the backend user. |
| `supabaseAuth.ts` | Thin Supabase wrapper for password change. Only loaded when actually needed so `supabase-js` stays out of the cold-start path. |
| `authEvents.ts` | Tiny event bus: `onAuthChange`, `on('logout' | 'login', …)`, `emit(event?)`. The single mechanism `RootNavigator` listens on. |
| `authErrorMessage.ts` | `toFriendlyAuthError(err)` — single mapping from raw Supabase / Google OAuth / network / backend error strings (and `Error` instances, and `null` / `undefined`) into the quiet copy the auth screens render. Cancellations resolve to a sentinel that callers ignore so the UI stays silent. Wired into `LoginScreen` and `CreateAccountScreen`. Contract — including `access_denied`, `redirect_uri_mismatch`, invalid credentials, unconfirmed email, rate limiting, and unknown-error fallback — is asserted in `src/utils/__tests__/authErrorMessage.test.ts`. |
| `rbac.ts` | `canAccessResource(currentUser, resourceUserId, resourceCoachId)` — client sees own data, coach sees their clients' data. Defensive client-side check; the backend enforces the same rule by JWT. |

### Platform

| File | What it does |
| --- | --- |
| `notifications.ts` | Configures Expo notification handler, creates Android channels (`default`, `water`, `fasting`), requests runtime permission, schedules and cancels local notifications. |
| `haptics.ts` | Named haptic helpers (`mediumTap`, `successTap`, `warningTap`, `errorTap`). |
| `foodImages.ts` | Resolves remote food image URLs with a stable fallback. |

### AI Guide

| File | What it does |
| --- | --- |
| `aiGuide.ts` | `getAIResponse(message, history)` calls `aiApi.chat` and shapes the result into a `ChatMessage`. The mobile app does not pass any structured context here — the backend attaches it server-side. |

### Onboarding

| File | What it does |
| --- | --- |
| `onboardingStore.ts` | AsyncStorage helpers around the `onboarding_data` key. Used by both lean and legacy flows. |

### Pure helpers

| File | What it does |
| --- | --- |
| `date.ts` | `getTodayString`, `formatRelative`, `generateId`, week math, `bucketDateLocal` (timezone-aware day key). |
| `nutrition.ts` | TDEE / macro target math. Pure functions, fully unit-tested. |
| `weekUtils.ts` | Week-bucket helpers shared by Progress and Report. |
| `log/*` | Small helpers used by the Log screen — `mapFoodItem`, `macros`, `types`. |

## Data flow

```
Login screen ──► googleAuth.signInWithGoogle({ inviteCode? })
                     │
                     ├─► WebBrowser.openAuthSessionAsync(supabaseAuthUrl, redirectUri)
                     ├─► parse hash / query for tokens or error
                     ├─► supabase.auth.setSession(...)
                     ├─► secureStorage.setItem('supabase_token' | 'supabase_refresh_token', ...)
                     ├─► authApi.googleAuth(token, inviteCode?)
                     │     └─ fallback: authApi.attachInviteCode(code) if user.coach_id missing
                     └─► resolves with { success, access_token, user, is_new_user }

Sign-out path ──► services/authActions.signOut()
                  │
                  ├─► AsyncStorage.multiRemove(SIGN_OUT_KEYS)
                  ├─► setSentryUser(null)
                  ├─► analytics.reset()
                  └─► authEvents.emit('logout')
                          │
                          └─► RootNavigator.bootstrapAuth re-runs ─► AuthNavigator

App.tsx boot ──► notifications.requestNotificationPermissions()
              ├─ Android: setNotificationChannelAsync('default' | 'water' | 'fasting')
              └─ ask runtime permission (idempotent — Android only fires once)
```

## App-store / deep-link dependencies

- The Google sign-in redirect URI `tgp://auth/callback` must be allowlisted in Supabase auth → URL configuration. The native Google SDK is **not** used; there is no per-platform Google client id in this codebase.
- `notifications.ts` is the source of the runtime permission request the Play Console expects to see in `App.tsx`. The use case for the listing is "personal communications → in-app messages" (coach DMs, milestone reminders, log nudges) — not marketing.
- Three Android notification channels are pre-created (`default`, `water`, `fasting`). Adding a new channel is a Play-policy event because each channel shows up in the user's per-app notification settings.

## Security and tenancy

- `googleAuth.ts` reads the Supabase URL + anon key from `config/env.ts`. The OAuth secret lives in the Supabase dashboard, not in this codebase.
- The redirect URL parser checks **both** the hash fragment and the query string for `error` / `error_description`. Some OAuth return paths put errors in the query, and a missed parse used to surface as a generic "no access token received" message.
- `rbac.ts` is defensive only. Authoritative authorisation is server-side via JWT-scoped guards. A tampered local user object cannot grant access.
- `authEvents.ts` is in-process only. There is no IPC, no broadcast, no notification side-effect.

## Environment variables

| Variable | Read by | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `googleAuth.ts`, `supabaseAuth.ts` | Build the OAuth authorize URL and the supabase client instance for password updates. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | same | Anon JWT for the Supabase client. |

Both are required; missing values throw at module load via `config/env.ts`.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Google sign-in returns "Sign-in was cancelled" | User dismissed the WebBrowser sheet | Expected — return value `{ success: false }`. |
| Google sign-in returns an `access_denied: …` error | Supabase OAuth rejected the consent (e.g. consent screen still in `Testing`) | Add the user as a tester in Google Cloud Console, or move the OAuth client to `Production`. |
| Sign-in succeeds but `user.coach_id` is missing despite an invite code | Backend `/auth/google` doesn't yet support the invite arg | Defensive second pass calls `attachInviteCode`; if both miss, the user lands on `RoleSelection` and can paste the code there. |
| Notification permission prompt fires every launch | Some other code is calling `requestNotificationPermissions` outside the boot sequence | The helper is idempotent on Android — the OS shows the prompt once. If it re-prompts, find the rogue caller. |
| `authEvents.emit('logout')` does nothing | No listener registered (e.g. `RootNavigator` not yet mounted) | The bus is fire-and-forget by design. The first `bootstrapAuth` call runs on `App.tsx` mount and reads storage directly. |

## Tests

```bash
npm test
```

Unit tests live in `utils/__tests__/` for the pure helpers (`date`, `nutrition`, `weekUtils`). The platform helpers (`googleAuth`, `notifications`) are exercised by the smoke matrix.

## Release notes

- Stale env vars `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS/ANDROID` from a previous round are not read anywhere. They were removed from `.env.example` deliberately — do not reintroduce them. The mobile build does **not** ship a native Google SDK.
- `aiGuide.ts` is the only place that talks to the AI surface from outside `services/api.ts`. If any future feature wants to send a prompt directly, route it through here so the structured-context contract stays intact.
- Notification channel ids are stable contracts. Renaming `water` → `hydration` (for example) would orphan any user who has already toggled the channel in OS settings; new channels should be added alongside, not replacing the old ones.
| `appleAuth.ts` | Apple Sign-In via `expo-apple-authentication` (iOS only). `signInAsync` returns an Apple-signed identity token; the helper POSTs it to `/auth/apple`, persists the returned session through `secureStorage`, and surfaces the same shape as `signInWithGoogle`. App Store policy mandates this whenever any other third-party sign-in is offered. |
