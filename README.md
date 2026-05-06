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

Android-specific:

- `PLAY_STORE_READINESS.md` — full pre-submission checklist (signing, data safety, deep links, OAuth).
- `docs/RELEASE_SMOKE.md` — manual smoke checks per build.
- `scripts/release-smoke.sh` — automated subset, run after `adb install -r build.apk`.
- `docs/well-known/` — hosted-file templates for Android App Links + iOS Universal Links.

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

- `src/components/README.md`, `src/db/README.md`, `src/hooks/README.md`,
  `src/navigation/README.md`, `src/services/README.md`, `src/store/README.md`,
  `src/theme/README.md`, `src/utils/README.md`
- `src/screens/auth/README.md`, `src/screens/client/README.md`,
  `src/screens/coach/README.md`, `src/screens/onboarding/README.md`
- `docs/QUIET_LUXURY_DOCTRINE.md`, `docs/RELEASE_SMOKE.md`,
  `docs/INVITE_DEEPLINK_QA.md`, `docs/well-known/README.md`
