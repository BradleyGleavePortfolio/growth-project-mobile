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
| 4 | community | focus Community, then Continue | route `CommunityTab` |
| 5 | coach_messages | open the coach thread from Home's "Message your coach", then Continue | route `Messages` |
| 6 | wearables | open Connected devices; connect Apple Health (iOS) or Health Connect (Android), **or tap Later**; open Health and sleep; Continue | route `Connections`; `wearable_connected` (on-device grant, OAuth success, or a `connected` row in the connections list) or DEFER; route `Health` |
| 7 | first_meal (teach-back) | focus Log, then save a food entry | `meal_logged`: `POST /log/food` 2xx, or an entry the offline queue accepts |
| 8 | first_message (teach-back) | open the coach thread, then send | `message_sent`: `POST /messages` 2xx (send or reply) |
| 9 | complete | Done | button |

With `clientCalendar` ON (S-SCHED, owner decisions 2026-10-01):

| After | Step | Gates | Detected by |
|---|---|---|---|
| coach_messages | calendar | focus Calendar, then Continue | route `CalendarHome` |
| first_message | welcome_call | "Book your welcome call with {coach}" opens booking, preselecting the day-1 seeded Quick initialization offering; renamed offerings can be selected explicitly; book, **or tap Later** | `welcome_call_booked` from `CalendarBookScreen` on a successful booking, or DEFER |

The welcome call never blocks finishing. With no preselected welcome type the client can choose an active appointment type; with no open times the screen offers refresh, Calendar and "Message your coach". Phone calendar exports are user-controlled copies and do not auto-sync.

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

`src/tutorial/__tests__/` (machine, store/persistence, completion detection, copy voice) and `src/components/tutorial/__tests__/` (overlay, cards, Home slot, Settings row). `ConnectProviderSheet.test.tsx` also asserts the wearable signal.
