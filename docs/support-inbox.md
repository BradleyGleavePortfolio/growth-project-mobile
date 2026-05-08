# Support Inbox — Crisp Chat Integration

## Overview

The Growth Project uses [Crisp](https://crisp.chat) as its in-app support channel. Crisp is a separate service from Coach AI and the Client Bot — it connects users directly to a human operator rather than an AI model.

| Channel | Purpose | Backend |
|---|---|---|
| Coach AI | Nutrition and workout guidance | LLM via backend |
| Client Bot | Automated programme nudges | Backend rule engine |
| **Support Inbox** | **Direct human support** | **Crisp operator dashboard** |

---

## User Flow

1. User navigates to **Settings -> Support**.
2. `SupportInboxScreen` mounts and calls `crisp-sdk-react-native`'s `show()`, opening the Crisp chat overlay natively.
3. The user types their message. The conversation appears in the Crisp operator dashboard at [app.crisp.chat](https://app.crisp.chat).
4. The operator replies from the dashboard; the reply is pushed to the user's device via the Crisp native SDK.

---

## Identity Sync

`crisp.service.ts` binds the authenticated user's identity into every Crisp session:

```ts
setUserEmail(user.email);
setUserNickname(user.displayName);
setSessionString('planTier', planTier);
setSessionString('role', role);
setSessionString('tenantId', tenantId);
```

`syncCrispIdentity(user)` is called from `RootNavigator`'s `bootstrapAuth()` on every successful authentication. This means the operator always sees the correct account alongside the chat transcript.

---

## Environment Variable

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_CRISP_WEBSITE_ID` | yes | Crisp website ID, found in the Crisp dashboard under **Settings -> Website Settings -> Setup instructions**. Ships in the bundle (public). |

Add to `.env`:

```
EXPO_PUBLIC_CRISP_WEBSITE_ID=your-crisp-website-id
```

Add to `eas.json` for production builds:

```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_CRISP_WEBSITE_ID": "your-crisp-website-id"
      }
    }
  }
}
```

---

## Operator Setup (Crisp Dashboard)

1. Create or log in to a Crisp account at [app.crisp.chat](https://app.crisp.chat).
2. Create a website (or select the existing one for The Growth Project).
3. Copy the **Website ID** from **Settings -> Website Settings -> Setup instructions** and set `EXPO_PUBLIC_CRISP_WEBSITE_ID` in EAS build config.
4. Configure routing rules under **Settings -> Routing** to assign incoming conversations to the appropriate team or operator.
5. Set business hours under **Settings -> Availability** to configure the away message shown to users outside office hours.
6. (Optional) Enable the **Crisp MagicBrowse** or **Crisp Campaigns** add-ons for additional context — these are operator-only concerns and require no mobile code changes.

---

## Build Requirements

`crisp-sdk-react-native` bundles native modules for iOS and Android. It cannot run in Expo Go.

- Expo SDK 53 or newer (this project uses SDK 55).
- Development build (`npx expo run:ios` / `npx expo run:android`) or a production EAS build.
- `app.json` must declare `expo-build-properties` with minimum OS targets:
  - iOS deployment target: 15.1
  - Android minSdkVersion: 21

See `app.json` and the mobile `README.md` for build instructions.

---

## Routing Rules

Routing rules live entirely in the Crisp dashboard — no mobile code changes are required. Recommended configuration:

- Route conversations with `role = coach` to the **Coach Support** inbox.
- Route conversations with `role = student` to the **Member Support** inbox.
- Use `planTier` to prioritise paying members.

---

## Files Added / Changed

| File | Change |
|---|---|
| `src/services/support/crisp.service.ts` | Crisp SDK init + identity sync |
| `src/services/support/__tests__/crisp.service.test.ts` | Unit tests |
| `src/screens/support/SupportInboxScreen.tsx` | Support inbox screen |
| `src/navigation/ClientNavigator.tsx` | Added `SupportInbox` to `MoreStackParamList` and `MoreStackNavigator` |
| `src/navigation/CoachNavigator.tsx` | Added `SupportInbox` to `SettingsStackParamList` and `SettingsStackNavigator` |
| `src/screens/client/SettingsScreen.tsx` | Added Support row linking to `SupportInbox` |
| `src/screens/coach/SettingsScreen.tsx` | Added Support row linking to `SupportInbox` |
| `README.md` | Added `EXPO_PUBLIC_CRISP_WEBSITE_ID` to env table and Support Inbox section |
| `docs/support-inbox.md` | This file |
