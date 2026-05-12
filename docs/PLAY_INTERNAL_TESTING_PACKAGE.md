# Play Internal Testing — submission package

Single source of truth for the **first** Play Console upload (track: *Internal testing*, up to 100 testers). Everything Play asks for during that flow is either answered below or pointed at the file that owns it.

This document does not trigger a build. It does not upload anything. It captures the inputs needed to do those things later, by hand, with eyes open.

---

## TL;DR — what's blocking submission

| # | Item | Where it comes from | Status |
| --- | --- | --- | --- |
| 1 | Privacy policy live at `https://app.trygrowthproject.com/privacy` | Marketing site | **needed before Data Safety form** |
| 2 | Test account credentials (1 client + 1 coach) | Internal QA (sandbox project) | **needed for Play "App access"** |
| 3 | Production API URL set in EAS env (`https://api.trygrowthproject.com/api`) | `eas env:create --environment production …` | **needed before first AAB build** |
| 4 | Production Supabase URL + anon key set in EAS env | Supabase dashboard → Settings → API | **needed before first AAB build** |
| 5 | First AAB uploaded so Play takes over signing | `eas build -p android --profile production` (then `eas submit` *manual*) | gate for #6 |
| 6 | Play App Signing SHA-256 → host `assetlinks.json` | Play Console → Setup → App integrity | needed before universal links verify |
| 7 | 2–8 phone screenshots | see § Screenshots | needed for store listing |

Items 3–7 are the critical path. Items 1–2 are blocked on people, not code.

---

## 1. App identity (immutable post-launch)

| Field | Value |
| --- | --- |
| Display name | `The Growth Project` |
| Package name | `com.growthproject.app` |
| Slug | `tgp-health-and-wellness` |
| EAS project id | `a12c3345-cc8c-4c2c-9c57-711c10a57c1c` |
| Marketing host | `app.trygrowthproject.com` (universal links, privacy policy) |
| API host | `api.trygrowthproject.com` |
| Auth | Supabase (Google OAuth brokered via Supabase, no native SDK) |

Source of truth: `app.json` and `src/config/env.ts`. Validated by `npm run validate:config`.

## 2. Version + versionCode strategy

**Current state** (this PR sets the baseline):

- `expo.version` = `1.0.0`
- `expo.android.versionCode` = `2`
- `expo.ios.buildNumber` = `2`

**Why versionCode = 2 and not 1**: `versionCode` 1 has historically been used for a debug AAB experiment in this project's lineage. Starting Internal Testing at 2 leaves headroom and avoids any accidental "this number was already uploaded" rejection from Play.

**Bump rules going forward** (`appVersionSource: "local"` in `eas.json` — we do this manually, EAS does not auto-increment):

- Internal-testing rebuilds (no functional change): bump `versionCode` only, keep `version` the same.
- Closed/Open testing rebuilds: bump `versionCode`. Bump `version` if shipping new behavior.
- Production: bump both. `version` follows semver (`1.0.0` → `1.0.1` for a hotfix, `1.1.0` for a feature, etc.).

**Never reuse a `versionCode`**, even after a halted rollout. Play remembers every number that hit any track.

For the matching iOS releases, increment `buildNumber` in lockstep so that the two stores never get out of sync — a habit, not enforced.

## 3. Production environment profile

EAS `production` profile in `eas.json` is `distribution: store`. It inherits no env vars from this repo — they MUST be set in EAS Cloud:

```bash
# Backend API base — production
eas env:create --environment production \
  --name EXPO_PUBLIC_API_URL \
  --value https://api.trygrowthproject.com/api

# Supabase — production project
eas env:create --environment production \
  --name EXPO_PUBLIC_SUPABASE_URL \
  --value https://<prod-supabase-ref>.supabase.co
eas env:create --environment production \
  --name EXPO_PUBLIC_SUPABASE_ANON_KEY \
  --value <prod-anon-key>

# Verify
eas env:list --environment production
```

The `preview` profile (used to build the APK that ships to internal testers via `distribution: internal`) needs the same three vars under `--environment preview`. Use the **same** prod backend if you want testers exercising the real path; use a staging Supabase if you want their accounts segregated.

