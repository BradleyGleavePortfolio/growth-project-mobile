# The Growth Project

A React Native nutrition & fitness coaching app built with Expo, TypeScript, and SQLite.

## Features

- **Calorie & Macro Tracking** — Log meals with protein, carbs, fat breakdowns
- **Meal Plans** — Coach-assigned weekly meal plans with daily targets
- **Recipe Library** — Searchable recipe database with filters
- **Progress Tracking** — Weight logging with trend charts
- **Intermittent Fasting** — Timer with protocol selection and streak tracking
- **AI Guide** — Context-aware nutrition chatbot
- **Coach Dashboard** — Multi-client management, reports, and invite system
- **Support Inbox** — In-app live support chat via Crisp (accessible from Settings -> Support). Separate from Coach AI and the Client Bot. See `docs/support-inbox.md`.
- **Coach Risk Board (OWNER-gated in this release)** — PTM Phase 1E surface that lists clients sorted by churn risk, with a per-client "why" drawer and a one-tap check-in nudge. See `src/screens/coach/RISK_BOARD.md`.
- **Weekly Reports** — Shareable progress summaries

## Tech Stack

- React Native 0.83 + Expo ~55 (managed workflow)
- TypeScript strict
- expo-sqlite (async API)
- Zustand v5 for state
- React Navigation v7 (native stack + bottom tabs; 4 bottom tabs, icons-only, with a More stack hung off the Profile tab)
- react-native-svg for hand-rolled charts
- react-native-reanimated v4, expo-haptics

## Getting Started

```bash
npm install
cp .env.example .env   # fill in values (see below)
npx expo start         # then press i / a / w for iOS / Android / web
```

### iOS / Android dev build

```bash
# iOS simulator (requires Xcode)
npx expo run:ios

# Android emulator (requires Android Studio + SDK)
npx expo run:android
```

### Production builds (EAS)

```bash
# One-time: install the EAS CLI and log in
npm install -g eas-cli
eas login

# Build for the store (profile names in eas.json)
eas build --platform ios --profile production
eas build --platform android --profile production
```

## Environment variables

All runtime env vars are read via `expo-constants` / `EXPO_PUBLIC_*`. Copy
`.env.example` to `.env` and fill in:

| Variable | Required | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | yes (non-dev) | Base URL of the backend API. In dev, falls back to the Fly.io URL in `src/config/env.ts`. |
| `EXPO_PUBLIC_SUPABASE_URL` | yes | Supabase project URL used for auth + token refresh. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon JWT used by the client SDK. |
| `EXPO_PUBLIC_SENTRY_DSN` | no | When set, Sentry is initialised in `services/sentry.ts`. Missing DSN means `wrap`, `captureError`, `setSentryUser` are no-ops. |
| `EXPO_PUBLIC_ENVIRONMENT` | no | Sentry `environment` tag. Defaults to `'production'`. |
| `SENTRY_AUTH_TOKEN` | no (recommended for prod) | EAS-time secret consumed by `@sentry/react-native/expo`'s release-upload step. When unset the build still succeeds, but no source maps reach Sentry, so production stack traces stay minified. See "Sentry release tracking" below. |
| `EXPO_PUBLIC_POSTHOG_KEY` | no | PostHog project key. Empty string disables capture. |
| `EXPO_PUBLIC_POSTHOG_HOST` | no | Defaults to `https://us.i.posthog.com`. |
| `EXPO_PUBLIC_CRISP_WEBSITE_ID` | yes (support inbox) | Crisp website ID for the in-app support inbox. Found in the Crisp dashboard under **Settings -> Website Settings -> Setup instructions**. Ships in the bundle (public key). See `docs/support-inbox.md`. |

Google sign-in is brokered through Supabase OAuth. The mobile build does
**not** embed any per-platform Google client ID. See `PLAY_STORE_READINESS.md`
section 7 for the redirect URIs Supabase + Google Cloud Console must allow.

### Sign in with Apple (iOS)

Apple Sign-In is required by App Store Review whenever any third-party
sign-in (e.g. Google) is offered. The button is wired into `LoginScreen` and
`CreateAccountScreen` and uses the official
`<AppleAuthentication.AppleAuthenticationButton>` component (mandatory by
Apple HIG — do **not** swap in a custom button).

