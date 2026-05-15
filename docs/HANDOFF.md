# The Growth Project mobile app: handoff reference

A single document covering the variables, configuration, runtime contracts, and known gaps a new engineer needs to pick up `growth-project-mobile` cold. Module-level READMEs cover deeper behavior; this file is the index that ties them together.

Last refreshed: 2026-05-15.

## 1. Repo at a glance

- React Native 0.83 + Expo ~55, managed workflow.
- TypeScript strict (`tsconfig.json` extends `expo/tsconfig.base`, `strict: true`).
- Auth: Supabase (email/password + Google OAuth via Supabase, no native Google SDK).
- Backend: separate service at `EXPO_PUBLIC_API_URL`. Mobile only talks to it through `src/services/api.ts`.
- State: React Query (persisted) for server state, Zustand for a small set of cross-screen UI stores, AsyncStorage for flags, SecureStore for tokens, expo-sqlite for offline content (recipes, exercises, lessons).
- Navigation: React Navigation v7. Five bottom tabs (Home, Log, Plan, Workout, More) plus a stacked More section, plus auth, onboarding, and coach navigators.

## 2. Environment variables

All runtime configuration is read through `EXPO_PUBLIC_*` env vars at build time. Centralised loader: `src/config/env.ts`. Values must be set in `.env` for local dev and in EAS build env (or EAS Secrets) for `preview` / `production`.

### 2.1 Required (app fails to boot without these)

| Variable | Read by | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `src/config/env.ts`, `services/api.ts`, `services/realtime.ts`, `utils/googleAuth.ts`, `utils/supabaseAuth.ts` | Project URL of the Supabase instance. Throws at module load if missing. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | same | Anon JWT for the supabase-js client. Public by design (RLS gates all data); the service-role key is never bundled. |
| `EXPO_PUBLIC_API_URL` | `src/config/env.ts` (then everywhere through axios `baseURL`) | Backend API base URL. Required in non-dev builds. In dev, falls back to the Fly.io URL hardcoded in `src/config/env.ts` so a local boot without `.env` still works. |

The dev fallback is `https://backend-spring-lake-3890.fly.dev/api`. Treat that as a placeholder for local boots only; never rely on it in CI or any release-track build.

### 2.2 Optional

| Variable | Read by | Default behaviour when unset |
| --- | --- | --- |
| `EXPO_PUBLIC_SENTRY_DSN` | `services/sentry.ts` | Sentry stays uninitialised. `wrap()`, `captureError()`, `setSentryUser()` become no-ops. |
| `EXPO_PUBLIC_ENVIRONMENT` | `services/sentry.ts` | Tags Sentry events. Defaults to `'production'`. |
| `EXPO_PUBLIC_POSTHOG_KEY` | `App.tsx` (PostHogProvider) | Empty string disables PostHog at the SDK level. |
| `EXPO_PUBLIC_POSTHOG_HOST` | `App.tsx` | Defaults to `https://us.i.posthog.com`. |

### 2.3 Stale / forbidden

The following were referenced in earlier rounds and must not be added back:

- `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS`
- `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID`

Google sign-in is brokered entirely through Supabase. The mobile build embeds no per-platform Google client ID. The validator script `scripts/validate-app-config.js` fails the build if either key is declared as a real assignment in `.env.example`. An explanatory comment that names the variable is fine and is what currently ships.

### 2.4 Where to set them

- Local dev: copy `.env.example` to `.env` and fill in. Expo reads it at metro start.
- EAS builds: either an `env` block under each profile in `eas.json`, or an EAS Secret created via `eas secret:create --scope project --name FOO`.
- Test runs: `jest.setup.js` injects defaults for the three required variables so unit tests run without a real `.env`.

Run `npm run validate:config` before every EAS build. It catches missing required keys, stale forbidden keys, scheme/bundle/package drift, and missing intent-filter / associatedDomain entries.

