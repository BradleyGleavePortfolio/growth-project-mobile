# src/tutorial — Roman-led client tour (prototype 46-66, TOUR-133)

After the consultation reveal, "Show me around" starts Roman's tour of the real app. Each beat only moves forward when the client does the real thing. This folder holds the logic. The UI lives in `src/components/tutorial/`.

The approach is Duolingo mechanics inside Quiet Luxury visuals: "Step n of 7", a rounded spotlight on the real tab, card or row, one success haptic and a short line from Roman when a beat finishes, and skip with resume. There is no confetti, no exclamation point and no emoji. Motion is one 280 ms fade with an 8 pt rise, and none at all when Reduce Motion is on. Corners come from the radius tokens only (owner 17:07, decision 133-4): the card `radius.card`, the skip sheet `radius.sheet`, buttons from `src/ui` (`PrimaryButton`, `TextLink`).

## Build flags

| Flag | Env | What the tour does with it |
|---|---|---|
| `clientTutorial` | `EXPO_PUBLIC_FF_CLIENT_TUTORIAL` | The tour, the pinned macro and plan cards, the Home "Message your coach" row, the spotlight targets and Settings > Tutorial. OFF rolls all of it back. ON in every store profile with CONSULT-ALL-M-133 (it was `clinic` / `clinic-apk` only). |
| `romanChat` | `EXPO_PUBLIC_FF_ROMAN_CHAT` | Beat six for a client without a coach points at Roman under You and says Roman opens once they join a coach (`ROMAN_BEAT_COACHLESS_LINE`; m#651 locks Roman for clients with no coach). OFF: that beat is `unavailable` and skipped. |
| `clientCalendar`, `communityTab` | `EXPO_PUBLIC_FF_CLIENT_CALENDAR`, `EXPO_PUBLIC_FF_COMMUNITY_TAB` | Not steps any more (decision 133-5). The completion names the tabs that exist, and, with Calendar and a coach, the welcome call. |

## Integration with onboarding (one line)

The onboarding screens belong to another builder, and this PR does not touch them. After the plan reveal, call:

```ts
import { startClientTutorial } from '../../tutorial/tutorialStore';

startClientTutorial(completeResponse.data); // body of POST /me/onboarding/complete
```

- It is idempotent. A finished tour never restarts by itself. Settings > Tutorial passes `{ restart: true }` to run it again.
- It is safe to call before `ClientNavigator` mounts or before the user id resolves. The start waits until that user's saved state has loaded.
- It returns `false` and does nothing when `clientTutorial` is OFF.
- The payload is parsed defensively (`onboardingPayload.ts`). If the payload is missing, `TutorialHost` reads `GET /me/onboarding`. If there are still no macros or no program, that step is recorded as `pending` and the tour moves on (owner decision T-3).
- The hand-off is recoverable (Sol B-310-4). With `consultationOnboarding` on, when the tour on this phone is `not_started`, `TutorialHost` reads `GET /me/onboarding` once per mount; if the server says `completed: true` (backend #607 sets it from the intake, so clients who never did the consultation are not touched) it starts the tour with `result`. This covers the app closing between the complete 200 and "Show me around", a lost 200, and a sign-in on a fresh install (owner T-2: a reinstall runs the tour again). A `paused` or `completed` tour never starts or resumes by itself. Offline, nothing starts; the next launch tries again.

## Steps (prototype 46-60, decision 133-5: seven)

| # | Beat | Gates (each met by a real action) | Detected by |
|---|---|---|---|
| 1 | welcome (46-47) | Begin, on a full scrim with no cut-out | button |
| 2 | plan (48-49) | tap Train, then open the plan's next day from the pinned plan card ("Next: Day 1, ...", or the coach workouts list) | route `WorkoutMain`; route `WorkoutAssignmentDetail` or `ClientWorkoutViewer` |
| 3 | first_exercise (50-51) | the first exercise row is spotlit; Continue (nothing is started) | button |
| 4 | first_meal (52-54, teach-back) | tap Food, then save a food entry (Add food is spotlit) | `meal_logged`: `POST /log/food` 2xx, or an entry the offline queue accepts |
| 5 | macros (55-56) | tap Home, then open "How to use these numbers" on the targets card | route `HomeMain`; `macro_card_opened` |
| 6 | first_message (57-59, coach linked) | open the coach thread from Home, then send; **Later** on either gate (Tutorial 4: freely skippable) | route `Messages`; `message_sent`: `POST /messages` 2xx. Never RomanChat; nothing is sent for the client. |
| 6 | roman (no coach, `romanChat` on) | the You tab is spotlit; Continue | button |
| 7 | complete (60) | Got it | button |

- Missing data (66, owner T-3): without a program, beats 2 and 3 are `pending`; Roman says so once ("{coach} is still setting up your first plan. It will appear on Train once it is ready. For now, the tour carries on with Food.") with Continue, and the tour moves to Food. Without numbers, beat 5 is `pending` the same way.
- Done line (each beat): a check glyph and Roman's line, one success haptic, gone after 3.2 s or on a tap. Only a beat really done earns it, never Later.
- Completion (60): Roman's face, the serif line built from this tour's outcomes ("Your plan is set", "your numbers are set", "{coach} has your message", each only when true), then one quiet paragraph that folds in Calendar, Community and connected devices, the welcome call when there is a coach and Calendar, and "One thing at a time. You do not need to be perfect, just consistent." No Skip.
- Push priming (61-62, `pushPriming.ts`): after Got it, one card, only when the OS can still ask and the account never answered Home's push card: "Want a nudge when {coach} messages you, or when the day's workout is ready? I will only ask once." Only "Turn on notifications" shows the OS dialog; "Not now" goes straight on. Both answers use Home's `push_primer_dismissed:<user>` key, so Home never asks again, and Home's card hides while the tour runs.
- Landing (63): plain Home (`Home` / `HomeMain`), nothing else opens.
- Skip (64): a bottom sheet, "Skip the tour?", "You can pick it up again from Settings, under Tutorial.", Skip tour (the one filled button) and Keep going, warning haptic. Progress is kept.
- Re-offer (65): one quiet line on Home, "Pick up the quick tour in Settings, under Tutorial.", which resumes it; never a re-triggered prompt (owner T-5).
- Stored state is version 3. Older versions (v1: nine or eleven steps, v2: six) keep what the client chose: finished stays finished, skipped stays skipped (never restarts by itself) and resumes at the welcome.

## Truthful tour (FW-ONB-128 B2)

- "Coach linked" means `user.coach_id` is set, the same signal Home uses for its "Message your coach" row. `TutorialHost` passes it to `hydrateTutorial(userId, firstName, coachLinked)`; it reaches the machine as `TutorialContext.coachLinked` (absent means no coach). The first unmet requirement of a beat decides its outcome.
- Without a coach Roman names no coach anywhere, beat six is the Roman beat (decision 28: nothing is locked; since m#651 it says Roman opens once they join a coach), and the push line drops the coach.
- Settings > Tutorial reads "Take the tour" until a tour has been completed on this device, then "Take the tour again".

## Files

- `types.ts`: payload, state, outcome and signal types.
- `tutorialSteps.ts`: the steps as data, plus Roman's copy. Copy uses no contractions, no exclamation points, no emoji and no em dashes. Real numbers only.
- `tutorialMachine.ts`: the pure reducer (gating, pending/unavailable, defer, pause/resume, persistence parsing).
- `tutorialStore.ts`: a zustand store. Holds `startClientTutorial()`, hydration, haptics, done lines and spotlight targets.
- `tutorialStorage.ts`: AsyncStorage key `tgp.clientTutorial.v1:<userId>`, one per user (owner decision T-2: no server persistence in v1).
- `tutorialEvents.ts`: a dependency-free signal bus. Emit points: `services/api.ts` (`logApi.logFood`, `messagesApi.send`), `api/messagesApi.ts` (`sendReply`), `services/foodLogQueue.ts` (`enqueue`), the two explanation cards. `ConnectProviderSheet` and `CalendarBookScreen` still emit `wearable_connected` / `welcome_call_booked`; no beat listens to them now.
- `pushPriming.ts`: the single push ask after the completion (61-62).
- `navigationFocus.ts`: the focused route path from the tab navigator's `state` event.
- `onboardingPayload.ts`: defensive parsing of the complete payload and `/me/macros/current`.

## Fix round (audit of fb9a7f8)

- **B1.** The first-meal step points at Add food and a food entry; there is no water sentence. A water entry (`POST /nutrition/water`) deliberately does not complete the step, because the owner's intent is "log your first meal". A test pins this.
- **C1.** Roman no longer promises things the app does not do. The pending lines now say where the plan or numbers will appear ("It will appear on Train once it is ready.", "They will appear on Home once they are ready."). The sent line is "Sent. {coach} will see it in your conversation." A test rejects "let you know" and "reply soon".

## Lighter start in the macro step

When the client's macro display mode is `simple` (see `src/macros/README.md`), the macro step speaks calories and protein only and says why. The pinned macro card shows calories and protein only, and its explanation matches. `CopyContext.macroMode` carries the mode. When it is absent, the full four-number line is used, unchanged.

## Roman's face

The overlay renders `RomanAvatar crop="neutral"`, which resolves `romanFaceAsset('neutral')` from `src/components/roman/romanAvatarAssets.ts`. It never uses the smile crop (T-7). The canonical older butler art arrives through the Roman canonical face PR (#308), which replaces the bundled asset behind the same function. This folder references no image file directly.

## Known limits

- Spotlight rects for in-screen targets are measured on layout (`TutorialTarget`; the first exercise row and the first meal's Add food). If the client scrolls, the cut-out can drift. The outline is only visual, because gating comes from the real action, so drift never blocks progress.
- Progress is stored on the device. Reinstalling the app runs the tour again (T-2).

## Tests

`src/tutorial/__tests__/` (machine, store/persistence, completion detection, copy voice, push priming, the consultation hand-off, and `tutorialTruth.test.tsx` for clients without a coach or a plan) and `src/components/tutorial/__tests__/` (overlay at 360x800 and 390x844, cards, Home slot, Settings row).