Apple Developer portal steps (one-time, owner only):

1. App IDs → `com.growthproject.app` → enable the **Sign In with Apple**
   capability. Save.
2. Regenerate the iOS provisioning profile (EAS handles this automatically
   on the next `eas build --platform ios --profile production`).
3. If you serve users via Supabase, enable the **Apple** provider in the
   Supabase dashboard and paste in the Apple Services ID + key. The mobile
   client itself does not embed an Apple client ID — the identity token is
   verified server-side at `POST /auth/apple`.

`app.json` already declares `ios.usesAppleSignIn: true` and includes the
`expo-apple-authentication` plugin so the entitlement is added to the
binary at build time.

### Biometric unlock (Face ID / Touch ID / Android biometrics)

`expo-local-authentication` powers an optional biometric unlock that
re-prompts on cold start and after the app has been backgrounded for more
than 5 minutes. Users opt in from **Settings → Security → Biometric
unlock**; the opt-in flag is stored in SecureStore (Keychain / Keystore) at
key `biometric_unlock_enabled`.

Behaviour rules:

- Opt-in off → the gate is a pass-through.
- Opt-in on, biometrics enrolled → prompt; failure falls back to device
  passcode (system fallback). On final failure the app stays locked with a
  retry button — we never wipe tokens.
- Opt-in on, biometrics not enrolled or hardware absent → the gate
  unlocks silently. We never lock a user out because of a hardware change.

iOS requires `NSFaceIDUsageDescription` in `Info.plist`; this is set in
`app.json` under `ios.infoPlist`.

For EAS builds, either embed these in `eas.json` `env` blocks or store them as
EAS Secrets (`eas secret:create --scope project --name FOO`). Run
`npm run validate:config` before `eas build` to catch missing or stale config.


For EAS builds, either embed these in `eas.json` `env` blocks or store them as
EAS Secrets (`eas secret:create --scope project --name FOO`). Run
`npm run validate:config` before `eas build` to catch missing or stale config.

`docs/HANDOFF.md` is the single reference covering every variable, the
`app.json` shape, the auth state machine, the AI context contract, the
deep-link parser, the design-token structure, the Play Internal Testing
checklist, and the open verification gaps. Read it before picking up
unfamiliar work in this repo.

## Sentry release tracking

Production crashes are useful only if their stack traces are readable.
Three pieces have to line up for that to happen on a Hermes-bundled
Expo build:

1. **`metro.config.js`** wraps the Expo defaults with
   `getSentryExpoConfig` so every JS bundle ships a stable Debug ID.
2. **`@sentry/react-native/expo`** is registered as a config plugin in
   `app.json` so EAS's prebuild step injects the upload phase into the
   Xcode and Gradle build pipelines.
3. **`SENTRY_AUTH_TOKEN`** is provided to EAS at build time so the
   upload phase can publish source maps to Sentry under the same
   release identifier the running app reports.

The release identifier is built in `src/services/sentry.ts` as
`<version>+<buildNumber|versionCode>` so a TestFlight build, an App
Store build, and a Google Play track build never collide.

### Setting up SENTRY_AUTH_TOKEN

Generate a token at sentry.io → User Settings → Auth Tokens with the
`project:releases` and `project:write` scopes (no broader access
needed).

Then store it as an EAS Secret — not an `EXPO_PUBLIC_*` env var,
because it is a write credential and must never reach the client
bundle:

```
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>
```

The next `eas build` picks up the secret automatically. The build
still succeeds when the secret is missing — the upload step in the
Sentry config plugin no-ops with a warning rather than failing the
build — so the gate is lossy-but-loud rather than hard-fail.

The `organization`, `project`, and `url` values that the upload step
needs live in `app.json` under the plugin's options. Edit them there
if the Sentry account moves.

## Release readiness

Every PR runs `npm run validate:release` as the first CI step. The command
checks that `app.json`, `.env.example`, and the hosted-file templates are
consistent. Genuinely broken config (wrong package name, invalid URL format,
missing plugin) fails CI immediately. Known-pending items that cannot be
completed until after the first store upload (SHA256 fingerprint, store
listing URLs) are written to `RELEASE_BLOCKER.md` at repo root instead —
CI still passes, but the file tells you exactly what must be done before
submitting to the stores.

