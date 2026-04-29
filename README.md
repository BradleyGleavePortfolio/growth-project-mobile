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

Google sign-in is brokered through Supabase OAuth — the mobile build does
**not** embed any per-platform Google client ID. See `PLAY_STORE_READINESS.md`
section 7 for the redirect URIs Supabase + Google Cloud Console must allow.

For EAS builds, either embed these in `eas.json` `env` blocks or store them as
EAS Secrets (`eas secret:create --scope project --name FOO`). Run
`npm run validate:config` before `eas build` to catch missing or stale config.

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

### Type-safety doctrine: no `any` in production paths

`src/` outside `__tests__` may not contain explicit `any` (annotation, generic
position, or `as any` cast). The rule lives in `.eslintrc.js`:
`@typescript-eslint/no-explicit-any`. Tests are exempted via the override block
because mock helpers and JSON fixtures use ad-hoc shapes.

The rule is currently `'warn'` — it surfaces all violations in `npm run lint`
output without failing CI. The target is `'error'` once the burndown lands. Do
**not** mass-suppress with `// eslint-disable-next-line` to clear the warnings;
fix the types properly (e.g. `useNavigation<NavigationProp<MoreStackParamList>>`
instead of `useNavigation<any>()`). When the count reaches zero, flip the rule
to `'error'` and remove the TODO comment in `.eslintrc.js`.

Why: `any` silently disables type-checking for everything it touches and
propagates through inference. A single `as any` can hide a real type mismatch
that ships to prod. Quiet-luxury doctrine: do the work to type things
correctly, or use `unknown` and narrow.

Per-module READMEs:

- `src/components/README.md`, `src/db/README.md`, `src/hooks/README.md`,
  `src/navigation/README.md`, `src/services/README.md`, `src/store/README.md`,
  `src/theme/README.md`, `src/utils/README.md`
- `src/screens/auth/README.md`, `src/screens/client/README.md`,
  `src/screens/coach/README.md`, `src/screens/onboarding/README.md`
- `docs/QUIET_LUXURY_DOCTRINE.md`, `docs/RELEASE_SMOKE.md`,
  `docs/INVITE_DEEPLINK_QA.md`, `docs/well-known/README.md`