DO NOT set:

- `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS` / `EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID` — auth is Supabase-brokered. `validate-app-config` flags these as forbidden in `.env.example` and they should be absent from EAS env too.

The fail-loud behavior in `src/config/env.ts:13-18` and `src/config/env.ts:31-34` means the app refuses to boot if any of the three vars is missing in a non-dev build. Verify by booting an Android emulator off a fresh APK with the vars unset — Welcome screen never paints.

## 4. EAS config validation (no live build)

`npm run validate:config` runs `scripts/validate-app-config.js` which performs static checks against `app.json`, `.env.example`, and `docs/well-known/*`. It catches:

- scheme / package id / bundle id drift
- universal-link host or `pathPrefix` regression
- missing `autoVerify: true` on the https intent filter
- `versionCode` < 1 or non-numeric
- required env keys missing from `.env.example`
- forbidden (Google client id) env keys
- `assetlinks.json` package mismatch
- `apple-app-site-association` bundle id mismatch

A green run is a precondition for a build. CI should run it on every PR.

Additional sanity, no extra script needed:

```bash
# Confirm EAS sees the project + the env we expect
eas project:info
eas env:list --environment production
eas env:list --environment preview

# Confirm requireCommit — eas.json sets it; this is the cliff
git status --porcelain   # must be empty before `eas build`
```

## 5. Android permissions review

`app.json` declares no Android `<uses-permission>` entries directly. Permissions are inferred by Expo from the plugins/APIs in use. Resulting AndroidManifest will (per Expo SDK 55 defaults for the libraries we depend on) include:

| Permission | Source | Visible to user? | Justification (for Data Safety + listing) |
| --- | --- | --- | --- |
| `android.permission.INTERNET` | implicit (RN) | no | API calls |
| `android.permission.ACCESS_NETWORK_STATE` | `@react-native-community/netinfo` | no | Detect offline state for queue + retry |
| `android.permission.POST_NOTIFICATIONS` | `expo-notifications` | yes (Android 13+ runtime prompt) | Coach messages, milestone reminders, log-streak nudges |
| `android.permission.VIBRATE` | `expo-notifications` / `expo-haptics` | no | Notification + tactile feedback |
| `android.permission.WAKE_LOCK` | `expo-notifications` | no | Trigger scheduled local notifications |
| `android.permission.RECEIVE_BOOT_COMPLETED` | `expo-notifications` | no | Re-arm scheduled notifications after device reboot |

Camera permission is **not** declared because barcode scanning is currently behind a feature gate that is not enabled in the production profile. Adding that flow later means the iOS `NSCameraUsageDescription` in `app.json` becomes load-bearing on Android too — Expo will auto-add `<uses-permission android:name="android.permission.CAMERA"/>`.

Run after the first AAB is built (one-time audit):

```bash
# Decompile the AAB / APK to confirm no extra permissions snuck in
unzip -p app-release.aab base/manifest/AndroidManifest.xml \
  | aapt2 dump xmltree --file - \
  | grep -E 'uses-permission|uses-feature'
```

If anything other than the table above shows up, that permission needs a justification before listing. The most common surprise is `READ_EXTERNAL_STORAGE` getting pulled in by a transitive dependency — investigate before submitting.

## 6. Data Safety form

Source of truth for the answers: `PLAY_STORE_READINESS.md` § 4. Summary copy-paste for the Play form:

