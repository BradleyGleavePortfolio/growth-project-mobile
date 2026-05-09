# EAS Build — `growth-project-mobile`

Production build commands, TestFlight and Play Internal Testing flow, and the failure modes that have actually bitten us. For the full Play readiness checklist, see `PLAY_STORE_READINESS.md`. For the new-engineer codebase tour, see `ONBOARDING.md`.

Last verified: 2026-05-09.

---

## App identity

| Field | Value |
|---|---|
| Display name | The Growth Project (`expo.name` in `app.json`) |
| Bundle id / package | `com.growthproject.app` (immutable) |
| Slug | `tgp-health-and-wellness` |
| EAS project id | `3aeadee6-34c5-4231-85b9-aff9f7ea3c5a` |
| Build profiles (`eas.json`) | `production`, `preview`, `development` |
| `appVersionSource` | `local` — bump `expo.version` plus `expo.ios.buildNumber` and `expo.android.versionCode` manually in `app.json` per release |

---

## One-time setup

```bash
npm install -g eas-cli
eas login
eas project:info   # confirm project id matches the table above
```

You also need:

- An Apple developer account in good standing, the app listed in App Store Connect, and a Distribution provisioning profile (EAS will provision automatically on first build).
- A Google Play developer account, an internal-testing track set up for `com.growthproject.app`, and an EAS Play service account credential uploaded (`eas credentials → Android → Production`).

---

## Production build

### iOS — TestFlight (with auto-submit)

```bash
eas build --platform ios --profile production --auto-submit
```

This kicks off a release build on EAS managed credentials, signs with the App Store distribution profile, and on success uploads to App Store Connect. The build then appears in TestFlight under "iOS Builds" once Apple's Processing step completes (usually 5 to 30 minutes after upload).

### iOS — TestFlight (manual upload)

```bash
eas build --platform ios --profile production
# When the build completes, copy the artifact URL from the EAS dashboard
# and submit explicitly:
eas submit --platform ios --latest
```

### Android — Play Internal Testing (with auto-submit)

```bash
eas build --platform android --profile production --auto-submit
```

This builds a signed `.aab`, signs with the EAS-managed Play App Signing keystore, and submits to the internal testing track configured in `eas.json → submit.production.android.track`.

### Android — manual upload

```bash
eas build --platform android --profile production
eas submit --platform android --latest
```

### Preview / sideload (Android APK)

```bash
eas build --platform android --profile preview
```

`preview` produces an APK suitable for sideloaded QA testers. Production never ships APK to end users — production is AAB only.

---

## Pre-flight

Always run before `eas build`:

```bash
npm run validate:release
```

This is also the first CI step on every PR. It hard-fails on:

- Stale `expo.ios.buildNumber` (must increase monotonically vs the latest TestFlight build).
- Stale `expo.android.versionCode` (must increase monotonically vs the latest Play Internal Testing build).
- `app.json → expo.extra.storeListings.appStoreUrl === null` or `playStoreUrl === null` (gating placeholders — the validator refuses to ship until both are set to live URLs).
- `assetlinks.json` containing `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` (the validator refuses to ship until the real fingerprint is pasted in from `eas credentials → Android → Production → keystore`).
- Missing or invalid `EXPO_PUBLIC_*` env vars per `eas.json` env blocks.

---

## Bumping versions

Production releases bump `expo.version` plus the per-platform monotonic counters:

```jsonc
// app.json
{
  "expo": {
    "version": "1.4.2",
    "ios":     { "buildNumber":  "9" },
    "android": { "versionCode":  9 }
  }
}
```

Bump `version` with semver (patch / minor / major depending on the change). Bump `buildNumber` and `versionCode` by 1 every time you upload to a store track, even if `version` did not change — Apple and Google reject duplicate build numbers.

---

## Common errors and fixes

### `ITMS-90186: Invalid build number — must be greater than the previous build`

Apple has indexed the build number from a previous TestFlight upload. The local `app.json` no longer reflects the highest. Bump `expo.ios.buildNumber` by one (or to one higher than the value Apple is complaining about), commit, rebuild.

### `Version code <N> has already been used`

Same as above on the Play side. Bump `expo.android.versionCode`.

### `expo-build-properties` complaining about a pinned native dep

`expo-build-properties` pins the iOS deployment target and the Android compile / min / target SDK. When upgrading Expo SDK, re-read the SDK upgrade notes — the pinned values usually need to move in lockstep. Affected file: `app.json → plugins → expo-build-properties`.

### Build green but TestFlight build never appears

Apple's Processing step took longer than 30 minutes, or the IPA failed Apple's notarisation silently. Check App Store Connect → My Apps → TestFlight → "Build" tab for an "Invalid Binary" message. If the build is rejected, the rejection email lists the reason — usually a missing Info.plist key (most often `NSCameraUsageDescription` or similar).

### EAS build fails with `Could not find module 'react-native-foo'` after a clean install

Native dependency missing from `package.json` or pinned to a version Expo SDK does not support. Check `expo doctor` output. If the dep was added recently, confirm the EAS Build cache was invalidated by bumping the install layer (changing `package-lock.json` is enough).

### Sentry source maps not appearing on a release

`SENTRY_AUTH_TOKEN` not set as an EAS Secret. Set it with:

```bash
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>
```

The build still succeeds without the secret — the Sentry config plugin's upload step no-ops with a warning rather than failing the build, so the gate is "lossy-but-loud" rather than hard-fail. See README "Sentry release tracking" for the full chain.

### iOS `Sign In with Apple` button missing or rejected at review

`ios.usesAppleSignIn` must be `true` in `app.json`, the `expo-apple-authentication` plugin must be present, and the **Sign In with Apple** capability must be enabled in the Apple Developer portal for `com.growthproject.app`. Re-run the build after enabling. EAS will pull a fresh provisioning profile.

### Android `assetlinks.json` returning the placeholder fingerprint

`https://app.trygrowthproject.com/.well-known/assetlinks.json` must serve the real SHA-256 fingerprint of the Play App Signing key. Get it from `eas credentials → Android → Production → keystore`. Until then, `npm run validate:release` blocks publish.

### Expo SDK 55 quirks

- `expo-sqlite` async API is the only supported path; the legacy synchronous API was removed. We migrated off WatermelonDB to `expo-sqlite` in commit `0dbc0a6`.
- New Architecture is on by default in SDK 55. If a third-party native module misbehaves, check its README for `newArchEnabled` compatibility before disabling globally.
- Hermes is the only supported JS engine in production.

---

## After a successful build

1. Confirm the build appeared in TestFlight or Play Internal Testing.
2. Run the smoke flow per `docs/RELEASE_SMOKE.md` against the new build on a real device.
3. Promote to public TestFlight (external testers) or to the Play Closed Testing track only after the smoke flow passes.
4. Update Sentry release filters to include the new build identifier (`<version>+<buildNumber|versionCode>` — see README "Sentry release tracking").
