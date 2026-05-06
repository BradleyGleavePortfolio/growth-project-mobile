# Screenshot harness

Captures App Store / Play Store marketing screenshots from the **real** app
components — same `HomeScreen`, `PlanScreen`, `LogScreen`, `RecipesScreen`,
`ProgressScreen`, `FastingScreen` the production build renders. Demo data is
seeded by intercepting the axios instance in `services/api.ts`; nothing about
the screen components themselves changes.

## When the harness is active

`isScreenshotMode()` returns true only when `EXPO_PUBLIC_SCREENSHOT_MODE=1` is
set in the environment (typed at build/start time, e.g.
`EXPO_PUBLIC_SCREENSHOT_MODE=1 npx expo start --ios`).

In that mode:

1. `App.tsx` skips the splash/auth bootstrap, seeds AsyncStorage with a demo
   user, and mounts `ClientNavigator` directly.
2. `services/api.ts` registers an axios adapter that returns canned responses
   for every endpoint the screenshot screens hit (see `fixtures.ts`).
3. Animations and pull-to-refresh spinners stay quiet so captured frames are
   stable.

When the env var is absent, none of the screenshot code is mounted and there
is zero impact on production behavior.

## Capturing on iPhone 6.5" (1284 × 2778) — recommended path

App Store Connect requires 6.5" or 6.7" screenshots at 1284×2778. The iPhone
14 Plus / 16 Plus simulator natively renders at that size.

```bash
# 1. Install once
npm install
brew install --cask xcode  # if not already

# 2. Boot the 6.5" simulator
xcrun simctl boot "iPhone 16 Plus" || true
open -a Simulator

# 3. Build and start the app in screenshot mode
EXPO_PUBLIC_SCREENSHOT_MODE=1 \
EXPO_PUBLIC_API_URL=http://127.0.0.1:0 \
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:0 \
EXPO_PUBLIC_SUPABASE_ANON_KEY=screenshot-mode \
npx expo run:ios --device "iPhone 16 Plus"

# 4. From a second terminal, drive captures
bash scripts/capture-screenshots.sh
```

Output PNGs land in `./screenshots/ios-6.5/`.

## Capturing via web preview — fallback path

If you do not have macOS / Xcode, the web build can be captured headlessly via
Playwright. Fidelity is lower (some RN components render slightly differently
under react-native-web), but layout is faithful enough for review and internal
sign-off.

```bash
npm install
npm install --no-save react-native-web@~0.21.0 react-dom@19.2.0 \
  @expo/metro-runtime playwright
npx playwright install chromium

EXPO_PUBLIC_SCREENSHOT_MODE=1 \
EXPO_PUBLIC_API_URL=http://127.0.0.1:0 \
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:0 \
EXPO_PUBLIC_SUPABASE_ANON_KEY=screenshot-mode \
npx expo start --web --port 8081 &

# Wait for "Web Bundling complete" then:
node scripts/capture-screenshots-web.js
```

Output PNGs land in `./screenshots/web-6.5/`.

## What the harness will not do

- **No fake UI.** Every captured pixel comes from the production screen
  component tree. The mock layer only stands in for the network — equivalent
  to running the app against a backend whose database happens to contain the
  fixture data.
- **No medical / financial / coach-only consequential outputs.** Demo data
  shows a routine logging day (meals, weight trend, fasting timer) and never
  shows AI-generated text that would require coach approval per TGP
  guardrails. The AI Guide screen is intentionally excluded.

## Adding a screen to the capture set

1. Add an entry to `screens.ts` with a navigation key matching the route name
   in `ClientNavigator`.
2. Make sure every endpoint the screen hits has a fixture in `fixtures.ts`.
3. Rerun the capture script.
