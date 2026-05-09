# Mobile Onboarding

You are joining `growth-project-mobile`, the React Native plus Expo client for the fitness pillar of The Growth Project. This document is the first thing to read after `git clone`. Budget about two hours.

Last verified: 2026-05-09.

---

## What this repo does

Two apps in one bundle:

- A **client** experience for nutrition and training: calorie and macro tracking, meal plans, recipe library, weight progress, intermittent fasting, AI guide, weekly reports, support inbox.
- A **coach** experience: multi-client management, reports, invite codes, alerts, risk board, cross-pillar (Fitness plus Finance) overview.

Role determines which navigator is mounted at runtime — see `src/navigation/`.

---

## Local setup

```bash
git clone git@github.com:BradleyGleavePortfolio/growth-project-mobile.git
cd growth-project-mobile
npm install
cp .env.example .env
# fill in EXPO_PUBLIC_API_URL (or rely on the dev fallback in src/config/env.ts),
# EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, EXPO_PUBLIC_CRISP_WEBSITE_ID
npx expo start
# press i / a / w for iOS / Android / web
```

You need:

- Node.js 20+
- Watchman recommended on macOS
- Xcode (iOS simulator) or Android Studio (Android emulator) — or a physical device with the Expo Go app for the first run
- An EAS account if you intend to build production binaries

The README has the full env-var matrix. The boot will not crash if a public env var is missing, but features behind that var will silently no-op (Sentry, PostHog, Crisp).

---

## Codebase tour

```
src/
├── analytics/         # PostHog wrapper, typed event constants
├── components/        # Reusable UI components
├── config/            # env wiring, deep-link config
├── constants/         # Raw colours, fonts, base theme
├── db/                # SQLite database layer (expo-sqlite async)
├── hooks/             # useCurrentUser, useSettings, etc.
├── navigation/        # React Navigation v7 (4 bottom tabs + More stack)
├── notifications/     # Expo push, channels, taxonomy
├── screens/
│   ├── auth/          # Welcome, Login, Create Account, Forgot Password, Role
│   ├── client/        # Client-facing screens (Home, Train, Log, Plan, Profile)
│   ├── coach/         # Coach dashboard screens (CoachWorkoutBuilder lives here)
│   ├── onboarding/    # 10-step onboarding quiz
│   └── share/         # Share card variants (streak, pr, transformation)
├── services/          # API clients (api.ts, exerciseLibraryApi, workoutBuilderApi, sentry, posthog)
├── store/             # Zustand v5 state stores
├── theme/             # Semantic theme tokens (single source — never hardcode hex)
├── types/             # TypeScript type definitions
├── ui/
│   ├── charts/        # TgpLineChart / TgpBarChart / TgpAreaChart / TgpSparkline
│   └── empty-states/  # Shared empty-state component library
└── utils/             # Helpers (date, nutrition, notifications, deepLink, googleAuth, haptics)
```

Per-module READMEs live alongside the code (`src/components/README.md`, `src/db/README.md`, `src/screens/coach/README.md`, etc.). The `docs/QUIET_LUXURY_DOCTRINE.md` is the editorial register; read it before adding UI.

---

## Conventions

- **Strict TypeScript.** No `any`, no `@ts-ignore`. CI rejects either.
- **Theme tokens only.** `src/theme/index.ts` exposes both the flat `Colors` palette and grouped `colors.{text, brand, feedback, border, data, background}` semantic tokens. Never hardcode hex outside the theme file.
- **No emoji. No exclamation points.** Anywhere — code, copy, commits, PRs.
- **Forbidden vocabulary.** ESLint blocks `income`, `finance`, `netWorth`, `confetti`, `trophy`, `revolutionary`, `gamechang*`. Finance-coded language stays in the finance app.
- **Accessibility.** Every interactive element carries `accessibilityLabel` plus `accessibilityRole`. The bottom tab bar is icons-only — user-facing labels live only in the accessibility props.
- **Quiet luxury doctrine.** No countdown timers, scarcity theatre, neon, sparkles, confetti, trophy iconography, stock photos of smiling coaches with ring lights. Reference register: Linear, Attio, Mercury.
- **README with every PR.** New screen / hook / service = update the matching module README. The PR template (`.github/pull_request_template.md`) carries the checklist; the rule and rationale live in `docs/QUIET_LUXURY_DOCTRINE.md` §8.
- **Reduced motion.** Honour `prefers-reduced-motion` everywhere. Reanimated worklets degrade to instantaneous.
- **`npm run validate:release`** is the first CI step on every PR. It hard-fails on stale `app.json` config (build numbers, store listing URLs, signing fingerprints).

---

## Auth model — the short version

