# src/tutorial — Roman-led client tutorial (clinic launch C08 + C09)

After onboarding finishes and the plan has been revealed, Roman takes the client on a tour of the real app. Each step only moves forward when the client does the real thing. This folder holds the logic. The UI lives in `src/components/tutorial/`.

The approach is Duolingo mechanics inside Quiet Luxury visuals: a progress indicator, a spotlight on the real tab or card, one success haptic and a short line from Roman when a step finishes, and skip with resume. There is no confetti, no exclamation point and no emoji. Motion is one 280 ms fade, and none at all when Reduce Motion is on.

## Kill switch and build flags

| Flag | Env | Default | Clinic build | Why |
|---|---|---|---|---|
| `clientTutorial` | `EXPO_PUBLIC_FF_CLIENT_TUTORIAL` | OFF | **ON** | This tour, the pinned macro and plan cards, the Home "Message your coach" row, the "Health and sleep" and "Connected devices" rows in Profile and more, and Settings > Tutorial. Turning it OFF rolls all of it back. |
| `communityTab` | `EXPO_PUBLIC_FF_COMMUNITY_TAB` | OFF | **ON (required)** | The community step needs the Community tab. If it is OFF, that step is recorded as `unavailable` and the tour skips it. |
| `clientCalendar` | `EXPO_PUBLIC_FF_CLIENT_CALENDAR` | OFF | **ON (after S-SCHED audits)** | The client Calendar tab. Adds two steps: the Calendar intro (after coach_messages) and the closing welcome call (before complete). OFF removes both from the step list entirely, so the tour, its "Step N of 8" count and persisted step indexes are exactly as before. |
| `communityHall` | `EXPO_PUBLIC_FF_COMMUNITY_HALL` | OFF | **ON (required)** | The space for every clinic client lives here. |
| `communityCohorts` | `EXPO_PUBLIC_FF_COMMUNITY_COHORTS` | OFF | **ON (required)** | The three per-plan spaces are cohort spaces. |
| `communityDm` | `EXPO_PUBLIC_FF_COMMUNITY_DM` | OFF | OFF (not required) | Messaging the coach uses the existing coach thread (`POST /messages`, HomeStack `Messages`), not community DMs. Leave it OFF unless the owner wants client-to-client DMs. |
| `romanChat` | `EXPO_PUBLIC_FF_ROMAN_CHAT` | OFF | Not required by the tour | Roman's tour lines are fixed templates with no AI call. Free-form Ask Roman is a separate slice with its own gate. |
| `coachBrief` | `EXPO_PUBLIC_FF_COACH_BRIEF` | dev only | **ON (coach side)** | The tour does not need it. Kept in the clinic profile by owner direction (2026-09-30 16:31): the owner wants coach daily summaries, and it surfaces the readiness-screening flag from onboarding complete (d). |

The `clinic` profile in `eas.json` extends `production` and sets the flags marked ON above. The `production` profile is unchanged.

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

- Missing data (66, owner T-3): without a program, beats 2 and 3 are `pending`; Roman says so once ("{coach} is still setting up your first plan. It will appear on Train once it is ready. For now, we will look at logging.") with Continue, and the tour moves to Food. Without numbers, beat 5 is `pending` the same way.
- Only a beat really done earns its done line and success haptic, never Later.
- Stored state is version 3. Older versions (v1: nine or eleven steps, v2: six) keep what the client chose: finished stays finished, skipped stays skipped (never restarts by itself) and resumes at the welcome.

## Truthful tour (FW-ONB-128 B2)

