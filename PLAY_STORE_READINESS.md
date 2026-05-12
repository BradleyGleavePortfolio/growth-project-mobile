# Play Store Readiness — The Growth Project (Android)

This is the working checklist for taking `tgp-health-and-wellness` to the Google Play Store. It is **not a submission instruction** — it is the source of truth for what must be true before a sale-ready build is uploaded.

The corresponding iOS notes live alongside each item in parentheses where they differ.

---

## 1. App identity

| Field            | Value                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------ |
| App name         | `The Growth Project` (`expo.name` in `app.json`)                                           |
| Package name     | `com.growthproject.app` (`expo.android.package`, also iOS `bundleIdentifier`) — **immutable** once published |
| Version          | `expo.version` — bump on every release                                                     |
| Android `versionCode` | Must increase monotonically per build. EAS handles this if `appVersionSource: "remote"` is used; we currently use `local`, so bump it manually in `app.json`. |
| iOS `buildNumber`     | Same convention; bump per upload to TestFlight                                         |
| Slug             | `tgp-health-and-wellness` (`expo.slug`)                                                    |
| EAS project id   | `a12c3345-cc8c-4c2c-9c57-711c10a57c1c`                                                     |

## 2. Signing

- Production signing is delegated to **EAS Build** (`eas.json` → `production.distribution: "store"`).
- The first production build will create a **Play App Signing** keystore in EAS managed credentials. After that:
  - Do **not** rotate or regenerate the keystore. Losing it means the package is dead on Play.
  - Treat the keystore as a top-tier secret. Back up via `eas credentials` exports if EAS account access is ever in doubt.
- The app is **not** distributed via APK to end users — production is AAB only.
- For internal QA: `preview` profile in `eas.json` builds an APK for sideloaded testers.

## 3. Privacy policy

- A live, public-URL privacy policy is **required** before the listing will accept a "Data safety" form.
- Hosting target: marketing site at `https://app.trygrowthproject.com/privacy` (TBD — confirm this URL is published before submission).
- Content must cover: data collected, why, who it is shared with, retention, deletion request flow, contact email.
- Must match what the in-app **Trust Center** says (`src/screens/TrustCenterScreen.tsx`). Trust Center exposes:
  - Data export (calls `POST /system/data-export` via `track('data_export_requested')`)
  - Account deletion (calls `POST /system/account-delete` via `track('account_deletion_requested')`)
- The policy document and the Trust Center copy are the same source of truth — keep them in sync.

## 4. Data safety form (Play Console)

The form must be filled in to match what the app actually does. Current behavior:

| Category                        | Collected? | Shared off-device? | Encrypted in transit | Optional? | Reason                                                              |
| ------------------------------- | ---------- | ------------------ | -------------------- | --------- | ------------------------------------------------------------------- |
| Personal info — name, email     | Yes        | Yes (backend)      | Yes (TLS)            | Required  | Account creation, coach pairing                                     |
| Personal info — phone           | Yes        | Yes (backend)      | Yes (TLS)            | Optional  | Coach communication                                                 |
| Health & fitness — workouts, weight, body metrics | Yes | Yes (backend, coach) | Yes | Required (for the feature) | Core product use                                  |
| Health & fitness — food / nutrition logs | Yes | Yes (backend, coach) | Yes | Required (for the feature) | Core product use                                  |
| Photos & videos — barcode scans | Yes (device only) | No        | n/a                  | Optional  | Barcode scanning is local; we do not upload the camera frame        |
| App activity — analytics events | Yes        | Yes (PostHog)      | Yes                  | Optional  | Product analytics. PII is stripped via `stripPII` in `lib/analytics.ts` before send |
| Crashes / diagnostics           | Yes        | Yes (Sentry)       | Yes                  | Optional  | Stability — initialised in `services/sentry.ts`; no-ops without DSN |
| Audio                           | No         | n/a                | n/a                  | n/a       | We do not record audio                                              |
| Location                        | No         | n/a                | n/a                  | n/a       | We do not request location                                          |
| Contacts / SMS / Calendar       | No         | n/a                | n/a                  | n/a       |                                                                     |

Confirm the form with whichever account types are listed in the live privacy policy. If we add features that touch a new category, this table is the diff to update.

### Permissions declared

`app.json` only declares one runtime permission today:

- iOS: `NSCameraUsageDescription` — barcode scanning. The Android equivalent (`<uses-permission android:name="android.permission.CAMERA"/>`) will be auto-added by Expo when a camera-using plugin is included, or must be added explicitly if barcode scanning lands.
- Push: `expo-notifications` is in plugins; on Android this generates the `POST_NOTIFICATIONS` permission automatically. Required because the runtime permission prompt is fired in `App.tsx → requestNotificationPermissions()`.