## 3. `app.json`

Single source of truth for the native shell. Anything platform-specific is read from here at build time by Expo prebuild + EAS.

| Field | Value | Why it matters |
| --- | --- | --- |
| `expo.name` | `The Growth Project` | Visible app name. |
| `expo.slug` | `tgp-health-and-wellness` | EAS project slug. |
| `expo.scheme` | `tgp` | Custom-scheme deep links. `tgp://join/<code>` opens the signup screen. Must match `INVITE_CUSTOM_SCHEME` in `src/utils/deepLink.ts` and the `prefixes` in `src/navigation/RootNavigator.tsx`. |
| `expo.version` | semver | Bump on every release (visible to users). |
| `expo.ios.bundleIdentifier` | `com.growthproject.app` | Immutable once published. Used to template `apple-app-site-association`. |
| `expo.ios.buildNumber` | integer-as-string | Bump per TestFlight upload. |
| `expo.ios.associatedDomains` | `["applinks:app.trygrowthproject.com"]` | Required for iOS Universal Links to verify against the marketing host. |
| `expo.ios.infoPlist.NSCameraUsageDescription` | string | Required for barcode scanning. |
| `expo.ios.infoPlist.ITSAppUsesNonExemptEncryption` | `false` | Skips the export-compliance prompt on TestFlight. |
| `expo.android.package` | `com.growthproject.app` | Immutable once on Play. Templated into `assetlinks.json`. Must equal `expo.ios.bundleIdentifier`; the validator enforces this. |
| `expo.android.versionCode` | positive integer | Must increase monotonically per Play upload. We use `appVersionSource: "local"` so this is bumped manually. |
| `expo.android.intentFilters` | see below | Declares the deep-link surface on Android. |
| `expo.plugins` | `expo-sqlite`, `expo-web-browser`, `expo-font`, `expo-localization` | Required for SQLite, the OAuth in-app browser, custom font loading, and locale detection. The validator warns when any of the first three are absent. |
| `expo.extra.eas.projectId` | `a12c3345-cc8c-4c2c-9c57-711c10a57c1c` | EAS project binding. |
| `expo.owner` | `the-growth-project` | EAS account that owns the project. |

### 3.1 Android intent filters

```
{
  "action": "VIEW",
  "autoVerify": true,
  "data": [
    { "scheme": "tgp", "host": "join" },
    { "scheme": "https", "host": "app.trygrowthproject.com", "pathPrefix": "/join" }
  ],
  "category": ["BROWSABLE", "DEFAULT"]
}
```

Both shapes route to `CreateAccountScreen` via the linking config in `src/navigation/RootNavigator.tsx`:

```
prefixes: ['tgp://', 'https://app.trygrowthproject.com']
config: { screens: { CreateAccount: 'join/:invite_code?' } }
```

`autoVerify: true` requires `assetlinks.json` to be hosted at `https://app.trygrowthproject.com/.well-known/assetlinks.json` with the SHA-256 fingerprint of the Play App Signing key. iOS Universal Links require `apple-app-site-association` at the same well-known path with the bundle id. Templates live in `docs/well-known/`; `npm run validate:config` checks that they match the `app.json` values.

## 4. Auth, session, and role handling

### 4.1 State machine

`src/navigation/RootNavigator.tsx` runs `bootstrapAuth()` on mount and on every `authEvents` emit. The states it can land in:

- `loading`: initial.
- `unauthenticated`: no token, or `needs_role_selection === 'true'`.
- `onboarding`: token present, `user_data` parsed, `onboarding_complete !== 'true'`.
- `coach`: token present, `user_data.role === 'coach'`.
- `student`: token present, `user_data.role` anything else.

### 4.2 Storage keys