- "Coach linked" means `user.coach_id` is set, the same signal Home uses for its "Message your coach" row. `TutorialHost` passes it to `hydrateTutorial(userId, firstName, coachLinked)`; it reaches the machine as `TutorialContext.coachLinked` (absent means no coach). The first unmet requirement of a beat decides its outcome.
- Without a coach Roman names no coach anywhere, and beat six is the Roman beat (decision 28: nothing is locked).
- Complete: built from this tour's outcomes. "Your plan is set" only when the plan step ended `done`, "your numbers are set" only when the macros step did, and "{coach} has your message" only when the first message was sent. With none of them: "That is everything." The second paragraph ends "One thing at a time. You do not need to be perfect, just consistent."
- Settings > Tutorial reads "Take the tour" until a tour has been completed on this device, then "Take the tour again".

Food has no button and no "Later"; the message beat has Later (Tutorial 4). The client can skip the whole tour (with a confirm), which pauses it. Progress is kept. Resume from the quiet line on Home or from Settings > Tutorial (owner decision T-5).

## Files

- `types.ts`: payload, state, outcome and signal types.
- `tutorialSteps.ts`: the steps as data, plus Roman's copy. Copy uses no contractions, no exclamation points, no emoji and no em dashes. Real numbers only.
- `tutorialMachine.ts`: the pure reducer (gating, pending/unavailable, defer, pause/resume, persistence parsing).
- `tutorialStore.ts`: a zustand store. Holds `startClientTutorial()`, hydration, haptics, done lines and spotlight targets.
- `tutorialStorage.ts`: AsyncStorage key `tgp.clientTutorial.v1:<userId>`, one per user (owner decision T-2: no server persistence in v1).
- `tutorialEvents.ts`: a dependency-free signal bus. Emit points: `services/api.ts` (`logApi.logFood`, `messagesApi.send`), `api/messagesApi.ts` (`sendReply`), `services/foodLogQueue.ts` (`enqueue`), `screens/client/wearables/ConnectProviderSheet.tsx`, the two explanation cards, and `screens/client/calendar/CalendarBookScreen.tsx` (`welcome_call_booked`).
- `navigationFocus.ts`: the focused route path from the tab navigator's `state` event.
- `onboardingPayload.ts`: defensive parsing of the complete payload and `/me/macros/current`.

## Fix round (audit of fb9a7f8)

- **B1.** The first-meal step now says "Tap Add Food under any meal, choose one thing you have eaten today, and save it." The water sentence is gone. A water entry (`POST /nutrition/water`) deliberately does not complete the step, because the owner's intent is "log your first meal". A test pins this.
- **C1.** Roman no longer promises things the app does not do. The pending lines now say where the plan or numbers will appear ("It will appear on Train once it is ready.", "They will appear on Home once they are ready."). The sent line is "Sent. {coach} will see it in your conversation." A test rejects "let you know" and "reply soon".

## Lighter start in the macro step

When the client's macro display mode is `simple` (see `src/macros/README.md`), the macro step says: "This first week, we keep it to two numbers: {calories} calories and {protein} grams of protein. Carbohydrate and fat are already worked out for you, and they will join these on Home when the week is done. Tap How to use these numbers." The pinned macro card shows calories and protein only, and its explanation matches. `CopyContext.macroMode` carries the mode. When it is absent, the full four-number line is used, unchanged.

## Roman's face

The overlay renders `RomanAvatar crop="neutral"`, which resolves `romanFaceAsset('neutral')` from `src/components/roman/romanAvatarAssets.ts`. It never uses the smile crop (T-7). The canonical older butler art arrives through the Roman canonical face PR (#308), which replaces the bundled asset behind the same function. This folder references no image file directly.

## Known limits

- Spotlight rects for in-screen targets are measured on layout. If the client scrolls, the outline can drift. The outline is only visual, because gating comes from the real action, so drift never blocks progress.
- Progress is stored on the device. Reinstalling the app runs the tour again (T-2).

## Tests

`src/tutorial/__tests__/` (machine, store/persistence, completion detection, copy voice, and `tutorialTruth.test.tsx` for clients without a coach or a plan) and `src/components/tutorial/__tests__/` (overlay, cards, Home slot, Settings row). `ConnectProviderSheet.test.tsx` also asserts the wearable signal.
