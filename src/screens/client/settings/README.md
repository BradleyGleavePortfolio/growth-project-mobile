# Client Settings

`SettingsScreen.tsx` shows seven visible groups on one scrollable screen. `SettingsSection` supplies themed small-caps headings, generous spacing and hairlines, not disclosure controls. No new destination or extra tap is introduced.

| Group | Existing rows and controls |
|---|---|
| Account | Initial, name, email, password modal, Light/System appearance, haptics, supported-device biometric unlock, reset onboarding, account deletion, sign out |
| Training and food | Meals-per-day and water-goal steppers with the existing bounds and profile writes |
| Notifications | Daily check-in, retained account-specific check-in time when enabled, meal reminders, fasting alerts, weekly summary, detailed Notification preferences destination |
| Privacy and data | Trust & Privacy, Coach sharing, Blocked Users, My data export destination |
| Roman | Roman and AI consent destination, under the existing consultation/roman feature gate; no empty group when that entry is unavailable |
| Support | Support inbox, feature-gated tutorial resume/restart or disabled in-progress state |
| About | Existing version and tagline |

Sign out (SESSION-KEEP-130): before the confirm opens, one bounded try (4 s) sends the foods saved offline and the finished workouts still waiting on this phone. The confirm then names anything still unsent, for example "1 workout and 2 foods have not synced yet and will be removed from this phone.", and otherwise asks "Are you sure you want to sign out?" (`prepareSignOutConfirm` in `services/authActions.ts`; Profile uses the same confirm).

`ClientTutorialSetting` preserves the original tutorial store actions and parent Home navigation as a flat row within Support. It adds no separate Tutorial heading or filled card. The shared `TutorialSettingsRow` is unchanged.

Rendered parity coverage in `__tests__/SettingsScreen.parity.test.tsx` enumerates every part-1 row in its new group and exercises all navigation targets, steppers, switches, biometric directions, appearance choices, tutorial variants, password controls, reset and sign-out. `../__tests__/SettingsScreen.checkInTime.test.tsx` retains account-specific saved/missing-time and stored-dark-fallback coverage. The legacy Roman consent heading fixture reflects the approved new grouping.

All new copy is neutral group labelling; existing real account values, settings and feature gates remain unchanged. This is presentation-only, with no backend, dependency, navigation stack, consent implementation or production change. `RomanAiConsentScreen.tsx` and its memory control are owned separately.

Design reference: `design-targets/mobile/progress-details/luxury.jpg` supplies the editorial headline, negative space, small-caps overlines and fine rules, not its fictional data or report arrangement. Utility labels remain Inter. Colours come from the theme; dark remains hidden for launch. This module follows `docs/QUIET_LUXURY_DOCTRINE.md`, including section 8 documentation parity.
