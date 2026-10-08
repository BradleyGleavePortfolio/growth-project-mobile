# Client Settings

`SettingsScreen.tsx` shows seven visible groups on one scrollable screen. `SettingsSection` supplies themed small-caps headings, generous spacing and hairlines, not disclosure controls. No new destination or extra tap is introduced.

| Group | Existing rows and controls |
|---|---|
| Account | Initial, name, email, password modal (sign-up and reset rules, plain failure copy), Light/System appearance, haptics, supported-device biometric unlock, Redo profile setup (its confirm says logs and coach plans are kept), account deletion, sign out |
| Training and food | Meals-per-day and water-goal steppers with the existing bounds and profile writes |
| Notifications | Check-in reminders, retained account-specific check-in time, Fasting alerts, Summary emails (each with one line saying what it does), detailed Notification preferences destination |
| Privacy and data | Trust & Privacy, Coach sharing, Blocked users, My data export destination |
| Roman | Roman and AI consent destination, under the existing consultation/roman feature gate; no empty group when that entry is unavailable |
| Support | Support inbox, feature-gated tutorial resume/restart or disabled in-progress state |
| About | Existing version and tagline |

Sign out (SESSION-KEEP-130): before the confirm opens, one bounded try (4 s) sends the foods saved offline and the finished workouts still waiting on this phone. The confirm then names anything still unsent, for example "1 workout and 2 foods have not synced yet and will be removed from this phone.", and otherwise asks "Are you sure you want to sign out?" (`prepareSignOutConfirm` in `services/authActions.ts`; Profile uses the same confirm).

`ClientTutorialSetting` preserves the original tutorial store actions and parent Home navigation as a flat row within Support. It adds no separate Tutorial heading or filled card. It reads "Take the tour" until a tour has been completed, then "Take the tour again". The shared `TutorialSettingsRow` is unchanged.

Rendered parity coverage in `__tests__/SettingsScreen.parity.test.tsx` enumerates every part-1 row in its new group and exercises all navigation targets, steppers, switches, biometric directions, appearance choices, tutorial variants, password controls, reset and sign-out. `../__tests__/SettingsScreen.checkInTime.test.tsx` retains account-specific saved/missing-time and stored-dark-fallback coverage. The legacy Roman consent heading fixture reflects the approved new grouping.

Notification switches (CF-SETTINGS-128) control only what they name. Check-in reminders writes the missed check-in nudge columns (`nudge_missed_checkin_*`) and Summary emails writes `digest_email` (the old `daily_checkin_enabled` / `weekly_summary_enabled` columns are mirrored); both show the account's saved values from `GET /notifications/preferences`, and a failed save puts the switch back with one plain line (`preferenceSaveFailureOf`). Fasting alerts is on by default and lives on this phone: `utils/notifications.ts` `scheduleFastingAlert` schedules nothing while it is off, and switching it off cancels the alert already set for the running fast (`utils/fastingAlert.ts` `cancelFastEndAlert`). Removed surface: the Meal reminders switch (no meal reminder is ever sent; `eat_enabled` is read by nothing).

Summary emails (SMALL-M-COPY-131): the existing copy stays because the backend sends a real client weekly digest with check-in, workout and weight summaries, gated by `digest_email`; the separate client daily digest is opt-in server-side. A rendered test verifies the description and that the switch reads/writes `digest_email` even when the legacy `weekly_summary_enabled` value differs. ([Backend digest service](https://github.com/BradleyGleavePortfolio/growth-project-backend/blob/652b07a856fd807462da244c80f529eef39123c9/src/notifications/digest.service.ts))

The regrouping itself added only neutral group labelling and changed no account values, settings or feature gates. Nothing here needs a backend, dependency, navigation stack, consent implementation or production change: the switches use the existing `/notifications/preferences` endpoints. `RomanAiConsentScreen.tsx` and its memory control are owned separately.

Design reference: `design-targets/mobile/progress-details/luxury.jpg` supplies the editorial headline, negative space, small-caps overlines and fine rules, not its fictional data or report arrangement. Utility labels remain Inter. Colours come from the theme; dark remains hidden for launch. This module follows `docs/QUIET_LUXURY_DOCTRINE.md`, including section 8 documentation parity.
