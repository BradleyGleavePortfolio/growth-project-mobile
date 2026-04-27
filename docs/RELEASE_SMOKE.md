# Android release smoke checklist

Run this end-to-end against an EAS `preview` APK or `production` AAB before promoting a build to internal testing → closed testing → production. The list mirrors what Play review will exercise. **Do not** skip an item because "the code didn't change" — release smoke catches infra and signing regressions, not source bugs.

A scripted sub-set lives at `scripts/release-smoke.sh` for the parts that can be automated from a connected device.

---

## Pre-build

| # | Check | How |
| --- | --- | --- |
| 1 | `versionCode` bumped past last Play upload | `jq '.expo.android.versionCode' app.json` and compare to Play Console → Releases → Internal testing |
| 2 | `version` bumped (semver) | `jq '.expo.version' app.json` |
| 3 | App config validates | `npm run validate:config` |
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
| 11 | Push permission prompt fires once | tap through; second launch must NOT re-prompt |
| 12 | Notification channels created on Android | `adb shell dumpsys notification \| grep -A1 'NotificationChannel.*com.growthproject.app'` shows `default`, `water`, `fasting` |

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
| 18 | Custom scheme `tgp://join/<code>` opens CreateAccount with code prefilled | `adb shell am start -a android.intent.action.VIEW -d "tgp://join/SMOKE01" com.growthproject.app` |
| 19 | Universal link `https://app.tgp.com/join/<code>` opens app silently (no chooser) | requires `assetlinks.json` hosted; see `docs/well-known/README.md`. Run `adb shell pm get-app-links com.growthproject.app` to confirm `app.tgp.com: verified` |
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
| 25 | Foreground notification renders (water reminder fires) | trigger `scheduleWaterReminder(0.001)` from a dev build, or manually post `adb shell cmd notification post -t "Hydrate" smoke 'Drink water'` |
| 26 | Background tap routes back to the app | post a notification, swipe app away, tap notification → app reopens |
| 27 | Notification shows correct channel name in long-press → settings | "Default" / "Water Reminders" / "Fasting Alerts" |

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