- Supabase Auth issues ES256 JWTs.
- The mobile client signs in via Supabase email plus password, Apple Sign-In (iOS), or Google OAuth via Supabase.
- The token is stored in SecureStore (Keychain / Keystore).
- Every API call attaches `Authorization: Bearer <token>`. The backend verifies locally against Supabase JWKS (no round-trip to Supabase).
- An optional biometric unlock (Face ID / Touch ID / Android biometrics) wraps cold start plus 5-minute background. The opt-in is in **Settings → Security → Biometric unlock**. Hardware change never wipes tokens.

---

## Navigation

Four bottom tabs, icons-only:

1. **Home** — `HomeStack` (HomeMain, Habits, Notifications, Messages)
2. **Train** — `WorkoutStack` (WorkoutMain, ActiveWorkout, RoutineBuilder, CoachGuidelines)
3. **Log** — `LogScreen` (single screen)
4. **Profile** — `MoreStack` (MoreIndex, ProfileMain, Recipes, RecipeDetail, GroceryList, ShoppingList, PrepGuide, Fast, Community, Progress, Settings, Widgets, Report, Learn, Plan, TrustCenter, Preferences, AIGuide, Membership, ShareCard)

Coach navigator (`src/navigation/CoachNavigator.tsx`) is mounted when the user role is `coach`. Sprint B added `WorkoutBuilder` to `ClientsStackParamList`.

---

## Data layer

- **Server** — REST against `growth-project-backend` (`src/services/api.ts` is the typed client). Invite codes, coach API, exercise library, workout builder, federation surfaces.
- **Local** — `expo-sqlite` (async API). Migrated off WatermelonDB in commit `0dbc0a6`.
- **State** — Zustand v5. Stores live in `src/store/`. Selectors are typed.
- **Side effects** — Sentry (`services/sentry.ts`), PostHog (`analytics/posthog.service.ts`), Crisp (support inbox), Expo Notifications.

---

## Where to start when a ticket says…

| Ticket says | Start in |
|---|---|
| "Coach can't see invite codes" | `src/screens/coach/InviteCodesScreen.tsx` plus `services/api.ts` (coachApi) |
| "Workout builder not loading exercises" | `src/screens/coach/CoachWorkoutBuilderScreen.tsx` plus `services/exerciseLibraryApi.ts` (Sprint B) |
| "Holistic insights surface is empty / wrong" | Cross-pillar coach UI; the new engine ships in Sprint B Build 5 |
| "Push notification didn't fire" | `src/notifications/push-channels.ts` plus per-category preferences in `NotificationPreferencesScreen` |
| "Login fails with `kid not in JWKS`" | Supabase project keys mixed across two projects — see backend `docs/deploy-runbook.md` §0.1 |
| "Build green on EAS, TestFlight build never appears" | `EAS-BUILD.md` → "Common errors and fixes" |
| "App rejected by Apple for missing permission" | `app.json` → `ios.infoPlist` (NSCameraUsageDescription, NSFaceIDUsageDescription, NSPhotoLibraryUsageDescription) |
| "Coach console missing client" | Federation; check `FEDERATION_SERVICE_TOKEN` parity across both Fly apps |

---

## Day-one checklist

- [ ] Clone the repo and run `npm install`.
- [ ] Provision a personal Supabase project for local dev.
- [ ] Fill `.env`; run `npx expo start`; sign in on a simulator or device.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test` — all should pass (644 tests as of 2026-05-09).
- [ ] Read `README.md`, `EAS-BUILD.md`, `PLAY_STORE_READINESS.md`, `docs/QUIET_LUXURY_DOCTRINE.md`.
- [ ] Skim `docs/HANDOFF.md` — single reference covering every variable, the `app.json` shape, the auth state machine, the AI context contract, the deep-link parser, the design-token structure, the Play Internal Testing checklist, and the open verification gaps.
- [ ] Read the per-module READMEs for the area you will work in first.

If anything in the day-one checklist fails, that is the first ticket.

---

## Companion docs

- `README.md` — operator-facing reference (env vars, project structure, navigation, theme, contributing)
- `EAS-BUILD.md` — production build commands, TestFlight and Play Internal Testing flow, common errors
- `PLAY_STORE_READINESS.md` — full Play Store gate (signing, privacy, data safety, deep links, store listing)
- `SETUP.md` — additional local-dev setup notes
- `docs/QUIET_LUXURY_DOCTRINE.md` — editorial register and brand doctrine
- `docs/RELEASE_SMOKE.md` — release smoke flow run on every build before promotion
- `docs/INVITE_DEEPLINK_QA.md` — deep-link QA per environment
- `docs/HANDOFF.md` — single reference for picking up unfamiliar work
- `docs/PLAY_INTERNAL_TESTING_PACKAGE.md` — Play track package