| Key | Storage | Owner | Cleared by `signOut()` |
| --- | --- | --- | --- |
| `supabase_token` | SecureStore (with AsyncStorage fallback on web) | `services/secureStorage.ts` | yes |
| `supabase_refresh_token` | SecureStore (token-refresh path also reads/writes the AsyncStorage copy for legacy reasons) | same | yes |
| `user_data` | AsyncStorage | written on login, Google sign-in, register | yes |
| `needs_role_selection` | AsyncStorage | written when a user lands on `RoleSelection` | yes |
| `onboarding_complete` | AsyncStorage | written by `OnboardingResults` on save | yes |
| `macro_targets` | AsyncStorage | written by onboarding results | yes |
| `pending_email` | AsyncStorage | written when CreateAccount enters the verify step | yes |
| `onboarding_data` | AsyncStorage | `utils/onboardingStore.ts` | not cleared (kept across reinstalls during onboarding only) |
| `TGP_RQ_CACHE_V1` | AsyncStorage | React Query persister | not cleared by signOut; React Query handles invalidation on sign-in |

The `SIGN_OUT_KEYS` array in `src/services/authActions.ts` is the canonical list. Adding a new auth-tied key means adding it there; the in-flight 401 logout path in `src/services/api.ts` clears `supabase_token` and `needs_role_selection` only and leaves the rest alone so a re-login lands the user back on Home.

### 4.3 Token refresh

The header comment in `src/services/api.ts` is canonical. Concurrency contract:

- One `refreshPromise` is in flight at any time. Concurrent 401s coalesce onto it.
- Refresh failure clears the access token and emits `authEvents.emit('logout')` exactly once (`loggedOutOnce` guards re-emits).
- The `_retry` flag prevents infinite loops if the retried request itself comes back 401.
- Refresh tokens are written by the access-token rotation path to AsyncStorage as well as SecureStore. The `services/secureStorage.ts` adapter migrates legacy AsyncStorage entries into SecureStore on first read.

### 4.4 Role handling

- Role lives on `user_data.role` (`'coach'` | `'client'` | `'student'`).
- `RoleSelectionScreen` only ever calls `authApi.selectRole('student', coachCode?)`. The mobile app has **no** in-app coach-promotion path. Coach and admin tier changes are handled by an OWNER through the web console (per-seat billing decision).
- `src/utils/rbac.ts` provides `canAccessResource(currentUser, resourceUserId, resourceCoachId)`: the only RBAC helper we use today. Clients can read their own resources; coaches can read resources whose `coachId` matches the coach's user id. Anything else returns `false`. The backend is the authoritative gate; this helper is a UX preflight.

### 4.5 Invite-gated signup

- `GET /auth/signup-policy` returns `{ require_invite_code: boolean, google_signin_enabled: boolean }`. `CreateAccountScreen` and `RoleSelectionScreen` both fetch it on mount.
- If the policy fetch fails, both screens fall back to the strictest setting (require code, Google enabled). This is intentional: never accidentally let a codeless client through.
- `GET /invite/<code>/preview` returns coach branding (name, business name, accent color, logo URL) so the signup screen can show the user *who* invited them before they enter a password. Falls back to `POST /auth/validate-invite-code` if preview is unavailable.
- `POST /auth/signup-with-code` is the preferred submit endpoint when an invite code is present. It stamps `coach_id` atomically. `POST /auth/register` is the codeless fallback.
- `POST /auth/google { token, invite_code? }` is the Google path. The backend should accept `invite_code` in the same call; the mobile client falls back to `POST /auth/attach-invite-code` if the single-call form is not yet supported on the deployed backend.

### 4.6 Google sign-in flow

`src/utils/googleAuth.ts` orchestrates:

