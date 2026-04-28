# Client screens

Everything a signed-in `student` user sees. Mounted under `ClientNavigator`, which is itself a 4-tab icons-only bottom bar — accessibility labels `Home` / `Train` / `Log food` / `Profile and more` (route names `Home` / `WorkoutTab` / `Log` / `MoreTab`). Three of the four tabs wrap nested native stacks; the `Log` tab is a single screen. Every secondary screen is reached through the Profile tab (`MoreTab`) — there is no global floating chat widget; the dedicated AI surface is `AIGuideScreen`.

## Purpose

- Give a paying client one screen per primary intent: read coach guidance (Home), train (Workout), log food and water (Log + Plan), see progress (Progress), talk to coach + AI (Messages + AI Guide).
- Stay calm — the visual weight is in typography (Cormorant + Inter) and ample whitespace, not in colour or motion. Home is "one thought, not eleven."
- Work offline for the things that have to: food logging queues writes locally and replays them on reconnect; chat history persists in AsyncStorage.
- Honour tenancy. The client only ever sees their own data. The screens never request another user's id; the backend enforces ownership via JWT-scoped guards.

## Key files

### Tab roots

| File | Tab | What it does |
| --- | --- | --- |
| `HomeScreen.tsx` | Home | Editorial date headline + single "CONTINUE" CTA + 2×2 number grid (calories, protein, water, streak). Pulls from `useClientStore`. |
| `WorkoutScreen.tsx` | Train | Lists routines (`workoutApi.getRoutines`), launches `ActiveWorkoutScreen`, links to `RoutineBuilder` and `CoachGuidelines`. |
| `LogScreen.tsx` | Log | Day selector, macro summary, four meal sections, water tracker. Search modal hits `foodApi.search`; offline writes go through `services/foodLogQueue`. The `Plan` screen is reached from inside `MoreStack`, not from this tab. |
| `MoreScreen.tsx` | Profile | Index of every secondary screen (Recipes, Fasting, Community, Progress, Profile, Settings, Trust Center, Preferences, Widgets, Report, Learn, lists, Plan). |

### AI Guide and messaging

| File | What it does |
| --- | --- |
| `AIGuideScreen.tsx` | Chat with the assistant. Sends only the user message + short history; the backend attaches structured context, persona, and guardrails. Uses `aiApi.getStructuredContext` once on mount to display "what your coach has shared" — purely informational, never assembled into a prompt by the client. Persists locally via `db/chatDb.ts`. |
| `MessagesScreen.tsx` | One-on-one messages with the assigned coach. REST round-trip through `messagesApi`; a Supabase Realtime broadcast channel pings a refetch on new messages. 60 s fallback poll covers WebSocket drops. |
| `NotificationsScreen.tsx` | Coach nudges feed (`nudgesApi`). |

### Logging and planning

| File | What it does |
| --- | --- |
| `PlanScreen.tsx` | Read-only view of the meal plan the coach has assigned (`mealPlansApi.list`). |
| `RecipesScreen.tsx`, `RecipeDetailScreen.tsx` | Browse and save recipes (`recipesApi`). |
| `GroceryListScreen.tsx`, `ShoppingListScreen.tsx`, `PrepGuideScreen.tsx` | List management + weekly prep guide (`listsApi`, `prepGuideApi`). |
| `FastingScreen.tsx` | Start/end fasting timer (`fastingApi`); state persists in `store/fastingStore`. |
| `HabitsScreen.tsx` | Daily habit check-ins (`habitsApi`). |

### Profile, settings, and trust

| File | What it does |
| --- | --- |
| `ProfileScreen.tsx` | Identity + streak. Reads `usersApi.getFoundingNumber` for the "founding member" badge. |
| `SettingsScreen.tsx` | Sign out, change password, reset onboarding, link to Trust Center. |
| `PreferencesScreen.tsx` | Personalisation toggles persisted via `preferencesApi`. |
| `ReportScreen.tsx` | Shareable weekly summary — image-friendly card output. |
| `WidgetsScreen.tsx` | iOS / Android widget setup walkthrough. |
| `EducationScreen.tsx` | Lesson library (`lessonsApi`). |
| `CommunityScreen.tsx` | Founders' circle leaderboard / wins (`communityApi`). |
| `ProgressScreen.tsx` | Weight chart + macro adherence (`weightApi`, `logApi.getWeekly`). |
| `CoachGuidelinesScreen.tsx` | Read-only render of guidelines the coach posted. |

The **Trust Center** itself lives at `src/screens/TrustCenterScreen.tsx` (not in this directory because it is shared with the coach navigator).