## 5. Screenshots

Play Console requires **at least 2** Android phone screenshots, recommended set is 4–8. Use the same neutral palette and Cormorant headlines that the rest of the app does.

Suggested capture set (post-Wave-5):

1. Welcome (`WelcomeScreen`) — bone background, serif title, "Get Started" / "Log In"
2. Home (`HomeScreen`) — daily milestone list
3. AI Guide (`AIGuideScreen`) — chat conversation showing structured-context reply
4. Log (`LogScreen`) — meal + water + macro view of one day
5. Profile (`ProfileScreen`) — name + identity title + streak line

iOS App Store: same five screens at 6.7" device (iPhone 15 Pro Max simulator).

## 6. Deep links

App declares (`app.json`):

- Custom scheme: `tgp://`
- Universal link host: `https://app.trygrowthproject.com` (iOS `associatedDomains: applinks:app.trygrowthproject.com`)
- Android intent filter: `autoVerify: true` for both `tgp://join` and `https://app.trygrowthproject.com/join`

Navigation linking is wired in `src/navigation/RootNavigator.tsx` via `LinkingOptions`:

```
prefixes: ['tgp://', 'https://app.trygrowthproject.com']
config: { screens: { CreateAccount: 'join/:invite_code?' } }
```

That maps:

- `tgp://join/AB12CD` → `CreateAccount` with `route.params.invite_code = 'AB12CD'`
- `https://app.trygrowthproject.com/join/AB12CD` → same screen, same param
- `CreateAccountScreen` already auto-previews the invite code on mount when the param is present.

Server-side requirements for `autoVerify: true` (Android App Links):

- Host an `assetlinks.json` at `https://app.trygrowthproject.com/.well-known/assetlinks.json` containing the SHA-256 cert fingerprint of the **Play App Signing** key. Get it from `eas credentials → Android → Production → keystore`.
- For iOS universal links: host `apple-app-site-association` at `https://app.trygrowthproject.com/.well-known/apple-app-site-association` covering bundle id `com.growthproject.app`.

These two files are the gate that promotes our deep links from "opens a chooser" to "opens the app silently". They must exist before the first production release if marketing intends to use the universal-link form.

Templates live in `docs/well-known/` — copy them to the marketing site repo, fill in the placeholders (Play App Signing SHA-256 for Android, Apple Team ID for iOS), and ship. `docs/well-known/README.md` has the verification commands (`curl`, `adb shell pm get-app-links`, Apple's AASA-CDN endpoint).

## 7. Google OAuth

The app does **not** ship a native Google Sign-In SDK. Sign-in is brokered through **Supabase OAuth** (see `src/utils/googleAuth.ts`).

Implication for Play Store / data safety: there is no Android client ID, no iOS client ID, and no Google API key embedded in the mobile build. The OAuth client/secret pair lives in the **Supabase dashboard** (Authentication → Providers → Google), backed by a single Web client in **Google Cloud Console**.

What needs to be true before production:

1. **Google Cloud Console → OAuth consent screen** must be in `Production` state (not `Testing`), or only listed test users can sign in.
2. The **OAuth Web client** registered in Supabase must list this redirect URI:
   - `https://<supabase-project-ref>.supabase.co/auth/v1/callback`
3. The **Supabase auth → URL configuration → redirect URLs** must include:
   - `tgp://auth/callback` (custom scheme)
   - `https://app.trygrowthproject.com/auth/callback` (if web parity is wanted later)
4. Anonymous-key + Supabase URL flow through `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`). These are public by design (anon role) — secret material lives only in the Supabase dashboard.

Stale variables removed: `.env.example` previously listed `EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS/ANDROID`. They are not read anywhere in the codebase. The .env.example has been updated to explain why.

## 8. Push notifications proof

Play Console asks for proof that push-notification permission usage is consistent with declared purpose.

Wire-up:

- `expo-notifications` is registered in `app.json → expo.plugins`.
- The runtime ask happens in `App.tsx → requestNotificationPermissions()` from `src/utils/notifications.ts`.
- Use case for the listing: coach messages, milestone reminders, log-streak nudges. (No marketing pushes — keep this commitment in the listing copy.)

For the data safety form: declare *Personal communications → in-app messages* as the use, not *Marketing*. Keep this honest — Play will reject the listing if observed traffic doesn't match.

## 9. Test accounts

For Play review, supply at least:

- One **client** account with an attached coach (so reviewers can see the AI Guide, Messages, Log flows populated).
- One **coach** account with at least one client (so reviewers can see the coach navigator, including ClientDetail and Messages).

