# Haptic Feedback Service

Phase 11 / Track 3 — Typed haptic feedback singleton for The Growth Project mobile app.

## Overview

`HapticService` wraps `expo-haptics` with a consistent typed API and respects the
user's `Haptics enabled` preference stored in `gp_client_settings` via AsyncStorage.

## Usage

```ts
import { HapticService } from '../ui/haptics/haptics.service';

// Tab switches
HapticService.selection();

// Primary CTA presses
HapticService.mediumImpact();

// Workout completion / milestone
HapticService.heavyImpact();

// Successful form submission
HapticService.success();

// Form validation error
HapticService.warning();

// Failed API action
HapticService.error();
```

## API

| Method | expo-haptics call | Use case |
|---|---|---|
| `selection()` | `selectionAsync()` | Tab switches, chip selects |
| `softImpact()` | `impactAsync(Light)` | Subtle button presses |
| `mediumImpact()` | `impactAsync(Medium)` | Primary CTA presses |
| `heavyImpact()` | `impactAsync(Heavy)` | Workout completion, milestones |
| `success()` | `notificationAsync(Success)` | Form submitted, data saved |
| `warning()` | `notificationAsync(Warning)` | Validation errors, destructive confirms |
| `error()` | `notificationAsync(Error)` | Failed API actions, network errors |

## Preference

The user controls haptics via **Settings > App Preferences > Haptics enabled**.
The preference is persisted in `gp_client_settings` (AsyncStorage key) via `useSettings`.

When the toggle changes:
1. `useSettings.updateSetting('hapticsEnabled', v)` persists to AsyncStorage.
2. `setHapticsEnabled(v)` updates the in-memory flag in `HapticService` synchronously.
3. All subsequent calls are silently no-oped until re-enabled.

## Wired Locations

| Location | Method | Trigger |
|---|---|---|
| `ClientNavigator` tab bar | `selection()` | Every tab press |
| `CoachNavigator` tab bar | `selection()` | Every tab press, including the selected tab under Settings, Community or Team (COACHTABS) |
| Overview gear, Calendar gear, Messages Community button (COACHTABS) | `softImpact()` | Opens Settings, Hours and rules, Community |
| `messaging/RomanDraftMark` (Roman draft mark, both threads and C3 Style B) | `selection()` | Show or fold the draft line, open its explanation, or forward a long press to message actions (flag off by default) |
| `ActiveWorkoutScreen` | `heavyImpact()` | Workout saved successfully |
| `ActiveWorkoutScreen` | `error()` | Workout save failed |
| `LogScreen` | `success()` | Food logged (search + manual flows) |
| `LogScreen` | `error()` | Food log API failure |
| `EditProfileScreen` | `warning()` | DOB / weight validation error |
| `EditProfileScreen` | `success()` | Profile saved successfully |
| `EditProfileScreen` | `error()` | Profile save API failure |
| `AgeCheckScreen` | `success()` | Date of birth saved (16 or older) |
| `AgeCheckScreen` | `error()` | Date of birth save API failure |
| `CoachAiConsentSheet` (COACH-AI-CONSENT) | `success()` | The coach's Roman grant is saved (Allow, Try again) |
| `CoachSafetyAlertScreen` | `warning()` | A Roman safety alert opens (card, push or inbox row), once it shows |
| `MessagesScreen` (client, `c3StyleB` on) | `softImpact()` | Send tapped |
| `MessagesScreen` (client, `c3StyleB` on) | `error()` | A send fails while online (once per failure; it holds the messages after it; none while offline, the message waits) |
| `MessagesScreen` (client, `c3StyleB` on) | `success()` | The coach's read lands while the thread is open |
| Send to Sam handler (C1V2-C5) | `success()` | Once, in the tap that passes the parts their `event`; the parts draw and fire nothing. Not on a screen yet |
| `MessagesInboxScreen` (client, `c3StyleB` on) | `selection()` | A tap on the coach card, Roman card, privacy line, Your conversations with Roman, Join a coach or Contact support |
| `roman/RomanCrisisActions` (CRISIS-BTN, `crisisActions` on) | `softImpact()` | Call 988, Text 988 or Message <coach> under Roman's marked crisis reply; none when the reply arrives |

## Architecture

```
src/
  ui/
    haptics/
      haptics.service.ts          # Singleton + preference logic
      __tests__/
        haptics.service.test.ts   # Jest tests (mock expo-haptics)
src/
  hooks/
    useSettings.ts                # Updated: calls setHapticsEnabled on toggle
```

## Testing

```bash
npx jest src/ui/haptics/__tests__/haptics.service.test.ts
```

Tests cover:
- Each method calls the correct expo-haptics function.
- All methods are no-ops when `hapticsEnabled = false`.
- `setHapticsEnabled()` overrides synchronously.
- `refreshEnabled()` reads from AsyncStorage.
- Defaults to enabled when AsyncStorage returns null.