1. Build a redirect URI via `AuthSession.makeRedirectUri({ scheme: 'tgp', path: 'auth/callback' })`. Resolves to `tgp://auth/callback` on a real device.
2. Open `https://<supabase-url>/auth/v1/authorize?provider=google&redirect_to=<redirect>` in `WebBrowser.openAuthSessionAsync`.
3. User picks a Google account on Google's consent screen.
4. Supabase exchanges the code, then redirects back to `tgp://auth/callback#access_token=...&refresh_token=...` (or `#error=...&error_description=...` on failure). The handler parses both shapes; OAuth errors are surfaced in the result, not silently shown as "No access token received".
5. Tokens are stored in SecureStore (access + refresh) and AsyncStorage (refresh, for the api.ts refresh path). User profile is upserted via `POST /auth/google { token, invite_code? }`.
6. If `coach_id` is still missing on the response and an invite code was supplied, the client retries via `POST /auth/attach-invite-code` (best-effort, non-fatal).

Required Supabase config: redirect URI `tgp://auth/callback` must be allowlisted under Authentication → URL Configuration. The Google OAuth web client (in Google Cloud Console) must list `https://<supabase-project-ref>.supabase.co/auth/v1/callback` as an authorised redirect URI. The mobile build does not embed any Google client material.

### 4.7 Password reset

`utils/supabaseAuth.ts → updateSupabasePassword(newPassword)` is used by Settings. It dynamically imports `@supabase/supabase-js`, hydrates a session from the stored access + refresh tokens, then calls `supabase.auth.updateUser({ password })`. The dynamic import keeps the supabase-js bundle out of the cold-start path for users who never change their password.

`POST /auth/forgot-password` (the magic-link path) is what `ForgotPasswordScreen` uses for the unauthenticated reset flow.

## 5. Deep links

### 5.1 Supported shapes

`src/utils/deepLink.ts` is the canonical parser for invite codes:

- `tgp://join/<code>`
- `tgp://join/<code>?ref=<source>`
- `https://app.trygrowthproject.com/join/<code>`
- `https://app.trygrowthproject.com/join` (no code, manual entry)
- `https://app.trygrowthproject.com/join/` (trailing slash, no code)

Coach package share links use a separate shape; `src/utils/packageShare.ts` builds them and `RootNavigator` routes them into the client `PackageCheckout` screen:

- `tgp://p/<shareToken>`
- `https://app.trygrowthproject.com/p/<shareToken>`

Anything else returns `null`. The parser deliberately does not throw on malformed input; a `null` result means "let the navigator handle it".

Constants exported by the module:

- `INVITE_CUSTOM_SCHEME = 'tgp'`
- `INVITE_UNIVERSAL_HOST = 'app.trygrowthproject.com'`
- `INVITE_PATH = '/join'`

These must stay in sync with `app.json` intent filters and the linking config in `RootNavigator.tsx`. `npm run validate:config` enforces it.

### 5.2 Building share links

`buildInviteUniversalLink(code)` returns the canonical `https://...` form. The coach-side share sheet must use this shape, not the `tgp://` form, so links forwarded over SMS / WhatsApp / email open the app via verified App Links / Universal Links rather than a chooser.

### 5.3 Hosted files

- `https://app.trygrowthproject.com/.well-known/assetlinks.json`: Android. Must contain the SHA-256 fingerprint of the Play App Signing key. Get it from `eas credentials → Android → Production → keystore`.
- `https://app.trygrowthproject.com/.well-known/apple-app-site-association`: iOS. Must list `<TeamID>.com.growthproject.app` under `applinks.details[].appIDs`.

Templates: `docs/well-known/assetlinks.json` and `docs/well-known/apple-app-site-association`. The fingerprint placeholder in `assetlinks.json` is `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`. Replace it on the marketing site before promoting a build that depends on autoverified App Links.

QA matrix: `docs/INVITE_DEEPLINK_QA.md`. Automated harness: `scripts/invite-qa.sh` (runs against the real prod backend + marketing site, no device required).

## 5.4 Payments surface (coach + client)

Coach-facing screens live under `src/screens/coach/payments/` and the client-facing checkout under `src/screens/client/PackageCheckoutScreen.tsx`. Typed API clients sit in `src/api/connectApi.ts` and `src/api/packagesApi.ts`.