Because signup is invite-gated (`require_invite_code: true` is the default returned by `/auth/signup-policy`), reviewers cannot self-register. Either:

- (a) Provide a working invite code that maps to a sandbox coach, plus a verified email + password, or
- (b) Provide pre-created accounts with valid sessions.

Option (b) is preferable — it means review can run without standing up a fresh Supabase email-verification round. Document the credentials in the Play Console "App access" instructions field, never in this repo.

## 10. Release tracks

Recommended progression (Play Console terms):

1. **Internal testing** (up to 100 testers) — first build, smoke test the OAuth + invite flow.
2. **Closed testing → Alpha** — paying-customer pilot, ~14 days on track.
3. **Open testing → Beta** — only if we want a public "join the beta" surface. Optional.
4. **Production** → **rollout staged at 5% → 20% → 50% → 100%** over a week. Rollback is a real button if Sentry crash-free sessions drop below 99%.

For iOS: TestFlight internal → external (90-day cycle) → App Store Connect production with phased release enabled.

## 11. Pre-submission verification checklist

Run through this list locally on the production build before uploading. The full smoke matrix lives at `docs/RELEASE_SMOKE.md`; the automatable subset is `scripts/release-smoke.sh`.

```bash
# Static checks (CI runs these, but rerun locally before tagging a release)
npm run typecheck
npm run lint
npm test -- --ci --passWithNoTests
npm run validate:config

# Pre-publish gate — promotes every REPLACE_WITH_* placeholder in the
# well-known templates and any null entry in expo.extra.storeListings to a
# hard error. Run this against the AAB you intend to upload, never just
# against `main`.
npm run validate:release

# After installing the APK on a connected device
npm run smoke:android
```

Manual sign-off items that scripts cannot cover:

- [ ] App boots on a fresh install with no Supabase env vars set → env validation throws, splash + welcome never render (this is the desired loud-fail behavior from `src/config/env.ts`)
- [ ] App boots on a fresh install with prod env vars → can sign in via email/password
- [ ] Google sign-in completes and lands on RoleSelection (new user) or Home (returning)
- [ ] Deep link `tgp://join/TESTCODE` opens CreateAccount with invite code prefilled
- [ ] Deep link `https://app.trygrowthproject.com/join/TESTCODE` opens the same screen (after `assetlinks.json` is hosted)
- [ ] Trust Center → Export data triggers `data_export_requested` analytics event
- [ ] Trust Center → Delete account triggers `account_deletion_requested` analytics event
- [ ] Notifications permission prompt fires once on first launch and never again
- [ ] No self-serve "Become a coach" UI is reachable from any client surface (this is verified — `RoleSelectionScreen` hardcodes `selectRole('student', …)`)
- [ ] No console references to staging or localhost URLs remain

### Blocking manual values needed before first production submission

These cannot be derived from the codebase — someone has to fetch them and either fill them into `docs/well-known/*` (then host on `app.trygrowthproject.com`) or paste them directly into Play / App Store Connect:

| Value | Source | Used by |
| --- | --- | --- |
| Play App Signing SHA-256 fingerprint | Play Console → Setup → App integrity → App signing (after first AAB upload) | `assetlinks.json` (replaces `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`; `npm run validate:release` blocks publish until done) |
| Apple Team ID (10-char) | App Store Connect → Membership | `apple-app-site-association` (replaces `REPLACE_WITH_APPLE_TEAM_ID`; `npm run validate:release` blocks publish until done) |
| Play Store listing URL | Play Console → Store presence → Main store listing → Share, after the listing is published | `app.json → expo.extra.storeListings.playStoreUrl`. Until published, leave as `null`; `npm run validate:release` rejects `null` so the value cannot be forgotten. |
| App Store listing URL | App Store Connect → App Information → "View on the App Store", after first approved version | `app.json → expo.extra.storeListings.appStoreUrl`. Same fail-loud rule as the Play URL. |
| Privacy policy URL | Marketing site, `https://app.trygrowthproject.com/privacy` | Play Data Safety form, App Store privacy nutrition label |
| Test account credentials (client + coach) | Internal QA | Play "App access" instructions, App Store review notes |
| Supabase project ref (for OAuth redirect) | Supabase dashboard URL | Google Cloud Console authorized redirect URIs |

## 12. Rollback plan

Production builds are AAB only and are signed by Play's keystore. To roll back:

1. In Play Console, halt the staged rollout.
2. Promote the previous production build to 100%.
3. New uploads must have a higher `versionCode` — never reuse a number, even after rollback.

Sentry release tags + PostHog release filter make it possible to compare crash-free sessions and event volume between two adjacent versions; that's the signal that decides whether to roll forward or back.
