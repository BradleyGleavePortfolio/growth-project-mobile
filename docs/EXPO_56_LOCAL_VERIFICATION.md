# Expo SDK 56 — Local Native Build Verification

PR #192 upgraded the JavaScript/TypeScript surface to Expo SDK 56 + React
Native 0.85.3 and aligned every Expo-managed peer (Stripe, NetInfo,
gesture-handler, screens, safe-area-context, svg, worklets, react,
react-dom, typescript, jest-expo, react-test-renderer, @react-native/jest-preset).

The hosted audit environment does NOT have Xcode or Android Studio, so the
**native** half of the upgrade is unverified. Before merging PR #192, Dynasia
must run the steps below on a macOS workstation with both toolchains
installed and capture the output in the PR.

## 1. Clean install

```bash
cd /path/to/growth-project-mobile
git checkout dependabot/npm_and_yarn/expo-872c76bb12
git pull --ff-only
rm -rf node_modules package-lock.json ios android
npm install --legacy-peer-deps
npx expo install --check    # must print "Dependencies are up to date"
npx expo-doctor             # must print "21/21 checks passed"
```

## 2. iOS prebuild + Xcode build

```bash
npx expo prebuild --clean --platform ios
cd ios
pod install
xcodebuild \
  -workspace *.xcworkspace \
  -scheme "The Growth Project" \
  -configuration Debug \
  -sdk iphonesimulator \
  clean build
cd ..
```

Required manual confirmations:

1. CocoaPods install succeeds with no version-resolution warnings.
2. Xcode Debug build succeeds on the SDK 56 generated iOS project.
3. The app launches on the iOS Simulator and shows the bone splash
   followed by the root navigator.
4. Stripe checkout opens inside `BrandedCheckoutWebView`; the payment
   sheet fallback does not crash.
5. The exercise detail screen renders the SDK 56 `VideoView` and the
   fullscreen + Picture-in-Picture controls work.
6. Push permission request, foreground notification handler, scheduled
   fasting notification cancel path, and sign-out notification
   unregister path all work on device.
7. Universal links for `https://app.trygrowthproject.com/join/<code>`,
   `/invite/accept/<token>`, `/reset-password`, and `/p/<token>` open
   the app silently after the hosted AASA file is verified.

If a release build is required, also run:

```bash
xcodebuild \
  -workspace ios/*.xcworkspace \
  -scheme "The Growth Project" \
  -configuration Release \
  -sdk iphoneos \
  build
```

## 3. Android prebuild + Gradle build

```bash
npx expo prebuild --clean --platform android
cd android
./gradlew clean assembleDebug
cd ..
```

For a release build:

```bash
cd android
./gradlew assembleRelease
cd ..
```

Required manual confirmations:

1. Android Gradle Debug build succeeds with the generated
   `compileSdkVersion` / `targetSdkVersion` values from prebuild.
2. The APK launches on an Android emulator and reaches the root
   navigator without crashing.
3. The dark status bar overlays the bone background as expected
   (`StatusBar.setBackgroundColor('#F5EFE4', false)` is applied at
   module load).
4. Deep links to `tgp://join/<code>`, `tgp://invite/accept/<token>`,
   and `https://app.trygrowthproject.com/...` reach the right screens.
5. Stripe payment sheet renders on Android.
6. The exercise detail screen renders `VideoView` and the
   fullscreen + PiP controls work.

## 4. Android App Links — placeholder fingerprint (audit P2-2)

`docs/well-known/assetlinks.json` still contains
`REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT`. This is a
deployment-side artifact, not a code change: the real SHA-256 must be
pulled from Google Play Console (Setup → App integrity → App signing key
certificate → SHA-256 fingerprint), pasted into the JSON, and the file
must be hosted at:

```
https://app.trygrowthproject.com/.well-known/assetlinks.json
```

After hosting, verify with:

```bash
adb shell pm get-app-links com.growthproject.app
# Look for "Domain verification state: verified" for app.trygrowthproject.com
```

Until the fingerprint is real and hosted, `https://app.trygrowthproject.com/...`
deep links will open a chooser on first launch instead of jumping silently
into the app. The release validator (`npm run validate:release`) treats this
as a blocking gate (P2-3 fix: now exits non-zero).

## 5. Documented audit deferrals

| Finding | Status | Reason |
|---|---|---|
| P2-2 Android App Links fingerprint placeholder | DEFERRED | Requires Play Console signing key; tracked in `RELEASE_BLOCKER.md`. |
| P3-1 `as any` + stale hook warnings | DEFERRED | Out of scope for this SDK-alignment PR; tracked for a follow-up. |

## 6. Smoke gates (re-run after native builds)

```bash
npm run lint              # zero errors
npx tsc --noEmit          # green
npm test                  # 123 suites pass
npm run validate:release  # currently exits 1 until App Links fingerprint
                          # is replaced; expected to exit 0 post-fingerprint
```

If any of the above fails, do not merge. Comment the failure on PR #192
and re-open the fix round.