| Screen | Backend route | Notes |
| --- | --- | --- |
| `CoachConnectScreen` | `GET / POST /v1/connect/accounts/*` (real-or-flagged) | Renders a `CONNECT_NOT_CONFIGURED` empty state when Stripe Connect is not provisioned for the environment. Otherwise opens the Stripe Express onboarding link / dashboard in `expo-web-browser`. |
| `CoachPackagesListScreen` | `GET /v1/coach/packages` | 404 → "Packages coming soon" empty state with `PACKAGES_NOT_CONFIGURED` surfaced verbatim. Otherwise lists packages with active/archived state. |
| `CoachPackageEditScreen` | `POST /v1/coach/packages`, `PATCH /v1/coach/packages/:id`, `POST .../archive` | Single screen for create + edit + archive + share. Share uses `buildPackageShareUrl()` to build the universal-link form. |
| `CoachPackageSubscribersScreen` | `GET /v1/coach/packages/:id/subscribers` | MRR + per-subscriber state (`active`, `past_due`, `canceled`, `trialing`). |
| `CoachEarningsScreen` | `GET /v1/coach/earnings` | Net pending payout + month-to-date + lifetime + per-package breakdown. |
| `CoachBillingScreen` (existing) | `GET /coach/billing/status` + `GET /v1/coach/me/billing` | Compact pill from the mobile route + invoice list from the BFF. Portal session via `POST /coach/billing/portal-session`. |
| `PackageCheckoutScreen` (client) | `GET /v1/packages/:shareToken`, `POST /v1/packages/:shareToken/checkout` | Stripe Checkout in `expo-web-browser` — managed-workflow safe. Response shape leaves room for a future PaymentSheet path. |

Real-or-flagged contract: every screen renders an actionable error state for `CONNECT_NOT_CONFIGURED`, `PACKAGES_NOT_CONFIGURED`, `STRIPE_NOT_CONFIGURED`, and `CONNECT_ONBOARDING_INCOMPLETE` rather than synthesising a fake success path. No screen claims a purchase has succeeded; that is the webhook's job.

## 6. AI context contract

`src/services/api.ts` defines `AIStructuredContext`:

```
interface AIStructuredContext {
  user: { id: string; first_name?: string; created_at?: string };
  coach?: { id: string; name?: string; business_name?: string };
  goals?: { primary?: string; calorie_target?: number; protein_g?: number };
  recent: {
    log_streak_days?: number;
    last_logged_at?: string | null;
    last_check_in_at?: string | null;
    habit_completion_7d?: number;
  };
  preferences?: { units?: 'metric' | 'imperial'; tone?: string };
}
```

Rules:

- The mobile app **never** assembles raw PII into prompts. It sends only the user's message string and an optional short conversation history.
- The backend attaches the structured context, persona, and guardrails before calling the AI provider. Any field above is the backend's responsibility to populate.
- The provider key (Perplexity, OpenAI, etc.) lives only on the backend; it is never shipped in the mobile bundle.
- `aiApi.chat(message, history?)` posts to `/ai/chat`. `aiApi.getStructuredContext()` fetches `/ai/structured-context` so the UI can show a "what your coach has shared" panel before a conversation starts. There is no longer a `/ai/context` endpoint.
- A small offline replier exists in `src/utils/aiGuide.ts` for the dev fallback; it is intent-keyword-based, lives entirely on the device, and never sends data anywhere. Production builds use the `/ai/chat` path.

## 7. State stores

| Store | File | Purpose | Reset on signOut |
| --- | --- | --- | --- |
| `useClientStore` | `src/store/clientStore.ts` | Day selection, food logs, daily totals, water ounces | yes (manual via `reset()`; wired into the screen that consumes it) |
| `useCoachStore` | `src/store/coachStore.ts` | Coach's clients list, search query, status filter | yes |
| `useFastingStore` | `src/store/fastingStore.ts` | Active fasting session, history, protocol | yes (in-memory only; durable state lives in `db/fastingDb`) |