Additional references:

- `PLAY_STORE_READINESS.md` — full pre-submission checklist (signing, data safety, deep links, OAuth).
- `docs/RELEASE_SMOKE.md` — manual smoke checks per build.
- `scripts/release-smoke.sh` — automated subset, run after `adb install -r build.apk`.
- `docs/well-known/` — hosted-file templates for Android App Links + iOS Universal Links.
- `scripts/validate-app-config.js` — the validator; run `node scripts/validate-app-config.js --help` for usage.

### BEFORE PLAY STORE SUBMISSION — required steps

The CI gate passes while the app is in development, but two items must be
completed before you submit to the Google Play Store. If you see a
`RELEASE_BLOCKER.md` file in the repo root after a CI run, these are what
it is telling you to fix.

#### Step 1 — Fill in the Android SHA256 fingerprint

**What it is:** A unique code that proves the app installed on someone's
Android phone is the real Growth Project app (not a fake copy). Without it,
invite links sent to Android users will open in a web browser instead of
opening the app directly.

**Where it lives:** `docs/well-known/assetlinks.json` — look for the line
that says `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`.

**How to get it:**

Option A — from Play Console (use this after your first production upload):

1. Go to [play.google.com/console](https://play.google.com/console) and open The Growth Project.
2. In the left-hand menu, go to **Setup** > **App integrity**.
3. Under **App signing key certificate**, copy the **SHA-256 fingerprint**.
   It looks like: `AB:CD:EF:12:34:56:78:90:AB:CD:...`

Option B — from the keystore file on your computer (use this before your first upload):

```bash
keytool -list -v -keystore /path/to/your.keystore -alias your-key-alias
# Look for the line that starts with SHA256:
```

**Then replace the placeholder:**

Open `docs/well-known/assetlinks.json` and change:
```json
"REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT"
```
to your real fingerprint, e.g.:
```json
"AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78"
```

After saving, upload the file to:
`https://app.trygrowthproject.com/.well-known/assetlinks.json`

#### Step 2 — Add store listing URLs

Once the app is published on the Play Store and App Store, open `app.json`
and fill in the two `null` values under `expo.extra.storeListings`:

```json
"storeListings": {
  "playStoreUrl": "https://play.google.com/store/apps/details?id=com.growthproject.app",
  "appStoreUrl": "https://apps.apple.com/us/app/the-growth-project/id<your-app-id>"
}
```

These URLs are used in in-app "Rate us" and share links. They are validated
by `npm run validate:release` — a fake or wrong-format URL will fail CI.

#### How to confirm you are ready

After completing both steps, run:

```bash
npm run validate:release
```

If it exits with no errors and no blockers (no `RELEASE_BLOCKER.md` written),
you are ready to submit.

## Project Structure

```
src/
├── components/       # Reusable UI components
├── constants/        # Raw colors / fonts / base theme
├── db/               # SQLite database layer
├── hooks/            # Shared hooks (useCurrentUser, …)
├── navigation/       # React Navigation setup (4 bottom tabs + More stack hung off the Profile tab)
├── screens/
│   ├── auth/         # Welcome, Login, Create Account, Forgot Password, Role
│   ├── client/       # Client-facing screens (Home, Workout/Train, Log, Plan, Profile/More…)
│   ├── coach/        # Coach dashboard screens
│   └── onboarding/   # 10-step onboarding quiz
├── services/         # API client, auth helpers
├── store/            # Zustand state stores
├── theme/            # Semantic theme tokens (single source — never hardcode hex)
├── types/            # TypeScript type definitions
├── ui/
│   └── empty-states/ # Shared Empty State component library (Phase 11)
└── utils/            # Helpers (date, nutrition, notifications, …)
```

## Navigation

Bottom tabs are icons-only (no labels). Four tabs, in order:

1. **Home** — accessibility label `Home`, route name `Home`. Wraps `HomeStack` (`HomeMain`, `Habits`, `Notifications`, `Messages`).
2. **Train** — accessibility label `Train`, route name `WorkoutTab`. Wraps `WorkoutStack` (`WorkoutMain`, `ActiveWorkout`, `RoutineBuilder`, `CoachGuidelines`).
3. **Log** — accessibility label `Log food`, route name `Log`. Single screen (`LogScreen`).
4. **Profile** — accessibility label `Profile and more`, route name `MoreTab`. Wraps `MoreStack`, which houses `MoreIndex`, `ProfileMain`, `Recipes`, `RecipeDetail`, `GroceryList`, `ShoppingList`, `PrepGuide`, `Fast`, `Community`, `Progress`, `Settings`, `Widgets`, `Report`, `Learn`, `Plan`, `TrustCenter`, `Preferences`, `AIGuide`, and `Membership`. There is no global floating chat widget — the AI surface is `AIGuide`, reached from the **Guidance** row on `MoreScreen`. The `TrophyShare` route was removed in #63 alongside the celebration chrome. `RecipeDetail` accepts a serialisable `{ recipeId: string }` only.

The route names (`Home` / `WorkoutTab` / `Log` / `MoreTab`) are what `navigate()` calls and the linking config use; the user-facing labels live only in the accessibility props because the bar is icon-only. See `src/navigation/ClientNavigator.tsx`.

## Theme

`src/theme/index.ts` is the single source of truth for colors, typography,
spacing, and radii. It exposes both the flat `Colors` palette and grouped
`colors.{text,brand,feedback,border,data,background}` semantic tokens.
Never hardcode hex values in components.

## Contributing

Every PR updates the corresponding README / module documentation. The rule —
and the rationale — live in `docs/QUIET_LUXURY_DOCTRINE.md` §8. The PR
template (`.github/pull_request_template.md`) carries the checklist.

Per-module READMEs:

- `src/ui/empty-states/README.md`
- `src/components/README.md`, `src/db/README.md`, `src/hooks/README.md`,
  `src/navigation/README.md`, `src/services/README.md`, `src/store/README.md`,
  `src/theme/README.md`, `src/utils/README.md`
- `src/screens/auth/README.md`, `src/screens/client/README.md`,
  `src/screens/coach/README.md`, `src/screens/onboarding/README.md`
- `docs/QUIET_LUXURY_DOCTRINE.md`, `docs/RELEASE_SMOKE.md`,
  `docs/INVITE_DEEPLINK_QA.md`, `docs/well-known/README.md`

## Phase 11 / Track 3 — Haptic Feedback Service

Typed singleton (`HapticService`) wrapping `expo-haptics`.

- Respects user preference: **Settings > App Preferences > Haptics enabled**
- Preference persisted via `useSettings` / AsyncStorage (`gp_client_settings`)
- Wired into: tab switches, workout completion, food log success/failure, profile save/validation

See [docs/HAPTICS.md](docs/HAPTICS.md) for full API reference and wiring map.

## Charts — `src/ui/charts`

Phase 11 / Track 5 introduces a unified chart component library powered by
`react-native-svg` + `react-native-gesture-handler` with a Victory Native XL
upgrade path (see `docs/charting.md` for the Skia peer-dependency note).

| Component       | Use case                                      |
|-----------------|-----------------------------------------------|
| `TgpLineChart`  | Trend lines with pan tooltip                  |
| `TgpBarChart`   | Categorical bars with tap tooltip             |
| `TgpAreaChart`  | Filled area with pan tooltip                  |
| `TgpSparkline`  | Inline micro-chart for cards (no labels)      |

Import from the barrel: `import { TgpLineChart } from '../ui/charts'`.

All components accept `themeOverride?: Partial<ThemeColors>` and read palette
tokens from `ThemeProvider` automatically.  See `docs/charting.md` for full
theming rules, performance notes, and the Skia upgrade path.

**Migrated screen:** `src/screens/client/ProgressScreen.tsx` — the inline
`WeightLineChart` SVG was replaced with `TgpLineChart`.

---

## Phase 11 — Analytics, Push Taxonomy, Share Card

### PostHog Analytics

`posthog-react-native` is installed and the `<PostHogProvider>` wraps `App.tsx` with `autocapture` enabled.

**Env vars (both accepted; canonical name is the first):**

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_POSTHOG_API_KEY` | PostHog project API key (public — ships in bundle). |
| `EXPO_PUBLIC_POSTHOG_KEY` | Legacy alias — both are accepted. |
| `EXPO_PUBLIC_POSTHOG_HOST` | PostHog ingest host (default: `https://app.posthog.com`). |

The SDK is a silent no-op when the key is absent (CI, dev without secrets).

- Typed event constants: `src/analytics/events.ts`
- Service wrapper: `src/analytics/posthog.service.ts`
- Full event catalog: `docs/analytics-events.md`

### Push Notification Taxonomy

Four-tier channel/category system registered at app bootstrap:

| Tier | ID | Importance |
|---|---|---|
| Coach messages | `coach-messages` | HIGH |
| Reminders | `client-bot` | LOW |
| Milestones | `milestones` | DEFAULT |
| System | `system` | DEFAULT |

- Implementation: `src/notifications/push-channels.ts`
- Full taxonomy: `docs/push-taxonomy.md`
- Per-category preferences: `src/screens/settings/NotificationPreferencesScreen.tsx`
  (route: `NotificationPreferences` in `MoreStack`)

### Share Card

Three card variants: `streak`, `pr`, `transformation`.

- Screen: `src/screens/share/ShareCardScreen.tsx`
- Navigation: `MoreStackParamList.ShareCard`
- Capture: `react-native-view-shot` (requires native build)
- Share: `expo-sharing`
- Analytics: fires `REFERRAL_SHARE_CARD_SHARED` on share
- Full spec: `docs/share-card.md`

## Sprint A — Audit fixes

GPT-5.5 client + coach audits ran against the post-Sprint-A merge
and scored TGP at 71/100 on each side with verdict DO NOT SHIP. This
section lists the fixes that landed on `feat/sprint-a-audit-fixes`
to clear those audits before the next TestFlight push. Each item
cites the audit ID it resolves.

- **CR-1 (client) — Reset-password deep link.** Added
  `src/screens/auth/ResetPasswordScreen.tsx`, a `ResetPassword`
  route in `AuthNavigator`, and a `fragmentToQuery` helper in
  `src/navigation/deepLinkUtils.ts` that hoists the Supabase
  recovery URL fragment into a query string so React Navigation can
  parse the access_token + refresh_token pair into `route.params`.
  The screen primes a Supabase session, lets the user enter a new
  password, calls `updateUser`, then signs them out and bounces
  through Login. 15 test cases.
- **CR-4 / Coach #8 — Invite-code CTAs.** Wired `EmptyStateNoClients`
  with `onInvite` on `ClientsListScreen` and `MessagesScreen`, added
  a header-pill CTA on `ClientsListScreen` and `CoachHomeScreen`
  routing through `ClientsStack -> InviteCodes`. A brand-new coach
  with zero clients now reaches the invite-codes surface in one tap
  from any of three primary surfaces. 6 test cases.
- **H-1 (client) — CoachGuidelinesScreen retry.** The previous
  `.catch` swallowed errors, hiding network failures behind the
  empty state. Now distinguishes loading / error / data and renders
  an `accessibilityRole="alert"` retry surface when the API fails.
  5 test cases.
- **H-4 (client) — RoleSelection invite-code error surface.** 4xx
  responses from `attachInviteCode` are now rethrown so the outer
  catch shows the server's BadRequest message in the existing
  Alert + setError UI. 5xx and network failures still fall through
  to `selectRole` for resilience. 4 test cases.
- **H-5 (client) — ActiveWorkoutScreen comments.** Stale references
  to the deleted WatermelonDB stack replaced with comments naming
  the current expo-sqlite implementation, with a pointer at
  `docs/offline-architecture.md`. No runtime change.

Tests added: 30 new assertions across 5 spec files, all pass.
Suite total post-audit-fix: 677 tests, 0 failing.
Typecheck: clean.

### Items deferred to a follow-up

- **Coach #4 — Practice picker back/skip button.** Audit cites the
  finance-side picker (`tgp-finance-app/mobile/app/coach/practice/
  index.tsx`); fitness-side picker
  (`src/screens/coach/cross-pillar/PracticeSelectionScreen.tsx`)
  already ships a chevron-back. Fix lives in the finance repo and
  is being handled by a parallel agent.

## Operator Fill-Ins Required

Operator-action checklist for the TestFlight launch of the fitness mobile app. Every `Used in (file:line)` row was verified by grep against `main` HEAD on 2026-05-12. All values must be set on the EAS project (`a12c3345-cc8c-4c2c-9c57-711c10a57c1c`, owner `the-growth-project`) before building for store distribution.

### TestFlight-blocking EAS secrets

| Variable | Used in (file:line) | Where to set | How to generate / source |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | `src/config/env.ts:8` | EAS secret (eas.json env block, profile `production`) | Fly host of the backend: `https://backend-spring-lake-3890.fly.dev`. Must include scheme; no trailing slash. |
| `EXPO_PUBLIC_SUPABASE_URL` | `src/config/env.ts:6` | EAS secret (eas.json env block, profile `production`) | Supabase dashboard → Settings → API → Project URL. Must match the backend's `SUPABASE_URL`. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `src/config/env.ts:7` | EAS secret (eas.json env block, profile `production`) | Supabase dashboard → Settings → API → `anon` public key. Safe to ship in the client bundle. |
| `EXPO_PUBLIC_SENTRY_DSN` | `src/services/sentry.ts:49` | EAS secret (eas.json env block, profile `production`) | Sentry → Project (mobile) → Client Keys (DSN). |
| `EXPO_PUBLIC_POSTHOG_KEY` | `src/lib/analytics.ts:56` | EAS secret (eas.json env block, profile `production`) | PostHog → Project Settings → Project API Key. |
| `EXPO_PUBLIC_POSTHOG_HOST` | `src/lib/analytics.ts:58` | EAS secret (eas.json env block, profile `production`) | PostHog instance URL (defaults to `https://us.i.posthog.com`). |
| `EXPO_PUBLIC_ENVIRONMENT` | `src/services/sentry.ts:76` | EAS secret (eas.json env block, profile `production`) | Static string `production` for store builds; `preview` for internal builds. |
| `EXPO_PUBLIC_HELP_BASE_URL` | `src/config/env.ts:9` | EAS secret (eas.json env block, profile `production`) | Public help / support URL (e.g. `https://app.trygrowthproject.com/help`). |
| `EXPO_PUBLIC_CRISP_WEBSITE_ID` | `src/services/support/crisp.service.ts:32` | EAS secret (eas.json env block, profile `production`) | Crisp dashboard → Settings → Website Settings → Website ID. |
| `SENTRY_AUTH_TOKEN` | EAS build host (sourcemaps upload) | EAS secret (account-level) | Sentry → Settings → Auth Tokens → create with `project:releases` scope. Read by `@sentry/react-native` during the production build's sourcemap upload step. |
| `EXPO_TOKEN` | EAS build host (CI submit) | GitHub Actions secret + local `~/.netrc` | expo.dev → Settings → Access Tokens → create a personal access token. Only required for non-interactive `eas submit` from CI. |

### Phase 2 / off-by-default (OPTIONAL — do NOT set for the v1 TestFlight)

| Variable | Used in (file:line) | Where to set | How to generate / source |
|---|---|---|---|
| `EXPO_PUBLIC_FEATURE_BLOODWORK` | `src/config/featureFlags.ts:42` | EAS secret (eas.json env block, profile `production`) | OPTIONAL — Phase 2. Default `false`. The first version of the app must ship with bloodwork hidden (enforced by `src/__tests__/bloodworkFeatureFlag.test.ts`). |
| `EXPO_PUBLIC_WAVE11_MOCK` | `src/services/wave11Adapters.ts:25` | EAS secret (eas.json env block, profile `development` only) | OPTIONAL — dev only. Forces wave-11 adapters to return mocked data so screens render without a live backend. Never set in `production`. |
| `EXPO_PUBLIC_SCREENSHOT_MODE` | `src/screenshots/mode.ts:8` | EAS secret (eas.json env block, profile `preview` only) | OPTIONAL — screenshot capture only. Drives the App Store / Play Store screenshot fixtures. Leave unset in `production`. |

### Currently set (verify, do not introspect)

The variables in the TestFlight-blocking table above were populated for prior internal builds. Before running `eas build --profile production`, re-verify each in the EAS dashboard:

```bash
npx eas-cli env:list --environment production
```

Compare against the table above. Add any missing keys with `npx eas-cli env:create`.

## TestFlight Launch Checklist

The fitness mobile app ships from this repo to TestFlight (iOS) and Play Internal Testing (Android). Confirm each step before tagging a build.

### 1. Pre-flight

- [ ] All EAS production-profile secrets in the [Operator Fill-Ins Required](#operator-fill-ins-required) table are set. Verify with `npx eas-cli env:list --environment production`.
- [ ] Backend Fly app `backend-spring-lake-3890` is deployed at the version this build expects (no breaking schema migration pending).
- [ ] `app.json` build numbers are correct: `expo.ios.buildNumber = "3"`, `expo.android.versionCode = 3`. **Do NOT bump in this PR** — owner instruction is fitness mobile stays at build 3 until the next release pass.
- [ ] `expo.extra.eas.projectId` in `app.json` matches the EAS project (`a12c3345-cc8c-4c2c-9c57-711c10a57c1c`). The docs were reconciled in this handoff PR.
- [ ] `assetlinks.json` and `apple-app-site-association` are reachable on the public marketing host (`app.trygrowthproject.com`).
- [ ] No `playStoreUrl` is set yet — Android listing setup is a separate workstream and gates Play submission, not TestFlight.

### 2. Build

```bash
# iOS only — TestFlight target
npx eas-cli build --platform ios --profile production

# Both platforms (use when Play listing is ready)
npx eas-cli build --platform all --profile production
```

The `production` profile is defined in [`eas.json`](eas.json) and sets `distribution: "store"` + `environment: "production"`.

### 3. Submit

```bash
# Upload the latest production build to App Store Connect
npx eas-cli submit --platform ios --latest
```

App Store Connect destination: [The Growth Project, id 6765847915](https://apps.apple.com/us/app/the-growth-project/id6765847915).

### 4. TestFlight verification

Once the build is processed in App Store Connect (typically 5-15 min), assign it to the internal testing group and verify on a physical device:

- [ ] Sign-in with email/password works (Supabase round-trip succeeds).
- [ ] Sign-in with Apple completes and the backend issues a session.
- [ ] Home screen loads without crashing; analytics ping fires (verify in PostHog Live Events).
- [ ] Coach invite deep link (`tgp://invite/<code>`) opens the app from a fresh install path.
- [ ] Push notification permission prompt appears on first launch; test push from backend `notification.service` round-trips.
- [ ] Crisp support chat opens from Settings → Support.
- [ ] No Sentry crashes in the first 5 minutes of use (verify in Sentry mobile project).

## Open PRs by Status

Triage of open PRs as of 2026-05-12 (`gh pr list --state open --limit 100`).

### Bucket B: Stale but relevant (needs rebase before merge)

- **#111** Notification center + preferences — pairs with backend #184.
- **#112** Coach Command Center — 5-tab coach landing surface. Coaches currently have no purpose-built landing screen.
- **#113** Delete account screen — pairs with backend #164 (EU compliance UI).
- **#114** Data export screen — pairs with backend #171.

### Bucket C: N-coach gated (deferred until coach count grows)

- **#123** Workout builder coach screen + exercise search — pairs with backend #182.
- **#124** Talent marketplace application status screen — pairs with backend #183.

### Bucket D: UNSTABLE dependabots (CI failing, needs code fix)

- **#87** `posthog-react-native` 4.43 → 4.44 — probably trivial.
- **#88** `axios` 1.13 → 1.16 — likely trivial.
- **#89** `react-native-worklets` 0.7 → 0.8 — Reanimated 4 compat.
- **#90** `@react-native-async-storage/async-storage` 2.2 → 3.0 — major API change.
- **#91** `zustand` 5.0.11 → 5.0.13 — patch, should be safe.
