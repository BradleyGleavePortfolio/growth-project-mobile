# Real-device release smoke checklist

Run this end-to-end on a physical device before promoting a build to internal testing → closed testing → production (Play) or TestFlight internal → external → App Store (iOS). The list mirrors what Play / Apple review will exercise. **Do not** skip an item because "the code didn't change" — release smoke catches infra and signing regressions, not source bugs.

The Android sections below cover the EAS `preview` APK and `production` AAB. The [iOS TestFlight](#testflight-build-4-candidate-checklist) checklist at the bottom covers the cross-cutting flows that must pass on a physical iPhone before assigning the build to external testers.

A scripted sub-set lives at `scripts/release-smoke.sh` for the parts that can be automated from a connected device.

## Real-device proof

Every row marked **proof: …** below requires an artefact captured from a physical Android device (or a hardware-emulator AVD if no physical handset is available) and saved under `release-artifacts/<build-version>-<date>/`. Filename and capture command are listed per row. The release manager pastes the path in the Play Console release notes' internal section and keeps the folder for at least one rollback window (7 days). A row that lists a proof artefact but has no file in the folder is treated as not run. Emulators on CI are explicitly **not** acceptable for the push-notification, deep-link, and OAuth rows — those exercise system services that behave differently in cloud emulators.

---

## Pre-build

| # | Check | How |
| --- | --- | --- |
| 1 | `versionCode` bumped past last Play upload | `jq '.expo.android.versionCode' app.json` and compare to Play Console → Releases → Internal testing |
| 2 | `version` bumped (semver) | `jq '.expo.version' app.json` |
| 3 | App config validates | `npm run validate:config` (CI / dev) and `npm run validate:release` (pre-promotion gate — fails if any `REPLACE_WITH_*` placeholder remains in the well-known templates or if `expo.extra.storeListings.{playStoreUrl,appStoreUrl}` is still `null`) |
| 4 | Required env vars set in EAS profile | `eas env:list --environment production` (and `preview` for APK) |
| 5 | `eas.json` `requireCommit: true` is honoured | git tree clean before `eas build` |
| 6 | Typecheck / lint / tests green | `npm run typecheck && npm run lint && npm test -- --ci --passWithNoTests` |

If item 4 lists `EXPO_PUBLIC_GOOGLE_CLIENT_ID_*`, **delete** them — auth is Supabase-brokered, those vars are read by nothing and only confuse rotation.

## Install + first launch

| # | Check | How |
| --- | --- | --- |
| 7 | APK installs cleanly on a fresh emulator | `adb install -r build.apk` |
| 8 | App launches without crashing | `adb logcat -d -t 200 \| grep -i 'AndroidRuntime\|FATAL'` should be empty |
| 9 | Splash + Welcome render (no white-flash, no Sentry init failure) | manual eyes-on |
| 10 | `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` are present (env validation throws on missing) | implicit — boot succeeds means env passed `src/config/env.ts` |
| 11 | Push permission prompt fires once on Android 13+ | tap through; second launch must NOT re-prompt. **proof:** capture `adb shell dumpsys package com.growthproject.app \| grep -E 'POST_NOTIFICATIONS\|granted=true'` to `release-artifacts/<build>/notifications-permission.txt`. The `POST_NOTIFICATIONS` line must show `granted=true` — if it is missing entirely, the `expo-notifications` plugin is not registered in `app.json` and the build needs a respin. |
| 12 | Notification channels created on Android | `adb shell dumpsys notification \| grep -A1 'NotificationChannel.*com.growthproject.app'` shows `default`, `water`, `fasting`. **proof:** save the full grep output to `release-artifacts/<build>/notification-channels.txt`. |

## Auth

| # | Check | How |
| --- | --- | --- |
| 13 | Email signup blocked without invite when `require_invite_code=true` | enter email/password without a code → client-side rejection before network |
| 14 | Email signup with valid invite succeeds | use a known sandbox invite code |
| 15 | Google sign-in completes via Supabase OAuth | tap "Continue with Google", complete browser consent, lands on RoleSelection (new) or Home (returning) |
| 16 | Google sign-in attaches `invite_code` for new users | new account created after Google signup is associated with the inviting coach (verify in Supabase dashboard) |
| 17 | Sign-out clears tokens | sign out, kill app, reopen → Welcome screen |

## Deep links — invite

| # | Check | How |
| --- | --- | --- |
| 18 | Custom scheme `tgp://join/<code>` opens CreateAccount with code prefilled | `adb shell am start -a android.intent.action.VIEW -d "tgp://join/SMOKE01" com.growthproject.app`. **proof:** screen-record (`adb shell screenrecord /sdcard/deeplink.mp4`, then `adb pull`) saved as `release-artifacts/<build>/deeplink-custom.mp4`. |
| 19 | Universal link `https://app.trygrowthproject.com/join/<code>` opens app silently (no chooser) | requires `assetlinks.json` hosted with the production fingerprint (no `REPLACE_WITH_*` placeholders — `npm run validate:release` blocks publish if they remain). Run `adb shell pm get-app-links com.growthproject.app` to confirm `app.trygrowthproject.com: verified`. **proof:** save the full `pm get-app-links` output to `release-artifacts/<build>/app-links.txt`; the line for `app.trygrowthproject.com` must read `verified` (anything else — `legacy_failure`, `none`, `1024` — is a fail). |
| 20 | Invite code without leading slash also works | tap a link in Gmail / Messages, not just `adb` |
| 21 | App handles bad invite code gracefully | `tgp://join/NOT_REAL` — error surfaces in CreateAccount, no crash |

## AI Guide structured-context route

| # | Check | How |
| --- | --- | --- |
| 22 | AI Guide chat opens (More → AI Guide) | manual |
| 23 | First message returns within ~10 s with a structured response (not a 500) | observe loading → response; check Sentry for `ai_guide.error` events |
| 24 | Structured-context payload is sent (not just a free-text prompt) | dev build only: tail `adb logcat \| grep aiGuide`; verify request includes user goals/macros context |

## Notifications — receive path

| # | Check | How |
| --- | --- | --- |
| 25 | Foreground notification renders (water reminder fires) | trigger `scheduleWaterReminder(0.001)` from a dev build, or manually post `adb shell cmd notification post -t "Hydrate" smoke 'Drink water'`. **proof:** screenshot saved as `release-artifacts/<build>/notification-foreground.png`. |
| 26 | Background tap routes back to the app | post a notification, swipe app away, tap notification → app reopens. **proof:** screen-record saved as `release-artifacts/<build>/notification-background.mp4`. |
| 27 | Notification shows correct channel name in long-press → settings | "Default" / "Water Reminders" / "Fasting Alerts". **proof:** screenshot of the per-channel settings page saved as `release-artifacts/<build>/notification-channels-ui.png`. |

## Logging / observability

| # | Check | How |
| --- | --- | --- |
| 28 | Sentry release tag matches `app.json → expo.version` | Sentry → Releases → confirm new version appears within minutes of first launch |
| 29 | PostHog session recorded with correct `app_version` | PostHog → Live events → filter by `app_version` |
| 30 | No `console.error` storms in `adb logcat` | tail logcat for 60 s after install |
| 31 | `track('app_opened')` fires once per cold launch | PostHog Live events |

## Rollback rehearsal (every prod release)

| # | Check | How |
| --- | --- | --- |
| 32 | Previous AAB is still in Play Console "Internal app sharing" | confirm — needed if rollback decision lands within 7 days |
| 33 | Halt-rollout button is reachable from the release manager's account | dry-run in Play Console (do not actually halt) |

---

## What does NOT belong in this list

- Anything that requires a Play Store **submission** action (`eas submit`, "Send for review", "Rollout"). Those are gated by humans, not by smoke. This document is read-only against Play.
- Keystore rotation. Don't.
- Anything that touches production user data. Use the QA project / sandbox coach.

---

## TestFlight build 4 candidate checklist

iOS-side checklist for the cross-cutting flows the build-4 candidate must clear before being assigned to external TestFlight testers. Mirror format of the Android sections above. **Run on a physical iPhone, not a simulator** — push notifications, Sign in with Apple, Universal Links, and StoreKit all behave differently on a simulator and a stub passing on one says nothing about the other.

Save proof artefacts under `release-artifacts/ios-build-4-<date>/`. A row that lists a proof artefact but has no file is treated as not run.

| # | Flow | Pass criterion | Proof |
| --- | --- | --- | --- |
| T-1 | **Clean install** | Delete the app from the device, reinstall from TestFlight, launch cold. Splash + Welcome render without flash; no Sentry init failure surfaces in Console.app. | Screenshot `clean-install.png`. |
| T-2 | **Email signup with invite code** | Tap a `tgp://join/<sandbox-code>` link → `CreateAccount` opens with code prefilled. Submit a fresh email + password → land on RoleSelection → Home. Verify the new user row in Supabase has `coach_id` set atomically (no second `/auth/attach-invite-code` call needed). | Screen record `signup-invite.mov` + Supabase row screenshot. |
| T-3 | **Universal Link from outside the app** | From the Messages app, tap a link of the form `https://app.trygrowthproject.com/join/<sandbox-code>`. The app must open silently (no Safari chooser, no banner). If a chooser appears, the AASA file at `https://app.trygrowthproject.com/.well-known/apple-app-site-association` is missing or has the wrong Team ID (see RELEASE_BLOCKER.md). | Screen record `universal-link.mov`. |
| T-4 | **Auth refresh after 90 min** | Sign in. Background the app, leave the device for ~90 min (Supabase access token TTL is 60 min by default; pick a window past expiry). Bring the app to the foreground and tap any tab that hits the backend (Home → today summary). A single silent 401 → refresh → retry round-trip must succeed; the user must NOT be bounced to Welcome. Check Sentry breadcrumbs: one `api.refresh` event, no `logout` emit. | Screenshot of Home loading after the wait + screenshot of Sentry breadcrumbs for that session. |
| T-5 | **Messaging push (end-to-end)** | As coach in the web console, send a message to the test client. Lock the iPhone. Within ~30 s the push lands on the lock screen with the coach's name + message preview. Tap the push → app opens directly to the conversation (not Home). | Screenshot `push-lock-screen.png` + screen record `push-tap-route.mov`. |
| T-6 | **Food log — barcode + manual** | Open the food logger, scan a real barcode (e.g. a bottle of water), confirm per-100g macros render correctly. Then log a manual meal with a custom quantity (e.g. 150 g). Daily totals on Home update without a reload. The `food_logs` row in the backend must carry the original quantity + unit (not pre-converted grams) — see #138 contract. | Screenshot of food logger after each entry + Supabase row screenshot. |
| T-7 | **Workout video playback** | Open today's workout, tap an exercise → video plays inline. Scrub forward; audio plays through device speaker; exiting the player returns to the exercise list, not the workout home. | Screen record `workout-video.mov`. |
| T-8 | **AI draft (Coach AI v1)** | As coach, open the test client → Coach AI tab → tap "Draft this week's plan". A workout draft, a meal draft, and an insight draft render within ~20 s. Edit one field in each. Tap **Approve** → the draft transitions to assigned for the client (verify on the client account that the new plan / meal / insight is visible on Home next refresh). | Screen records `ai-draft-generate.mov` + `ai-draft-approve.mov`. |
| T-9 | **Connect onboarding (coach Stripe Connect)** | As a coach without a Stripe Connect account, open Payments / Billing → "Set up payouts". The in-app browser opens the Stripe Connect onboarding flow. Complete (or sandbox-complete) the form. On redirect back, the coach lands on Payments with `connect_status === 'enabled'`. | Screen record `connect-onboarding.mov`. |
| T-10 | **Billing checkout (client subscription)** | As a client, open a paid plan upsell surface → "Subscribe". The in-app browser opens Stripe Checkout. Complete payment with the Stripe test card `4242 4242 4242 4242`. On redirect, the client sees the subscribed state on the same screen (no need to restart the app). The backend webhook must mark the user `subscribed=true` before the redirect resolves — if there's a race where the client returns before the webhook fires, the screen retries within ~3 s. | Screen record `billing-checkout.mov` + Supabase / backend row screenshot. |
| T-11 | **Account deletion (GDPR right to erasure)** | More → Trust Center → Delete account. Confirm the destructive modal. `POST /system/account-delete` returns 202; the app signs out and lands on Welcome. On the backend, verify the user row is soft-deleted within ~5 min (the cron drops it on the schedule documented in `TrustCenterScreen`). Attempt to log in again — credentials are rejected. | Screenshot `account-deleted-welcome.png` + backend deletion-log screenshot. |
| T-12 | **Data export (GDPR Article 20)** | More → Trust Center → Export my data. `POST /system/data-export` returns 202. Within ~5 min an email arrives with a signed download URL (or the in-app surface flips to "Ready — tap to download"). Open the file and confirm it includes the user's profile, logs, and message history in machine-readable JSON. | Email screenshot + `data-export.json` saved to `release-artifacts/`. |

If any T-row fails, do **not** assign the build to external testers — open a bug, fix on a follow-up branch, bump `buildNumber` to 5, and re-cut. TestFlight does not allow re-using a buildNumber for the same `version` string.