The reset functions are part of the security contract: without them, the brief render between sign-in and a fresh `loadDayData` would expose the previous user's logs from memory. Adding a new store field means adding it to the store's `initialXState` so the reset wipes it.

React Query is the default for server state. New screens should reach for `useQuery`/`useMutation` from `@tanstack/react-query` first; only fall back to a Zustand store when the state is purely client-side and shared by two or more screens.

## 8. Theme / design tokens

Single source of truth: `src/theme/tokens.ts`. Re-exported via `src/theme/index.ts` with legacy aliases.

### 8.1 Token groups

- `colors`: old-money palette: `bone`, `cream`, `ink`, `charcoal`, `stone`, `forest`, `mutedGold`, `camel`, plus `success`, `warning`, `error` mapped to palette entries.
- `neutral`: 0-1000 ten-stop scale.
- `brand`: primary scale 50-800, base = `#2C4A36` (forest).
- `semantic`: `success`, `warning`, `danger`, `info` each with `bg`, `fg`, `border`, `icon`.
- `gold`: Founding / Inner Circle tier scale. Used only on badge typography, never as a fill.
- `typography`: Cormorant Garamond for headings (weight 400, never 700/800), Inter for body/UI. Roles: `display`, `h1`, `h2`, `h3`, `h4`, `body`, `bodyMd`, `bodySmall`, `caption`, `eyebrow`, `micro`.
- `spacing`: 4 px base grid: `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`.
- `radius`: luxury scale: `sm: 0` (buttons), `md: 2` (inputs), `lg: 4` (cards), `xl` and `2xl` remapped to `lg` for back-compat, `pill: 999` (small chips only).
- `shadows`: `sm`, `md`, `lg`. All use `#1A1A18` shadow color and capped opacities (<= 0.08).
- `motion`: durations `fast: 120`, `base: 400`, `slow: 800`, `deliberate: 1200`. Easing: `decel` (expo-out, primary), `smooth` (standard, sparingly).

### 8.2 Legacy exports

`src/theme/index.ts` re-exports the canonical tokens and also keeps these legacy named exports so existing components do not need to change imports:

- `Colors`: flat palette: `primary`, `primaryLight`, `primaryPale`, `primaryDark`, `accent`, `gold` (mapped to `mutedGold`), `orange` (mapped to `oxblood`), `dark` (`ink`), `background` (`bone`), `surface` (`cream`), `surfaceElevated`, `textMuted`, `textPrimary`, `textSecondary`, `textOnPrimary`, `success`, `warning`, `error`, `info`, `white` (`bone`, not `#FFFFFF`), `border`, `divider`, `cardShadow`, `goldLight`, `protein`, `carbs`, `fat`, `water`, `fiber`.
- `colors.{background,text,brand,feedback,border,data,shadow,transparent}`: grouped semantic tokens.
- `Typography`: flat role map (`hero`, `h1`, `h2`, `h3`, `body`, `bodyDark`, `label`, `caption`, `button`).
- `Spacing`: `xs/sm/md/lg/xl/xxl` (note: legacy uses `xxl: 48`; new code uses `'3xl': 48`).
- `Radius`: `sm/md/lg/xl/full` mirroring the new scale.
- `Shadow`: `card`, `button`.

### 8.3 Hard rules

- Never hardcode hex values in components. If a color you need is not in the token set, add it to `tokens.ts` first.
- Headings use weight 400 (Cormorant). Bumping a heading to 700/800 is the single most common amateur drift; reviewers flag it on sight.
- Radii on primary CTAs are `0`. Small chips use `pill: 999`. Anything between is suspicious.

### 8.4 Legacy-screen drift warning

