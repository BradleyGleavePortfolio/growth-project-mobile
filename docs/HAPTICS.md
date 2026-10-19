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
| `progress/ProgressV2` and `LogWeightSheetV2` (C8V2-2B, `clientProgressV2` off by default) | `selection()`; `success()`; `warning()`; `error()` | Week / Month / All and each 0.1 stepper; once when the server saves the weigh-in (the Save tap itself fires nothing); a weight outside the range; the save fails |
| `CoachNavigator` tab bar | `selection()` | Every tab press, including the selected tab under Settings, Community or Team (COACHTABS) |
| Overview gear, Calendar gear, Messages Community button (COACHTABS) | `softImpact()` | Opens Settings, Hours and rules, Community |
| `wearables/HealthFitnessTab` (HEALTH-1, `healthPages` off by default) | `selection()`; `error()` | Opens the device row, Steps, a card or Connect; Try again fails |
| `wearables/MetricDetailV2` (HEALTH-2, `healthPages` off by default) | `selection()`; `softImpact()`; `error()` | Week or Month changes; Share opens the sheet (its own haptics are `ShareSheet`'s); Try again fails |
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
| `client-detail/SafetyAlertCard` (SAFETY-CARD) | `softImpact()`; `success()`; `error()` | Message {first} on the client file's safety card; the server confirms or refuses Dismiss. None when the card appears |
| `MessagesScreen` (client, `c3StyleB` on) | `softImpact()` | Send tapped |
| `MessagesScreen` (client, `c3StyleB` on) | `error()` | A send fails while online (once per failure; it holds the messages after it; none while offline, the message waits) |
| `MessagesScreen` (client, `c3StyleB` on) | `success()` | The coach's read lands while the thread is open |
| `share/ShareSheet` (SHARE-A, `shareSheetV2` off by default) | `softImpact()`; `success()`; `error()` | A tap on Send to {coach}, Share outside the app or the Session summary Share link; once, only when the server confirms a send (none for Share outside the app: the app cannot know whether the person finished; none when the card waits offline in the thread outbox, SHARE-B); a picture or a send fails |
| `ShareCardScreen` (flag off) | `error()` | The picture could not be made or the share failed (the success haptic before the picture is gone) |
| Send to Sam handler (C1V2-C5) | `success()` | Once, in the tap that passes the parts their `event`; the parts draw and fire nothing. Not on a screen yet |
| `client/train/TrainToday` (C1-TRAIN-TAB, `clientTrainV2` off by default) | `mediumImpact()` | Start workout (or Resume workout) under today's workout name on the Train tab; the button's own soft haptic is off. None when the week ring or day strip draws |
| `MessagesInboxScreen` (client, `c3StyleB` on) | `selection()` | A tap on the coach card, Roman card, privacy line, Your conversations with Roman, Join a coach or Contact support |
| Consultation T1, B1, B3, N1, N2 (`consultTilesV2` on) | `selection()` | A tile, chip, or Imperial / Metric tap (ONBQ-TILES) |
| `roman/RomanCrisisActions` (CRISIS-BTN, `crisisActions` on) | `softImpact()` | Call 911, Call 988, Text 988 or Message <coach> under Roman's marked crisis reply; none when the reply arrives |
| `WelcomeScreen` (`firstRunV2` on) | `mediumImpact()` | Get started |
| `LoginScreen` (`firstRunV2` on) | `error()` | A sign-in failure is shown (once per failure) |
| `LoginScreen`, `CreateAccountScreen`, `ResetPasswordScreen` (`firstRunV2` on) | `selection()` | Show or hide password |
| `RoleChoice` tiles (`firstRunV2` on) | `selection()` | A role tile is picked |
| `ForgotPasswordScreen` (`firstRunV2` on) | `softImpact()` | The reset request is submitted (the forest card shows) |
| `ResetPasswordScreen` (`firstRunV2` on) | `success()` | The new password is saved |
| `CoachLessons` (`coachLessons` on) | `selection()`; `warning()`; `success()`; `error()` | Opens the editor or moves a lesson; a missing title, a bad link or the delete confirm; a lesson is saved or deleted; a save, delete or move fails |
| `LearnScreen` lesson rows (`learnHub` on) | `selection()` | A lesson opens |
| `LearnLessonScreen` (`learnHub` on) | `success()` / `error()` | The server saved the completion / the save failed (the sentence stays above the button) |
| `LearnLessonScreen` Next row (`learnHub` on) | `selection()` | The next lesson opens |
| `HomeDial` (rings Home, flag `clientHomeRings`) | `selection()` | Food, Train or Sleep dial opens its screen |
| `RingsHomeScreen` | `softImpact()` (PrimaryButton) | The day's one forest button |
| `HomeTile` (rings Home) | `selection()` | A tile opens its screen |
| `HomeTiles` water chip | `success()` / `error()` | One glass of water saved, or not saved |
| `purchase/PlanActiveMoment` (`clientBillingV2` on) | `success()` | Once, when the plan-is-active moment appears after a confirmed purchase |
| `MoneyAIPool` (Money page) | `mediumImpact()` / `softImpact()` | "Buy more credits" pressed (filled button / quiet text while the Stripe setup card shows) |

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
