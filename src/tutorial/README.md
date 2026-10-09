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

## Steps (owner order)

| # | Step | Gates (each must be met by a real action) | Detected by |
|---|---|---|---|
| 1 | welcome | Begin | button |
| 2 | plan | focus Train, then open "Why this plan" on the pinned plan card | route `WorkoutMain`; `plan_card_opened` |
| 3 | macros | focus Home, then open "How to use these numbers" on the pinned macro card | route `HomeMain`; `macro_card_opened` |
| 4 | first_meal (teach-back) | focus Log, then save a food entry | `meal_logged`: `POST /log/food` 2xx, or an entry the offline queue accepts |
| 5 | first_message (teach-back, coach linked) | open the coach thread, then send | `message_sent`: `POST /messages` 2xx (send or reply) |
| 6 | complete | Done | button |

TOUR-133 (decision 133-5): Community, Calendar, connected devices and the welcome call are no longer steps. The completion card names them in a quieter second paragraph (`sub`): the tabs this build has, "connected devices live under You", and, with `clientCalendar` on and a coach linked, "Book your welcome call with {coach} from Calendar when it suits you." The `wearable_connected` and `welcome_call_booked` signals are still emitted; the tour no longer waits on them. Saved v1 states (the nine- or eleven-step list) map to the new list: completed stays completed, paused stays paused at the welcome, active restarts at the welcome.

## Truthful tour (FW-ONB-128 B2)

- "Coach linked" means `user.coach_id` is set, the same signal Home uses for its "Message your coach" row. `TutorialHost` passes it to `hydrateTutorial(userId, firstName, coachLinked)`, and it reaches the machine as `TutorialContext.coachLinked` (absent means no coach). A step can name several requirements; the first one that is not met decides the outcome.
- Without a coach, the step marked "coach linked" above is recorded as `unavailable` and skipped, with no done line.
- Welcome: with a coach, "I work with {coach} to help you get the most from your plan" ("your training" when no plan is set), then "you will try two things yourself". Without a coach Roman names none: "This takes a few minutes. I will show you where everything lives, and then you will log your first meal yourself."
- Complete: built from this tour's outcomes. "Your plan is set" only when the plan step ended `done`, "your numbers are set" only when the macros step did, and "{coach} has your message" only when the first message was sent. With none of them: "That is everything." The second paragraph ends "One thing at a time. You do not need to be perfect, just consistent."
- Settings > Tutorial reads "Take the tour" until a tour has been completed on this device, then "Take the tour again".

The two teach-back steps have no button and no "Later". The client can skip the whole tour (with a confirm), which pauses it. Progress is kept. Resume from the quiet line on Home or from Settings > Tutorial (owner decision T-5).

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