## Data flow

```
useCurrentUser() ─► AsyncStorage('user_data')
                  ─► sets Sentry user, sets PostHog identity

screens ──► services/api ──► axios + secureStorage('supabase_token')
                ▲       │
                │       └─► 401 ─► single-flight refresh ─► retry
                │
                └─ React Query cache (services/queryClient) — 30 s stale, 10 min gc

LogScreen ──► foodApi.search / logApi.logFood
            └─ offline ─► services/foodLogQueue (AsyncStorage)
                       └─► flushed by RootNavigator on net-up

MessagesScreen ──► messagesApi (REST, source of truth)
              ────► services/realtime broadcast ping ─► refetch
              ────► 60 s safety poll fallback

AIGuideScreen ──► aiApi.chat { message, history? }
              └─ backend attaches structured context + persona
              └─ db/chatDb.ts persists last 50 messages locally
```

## App-store / deep-link dependencies

- None of these screens are reachable from a deep link. Universal links land on `CreateAccount` only.
- Push notifications surface on the Notifications screen in-app and as native banners. The runtime permission is requested once at boot; see `utils/notifications.ts`.
- `RoutineBuilderScreen` and `RecipeDetailScreen` are referenced by share intents in a future iteration but are not registered as deep-link targets today.

## Security and tenancy

- Every screen reads the current user from `useCurrentUser`, which is just a thin wrapper on `AsyncStorage('user_data')`. The id is used to scope local SQLite reads (chat history, cached food images); the backend re-derives the id from the JWT.
- `clientStore.reset()` is called on sign-out to wipe in-memory food logs / water / day state so the next user on the same device never sees stale data.
- The AI Guide never assembles raw PII into a prompt. The client sends only `{ message, conversation_history? }`; the backend attaches the structured `AIStructuredContext`. This is enforced by the API surface, not by client policy.
- Messaging uses Realtime for **broadcast pings only** — no row payloads cross the WebSocket. Data delivery stays on the authenticated REST endpoint. See `services/realtime.ts` for the rationale.

## Environment variables

These screens do not read env directly; they go through `services/api.ts` (which reads `EXPO_PUBLIC_API_URL`), `services/realtime.ts` (Supabase URL + anon key), and `lib/analytics.ts` (PostHog key). Missing env values throw at module load — the app never reaches a tab.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Log screen freezes after tapping a search result while offline | The food doesn't yet exist server-side and the queue write needs a network round-trip to resolve | Queue stores both the food payload and the log; flush creates the food first, then logs it. The optimistic UI row appears immediately. |
| Messages screen shows "No coach yet" | User signed up codeless and never attached an invite | They can paste a code on the screen; calls `authApi.attachInviteCode`. |
| AI Guide says "I'm offline at the moment" | Backend `/ai/chat` returned non-200 or network error | Retry; conversation history is preserved locally. |
| Realtime ping never fires | WebSocket dropped (background → foreground) | 60 s poll catches up; a foreground transition also triggers a focus refetch in some screens. |
| Home shows zeros after fresh install | `useClientStore.loadDayData` not yet called for today's date | Auto-runs on focus; pull-to-refresh forces a reload. |

## Tests

Unit tests live for the helpers these screens lean on (`hooks/__tests__`, `utils/__tests__`, `services/__tests__`). The screens themselves are exercised by the smoke matrix in `docs/RELEASE_SMOKE.md`. Run:

```bash
npm test
npm run typecheck
```

## Removed surfaces

- `TrophyShareScreen`, `FirstWinCelebration`, `IdentityBadge`, and `TrophyArtifact` were deleted in the wave-5b cleanup (#63). They are not registered as screens, not imported anywhere, and are explicitly forbidden by the doctrine test (`src/__tests__/quietLuxuryDoctrine.test.ts`).
- The `FloatingChatWidget` and the `RootNavigator.hideWidget` predicate it lived behind are gone. The dedicated AI surface is `AIGuideScreen`.

## Release notes

- Home is the screenshot anchor for the listing — date headline + CONTINUE CTA + 2×2 number grid. Don't recompose it for marketing without coordinating with whoever owns the design tokens.
- The AI Guide screen is part of the "Personal communications → in-app messages" data-safety declaration, not the "Marketing" category. Keep that mapping in sync with `PLAY_STORE_READINESS.md` §8 if the screen ever does push notifications.
- The Trust Center entry point lives in Settings → Trust & Privacy. Its export and delete actions fire `data_export_requested` and `account_deletion_requested` analytics events; Play reviewers exercise both during data-safety verification.