- **Personal info**: name, email — collected, shared with backend over TLS, required.
- **Personal info**: phone — collected (optional), shared with backend over TLS.
- **Health & fitness**: workouts, weight, body metrics, food/nutrition logs — collected, shared with backend (and the user's coach), TLS, required for the feature.
- **Photos & videos**: barcode camera frames stay on device, never uploaded.
- **App activity**: PostHog analytics, optional, PII-stripped client-side (`src/lib/analytics.ts → stripPII`).
- **Crashes / diagnostics**: Sentry, optional, no PII.
- **Audio / Location / Contacts / SMS / Calendar**: not collected.

When the next feature lands that touches any new category, the diff is the table in `PLAY_STORE_READINESS.md` — update both that file and this one.

## 7. Privacy policy

- URL: `https://app.trygrowthproject.com/privacy` (must be live before the form will save).
- Content checklist: data categories from § 6, retention, deletion request flow (Trust Center → Delete account triggers `account_deletion_requested` → backend `POST /system/account-delete`), export flow (Trust Center → Export data → `POST /system/data-export`), contact email.
- Trust Center copy and the policy doc share a single source — keep them aligned. `src/screens/TrustCenterScreen.tsx` is the in-app surface.

## 8. Test accounts (Play "App access")

Signup is invite-gated. Reviewers cannot self-register. Provide pre-created accounts.

Create in the **production Supabase project**, isolated from real users (recommended: a `qa-` email prefix and a sandbox coach):

| Account | Email | Password | Role | Notes |
| --- | --- | --- | --- | --- |
| Client | `qa-client-1@trygrowthproject.com` | (vault) | client / student | Attached to the QA coach below |
| Coach | `qa-coach-1@trygrowthproject.com` | (vault) | coach | Has `qa-client-1` as a client, plus 1–2 dummy clients to make the list non-empty |

What to type into the Play Console "App access" → "All functionality is available with the credentials below" field:

> Email: `qa-client-1@trygrowthproject.com`
> Password: `<vault>`
> Notes: This is a client account. Use it to access Home, Log, AI Guide, Messages, Profile, and Trust Center. A second account `qa-coach-1@trygrowthproject.com` (same password) shows the coach experience including ClientDetail and Messages.

Do **not** check credentials into the repo. The accounts must work for the lifetime of the Play review window — set the password to never expire and disable any "force change on first login" toggle in Supabase.

Smoke-test the credentials before pasting them into Play:

```bash
# From a build with prod env vars
adb install -r preview-release.apk
# Sign in as qa-client-1, confirm Home renders, AI Guide returns a response,
# Trust Center → Export queues an event in Supabase logs.
```

## 9. Screenshots checklist

Play Console requires at least 2 phone screenshots; recommended 4–8. iOS App Store wants the same set at 6.7" (iPhone 15 Pro Max sim).

Capture on a Pixel 6 emulator (or a real Pixel 6 / 7) at native resolution, **portrait**, with the system bar showing the time `9:41`, full battery, full signal — `adb shell settings put global sysui_demo_allowed 1` then the demo-mode incantation if you want to fake those values.

Capture from a build with prod Supabase pointed at the QA accounts so the data on screen is real but boring.

Suggested set (mirrors `PLAY_STORE_READINESS.md` § 5):

1. **Welcome** — `WelcomeScreen`. Headline + Get Started / Log In CTAs. (no PII, runs on a fresh install)
2. **Home (client)** — `HomeScreen`. Daily milestone list with 1–2 items checked.
3. **AI Guide** — `AIGuideScreen`. Mid-conversation showing a structured-context reply. Avoid any PII in the rendered messages.
4. **Log** — `LogScreen`. One day's meals + water + macros visible.
5. **Profile** — `ProfileScreen`. Identity title, streak, no contact info.
6. *(optional)* **Coach view — ClientDetail** — proves coach pairing works end-to-end. Use `qa-coach-1`.
7. *(optional)* **Trust Center** — visual evidence of the privacy + data-control surface. Useful for the Data Safety review.

Put them in `assets/store/android/` (and `assets/store/ios/` for App Store). They are listing assets, not app assets — keep them out of the JS bundle. Filename convention: `01-welcome.png`, `02-home.png`, etc.

(Folder doesn't exist in repo yet — create it when QA captures the first set; this PR doesn't add screenshots, only the convention.)

## 10. Push notifications proof plan

Play Data Safety asks for proof that push notifications are used as declared. Declared use: **Personal communications → in-app messages, reminders**, NOT marketing.

Evidence we can produce on demand:

1. **Code path**: `App.tsx → requestNotificationPermissions()` (from `src/utils/notifications.ts`) — this is the only place the app asks. No background re-prompt.
2. **Send paths** (search results, current code):
   - Local: `scheduleWaterReminder`, `scheduleFastingReminder`, `scheduleStreakNudge` in `src/utils/notifications.ts`.
   - Server-pushed (via Expo push token): coach messages and milestone events, sent from the backend after a coach sends a Message or completes a milestone review.
3. **No marketing path**: grep for `marketing`/`promo` in send paths — should return nothing in `src/utils/notifications.ts` and nothing in the backend send pipeline.
4. **Channel separation** (Android): three channels — `default`, `water`, `fasting`. Verifiable via `adb shell dumpsys notification | grep -A1 'NotificationChannel.*com.growthproject.app'`. Each has a long-press → settings entry showing its purpose.

Reproduction script for an auditor:

```bash
# Install a preview APK, sign in as qa-client-1
adb install -r preview-release.apk

# Trigger a local notification from a dev build
# (or post via the system command from any APK)
adb shell cmd notification post -t "Hydrate" smoke-water "Time to drink water"

# Confirm channels are present
adb shell dumpsys notification | grep -A1 'NotificationChannel.*com.growthproject.app'

# Confirm the runtime prompt fired exactly once
adb shell dumpsys package com.growthproject.app | grep -A2 POST_NOTIFICATIONS
```

If a Play reviewer asks for further evidence, point them at this section + a short Loom showing the prompt copy on first launch and an example coach message arriving as a notification on a backgrounded app.

## 11. Pre-build verification (no upload)

```bash
# 1. Repo state clean (eas.json requires it)
git status --porcelain     # empty

# 2. Static checks all green
npm run validate:config
npm run typecheck
npm run lint
npm test -- --ci --passWithNoTests

# 3. EAS env present
eas env:list --environment production
eas env:list --environment preview

# 4. (optional) Render a local Gradle preview WITHOUT uploading
#    `eas build --local -p android --profile preview` builds an APK
#    on your machine. No network upload. No Play submission.
#    Skip if disk space / Android SDK is not available.
```

There is no `eas build --dry-run` flag — the closest dry-run we have is `npm run validate:config`, which is what enforces the things that would silently break a release.

When all four steps pass, the next manual action is `eas build -p android --profile production`. **That step is human-gated and is not run by this document.**

## 12. After the first upload (one-time setup)

1. Pull the **Play App Signing SHA-256** from Play Console → Setup → App integrity.
2. Paste it into `docs/well-known/assetlinks.json`, replacing `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`.
3. Pull the **Apple Team ID** from App Store Connect → Membership.
4. Paste it into `docs/well-known/apple-app-site-association`, replacing both occurrences of `REPLACE_WITH_APPLE_TEAM_ID`.
5. Hand both files to the marketing-site repo. Verify with:

```bash
curl -sS https://app.trygrowthproject.com/.well-known/assetlinks.json | jq .
curl -sS https://app.trygrowthproject.com/.well-known/apple-app-site-association | jq .
adb shell pm verify-app-links --re-verify com.growthproject.app
adb shell pm get-app-links com.growthproject.app    # expect: verified
```

Until that's done, deep links to `https://app.trygrowthproject.com/join/<code>` open a chooser on Android. The `tgp://` custom-scheme path always works.

## 13. Rollback

For Internal testing, rollback is trivial: stop distributing the broken AAB, upload a new one with a higher `versionCode`. Production rollback rules are in `PLAY_STORE_READINESS.md` § 12.

---

## Pointers

- `PLAY_STORE_READINESS.md` — the long-form readiness checklist (signing, deep links, OAuth, Data Safety table). Survives this submission.
- `docs/RELEASE_SMOKE.md` — manual smoke matrix for an installed build.
- `scripts/release-smoke.sh` — automatable subset of the smoke matrix, runs against a connected device.
- `scripts/validate-app-config.js` — static config validator, gates every build.
- `docs/well-known/README.md` — hosting + verification notes for `assetlinks.json` / `apple-app-site-association`.
- `src/config/env.ts` — the fail-loud env contract.
