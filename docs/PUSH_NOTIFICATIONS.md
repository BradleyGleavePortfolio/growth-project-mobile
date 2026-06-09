# Push Notifications — FCM + APNs

## Overview

The TGP mobile app receives push notifications via [Expo Push](https://docs.expo.dev/push-notifications/overview/), which acts as a relay between the backend (`growth-project-backend`) and the OS-level push services:

- **iOS** → Apple Push Notification service (APNs)
- **Android** → Firebase Cloud Messaging (FCM)

The backend never talks to FCM/APNs directly. It sends notifications to Expo Push, which fans out to the correct OS service.

## Required configuration

### Android (FCM)

Two things are required for Android push to work:

1. **`google-services.json`** at the repo root (this file).
2. **`app.json` → `expo.android.googleServicesFile`** pointing at `./google-services.json`.

When EAS Build runs `expo prebuild`, it copies the file into the generated `android/app/google-services.json` location automatically. The `android/` directory itself remains gitignored.

### iOS (APNs)

Expo manages APNs credentials automatically via EAS Build when you have an Apple Developer account configured. No file commit needed.

## Firebase project

- **Project ID:** `tgp-fitness`
- **Project Number:** `129391466712`
- **Android package name:** `com.growthproject.app`
- **Firebase Console:** https://console.firebase.google.com/u/1/project/tgp-fitness

## Backend integration

The backend uses `expo-server-sdk` (already in `growth-project-backend/package.json`). It does NOT require any Firebase Admin SDK credentials — Expo Push handles FCM auth on the backend's behalf using its own service account.

## Verifying push works end-to-end

1. Build a development client: `eas build --profile development --platform android`
2. Install on a physical Android device (push doesn't work in emulators reliably)
3. Sign in — the app registers an Expo Push token via `expo-notifications`
4. From the backend, send a test push to that token via the existing `PushNotificationService`
5. Confirm the notification arrives on the device

## Rotating credentials

If `google-services.json` ever needs to be regenerated (e.g. project move, key rotation):

1. Firebase Console → Project Settings → General → Your apps → Android app → "Download google-services.json"
2. Replace `google-services.json` at this repo root
3. Open a PR — no `app.json` change needed
4. After merge, trigger a new EAS Build so the new file is bundled

## Security note

`google-services.json` is a client-side configuration file, NOT a secret. It contains the public API key tied to the Android app's package name and is safe to commit. Google's security model relies on the package name + SHA-1 fingerprint (configured separately for production builds), not on keeping this file private.
