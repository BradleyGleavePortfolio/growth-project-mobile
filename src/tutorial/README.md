# src/tutorial — Roman-led client tutorial (clinic launch C08 + C09)

After onboarding finishes and the plan has been revealed, Roman takes the client on a tour of the real app. Each step only moves forward when the client does the real thing. This folder holds the logic. The UI lives in `src/components/tutorial/`.

The approach is Duolingo mechanics inside Quiet Luxury visuals: a progress indicator, a spotlight on the real tab or card, one success haptic and a short line from Roman when a step finishes, and skip with resume. There is no confetti, no exclamation point and no emoji. Motion is one 280 ms fade, and none at all when Reduce Motion is on.

## Kill switch and build flags

| Flag | Env | Default | Clinic build | Why |
|---|---|---|---|---|
| `clientTutorial` | `EXPO_PUBLIC_FF_CLIENT_TUTORIAL` | OFF | **ON** | This tour, the pinned macro and plan cards, the Home "Message your coach" row, the "Health and sleep" and "Connected devices" rows in Profile and more, and Settings > Tutorial. Turning it OFF rolls all of it back. |
| `communityTab` | `EXPO_PUBLIC_FF_COMMUNITY_TAB` | OFF | **ON (required)** | The community step needs the Community tab. If it is OFF, that step is recorded as `unavailable` and the tour skips it. |
| `communityHall` | `EXPO_PUBLIC_FF_COMMUNITY_HALL` | OFF | **ON (required)** | The space for every clinic client lives here. |
| `communityCohorts` | `EXPO_PUBLIC_FF_COMMUNITY_COHORTS` | OFF | **ON (required)** | The three per-plan spaces are cohort spaces. |
| `communityDm` | `EXPO_PUBLIC_FF_COMMUNITY_DM` | OFF | OFF (not required) | Messaging the coach uses the existing coach thread (`POST /messages`, HomeStack `Messages`), not community DMs. Leave it OFF unless the owner wants client-to-client DMs. |
| `romanChat` | `EXPO_PUBLIC_FF_ROMAN_CHAT` | OFF | Not required by the tour | Roman's tour lines are fixed templates with no AI call. Free-form Ask Roman is a separate slice with its own gate. |
| `coachBrief` | `EXPO_PUBLIC_FF_COACH_BRIEF` | dev only | **ON (coach side)** | The tour does not need it. The clinic coach does: it surfaces the readiness-screening flag from onboarding complete (d). |

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

The two teach-back steps have no button and no "Later". The client can skip the whole tour (with a confirm), which pauses it. Progress is kept. Resume from the quiet line on Home or from Settings > Tutorial (owner decision T-5).

## Files

- `types.ts`: payload, state, outcome and signal types.
- `tutorialSteps.ts`: the steps as data, plus Roman's copy. Copy uses no contractions, no exclamation points, no emoji and no em dashes. Real numbers only.
- `tutorialMachine.ts`: the pure reducer (gating, pending/unavailable, defer, pause/resume, persistence parsing).
- `tutorialStore.ts`: a zustand store. Holds `startClientTutorial()`, hydration, haptics, done lines and spotlight targets.
- `tutorialStorage.ts`: AsyncStorage key `tgp.clientTutorial.v1:<userId>`, one per user (owner decision T-2: no server persistence in v1).
- `tutorialEvents.ts`: a dependency-free signal bus. Emit points: `services/api.ts` (`logApi.logFood`, `messagesApi.send`), `api/messagesApi.ts` (`sendReply`), `services/foodLogQueue.ts` (`enqueue`), `screens/client/wearables/ConnectProviderSheet.tsx`, and the two explanation cards.
- `navigationFocus.ts`: the focused route path from the tab navigator's `state` event.
- `onboardingPayload.ts`: defensive parsing of the complete payload and `/me/macros/current`.

## Roman's face

The overlay renders `RomanAvatar crop="neutral"`, which resolves `romanFaceAsset('neutral')` from `src/components/roman/romanAvatarAssets.ts`. It never uses the smile crop (T-7). The canonical older butler art arrives through the Roman canonical face PR (#308), which replaces the bundled asset behind the same function. This folder references no image file directly.

## Known limits

- Spotlight rects for in-screen targets are measured on layout. If the client scrolls, the outline can drift. The outline is only visual, because gating comes from the real action, so drift never blocks progress.
- Progress is stored on the device. Reinstalling the app runs the tour again (T-2).

## Tests

`src/tutorial/__tests__/` (machine, store/persistence, completion detection, copy voice) and `src/components/tutorial/__tests__/` (overlay, cards, Home slot, Settings row). `ConnectProviderSheet.test.tsx` also asserts the wearable signal.