Wave 2 introduced the luxury palette and radius scale. A handful of legacy fitness screens still reference the prior radius literals (16, 24) and pre-luxury color values. The Wave-3 cleanup target list lives in `FITNESS_RADIUS_HITS.md` (planned) and is referenced in a comment in `src/theme/tokens.ts`. The `xl` and `2xl` radius keys are aliased to `lg` (`4`) so the visual remains consistent even while imports are still pointing at the old keys. When you touch a legacy screen, prefer to migrate its imports to the new token names rather than introducing new uses of `xl`/`2xl`.

WCAG AA contrast matrix is documented inline at the top of `src/theme/tokens.ts`. Pairs that fail body-size contrast (`stone` and `mutedGold` on `bone`) are restricted to large or bold-only roles in the type system and must not be used for body copy.

### 8.5 Fonts

Loaded in `App.tsx` via `@expo-google-fonts/cormorant-garamond` and `@expo-google-fonts/inter`. Render is blocked until `fontsLoaded` so there is no flash of unstyled text. The native splash is held with `SplashScreen.preventAutoHideAsync()` and released once fonts resolve. The pair (Cormorant Garamond + Inter) is the open-source fallback for the commercial pair (GT Sectra + Söhne); never swap them in without updating the WCAG matrix.

## 9. Boot sequence

`App.tsx` is the single composition root:

1. `initSentry()`: reads `EXPO_PUBLIC_SENTRY_DSN`. No-op when missing.
2. `SplashScreen.preventAutoHideAsync()`.
3. `useFonts(...)`: block render until both font families resolve.
4. `initApp()` (effect): `initDatabase()` (creates tables, seeds exercises/recipes/foods/lessons/community), `requestNotificationPermissions()`, fires `track('app_opened')`. Errors are swallowed in production (Metro strips `__DEV__`).
5. Render `<ErrorBoundary><PostHogProvider><PersistQueryClientProvider><ThemeProvider><RootNavigator/>`.
6. `RootNavigator.bootstrapAuth()` resolves the `AuthState` from storage and mounts the matching navigator.
7. On offline → online transitions, `RootNavigator` calls `flushFoodLogQueue()` once.

The PostHog provider sits outside React Query so analytics fires regardless of cache state. The Persisted React Query provider sits inside the error boundary so a single screen's thrown query error does not take down the rest of the app. ThemeProvider must be inside the persisted provider because it calls `useFoundingNumber()`, which is itself a `useQuery`.

## 10. Play Internal Testing checklist

Pre-build:

- `versionCode` bumped past last Play upload (`jq '.expo.android.versionCode' app.json`).
- `version` bumped semver.
- `npm run validate:config` clean.
- EAS env profile lists the three required vars and **does not** list either `EXPO_PUBLIC_GOOGLE_CLIENT_ID_*` (`eas env:list --environment production`).
- Tree clean (`eas.json` has `requireCommit: true`).
- `npm run typecheck && npm run lint && npm test -- --ci --passWithNoTests` all green.

Install + first launch:

- Fresh emulator install via `adb install -r`.
- No `AndroidRuntime` / `FATAL` lines in `adb logcat`.
- Splash + Welcome render without flash.
- Boot succeeds (implicitly proves env vars are present, since `src/config/env.ts` throws on missing).
- Push permission prompt fires once on first launch and not on subsequent launches.

Full matrix: `docs/RELEASE_SMOKE.md`. Scripted subset: `scripts/release-smoke.sh`.

Invite-specific QA: `docs/INVITE_DEEPLINK_QA.md` and `scripts/invite-qa.sh`.

## 11. Known placeholders and verification gaps

These are the items a future engineer must resolve on real hardware or against the live infra. They are not blockers for code review but are blockers for a production release.

