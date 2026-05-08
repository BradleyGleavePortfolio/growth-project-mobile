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