- **Play App Signing SHA-256 fingerprint**: `docs/well-known/assetlinks.json` ships with the literal `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`. The marketing site copy must be filled in (from `eas credentials`) before any build that relies on autoverified Android App Links is promoted. Until that is done, `https://app.trygrowthproject.com/join/<code>` opens an app chooser instead of the app silently.
- **Apple Team ID in AASA**: the `apple-app-site-association` template must list `<TeamID>.com.growthproject.app` once the team id is known. Same caveat as above for iOS Universal Links.
- **Privacy policy URL**: `https://app.trygrowthproject.com/privacy` is the intended host. Verify it is published before submitting the Play Data Safety form.
- **Google OAuth consent screen**: must be in `Production` state (not `Testing`) before GA. While it is in `Testing`, only allowlisted Google accounts can sign in.
- **Real-device Universal Link verification**: has not been performed yet. Once the well-known files are live, run `adb shell pm get-app-links com.growthproject.app` on Android and check Apple's AASA-CDN endpoint for iOS. Both checks are documented in `docs/INVITE_DEEPLINK_QA.md`.
- **Real-device Google sign-in**: has not been verified end-to-end on a production-signed build. The Supabase redirect URL `tgp://auth/callback` must be allowlisted in the Supabase dashboard before testing.
- **Sentry DSN in production EAS env**: `EXPO_PUBLIC_SENTRY_DSN` is currently optional. Production releases should set it; the boot will not fail without it but crashes will go uncaptured.
- **PostHog key in production EAS env**: same shape as Sentry. Without it, the analytics calls in `lib/analytics.ts` no-op.
- **Backend single-call invite-code on Google**: the mobile client prefers `POST /auth/google { token, invite_code }`. If the deployed backend does not yet support `invite_code` on that route, the client falls back to `POST /auth/attach-invite-code` after the upsert. Verify which path the production backend exposes; the fallback is best-effort and will silently leave a Google user unattached if both endpoints are missing.
- **Wave-3 legacy radius cleanup**: a number of fitness-track screens still import the old `xl`/`2xl` radius keys. They render correctly because the keys are aliased to `lg`, but the imports themselves are stale. The hit list lives in the planned `FITNESS_RADIUS_HITS.md`.
- **Trust Center wired to backend**: `TrustCenterScreen` fires `track('data_export_requested')` and `track('account_deletion_requested')` analytics events and posts to `/system/data-export` and `/system/account-delete`. Verify both endpoints are live and idempotent before promoting.

## 12. Daily-driver commands

```
npm install
cp .env.example .env       # fill in the three required vars
npx expo start             # dev
npx expo run:ios           # ios simulator
npx expo run:android       # android emulator

npm run validate:config    # static check on app.json + .env.example + well-known templates
npm run typecheck          # tsc --noEmit
npm run lint               # eslint, max-warnings=99999 (baseline is not clean)
npm test                   # jest
npm run smoke:android      # release-smoke against an installed APK
npm run qa:invite          # invite + deep-link QA against prod hosts
```

## 13. Where to look next

| Topic | File |
| --- | --- |
| API surface, axios, refresh contract | `src/services/api.ts` (header comment) and `src/services/README.md` |
| Auth screens | `src/screens/auth/README.md` |
| Stores | `src/store/README.md` |
| Tokens | `src/theme/tokens.ts` and `src/theme/README.md` |
| Navigation tree | `src/navigation/README.md` |
| Database tables and seeds | `src/db/README.md` |
| Hooks | `src/hooks/README.md` |
| Utils | `src/utils/README.md` |
| Components | `src/components/README.md` |
| Coach screens | `src/screens/coach/README.md` |
| Client screens | `src/screens/client/README.md` |
| Onboarding flow | `src/screens/onboarding/README.md` |
| Play submission | `PLAY_STORE_READINESS.md` |
| Release smoke | `docs/RELEASE_SMOKE.md` |
| Invite QA | `docs/INVITE_DEEPLINK_QA.md` |
| Hosted-file templates | `docs/well-known/README.md` |
