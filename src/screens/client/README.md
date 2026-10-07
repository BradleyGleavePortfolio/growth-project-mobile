# Client screens

Everything a signed-in `student` user sees. Mounted under `ClientNavigator`, which is itself a 4-tab icons-only bottom bar — accessibility labels `Home` / `Train` / `Log food` / `Profile and more` (route names `Home` / `WorkoutTab` / `Log` / `MoreTab`). Three of the four tabs wrap nested native stacks; the `Log` tab is a single screen. Every secondary screen lives inside the `MoreStack` reached from the Profile tab — there is no global floating chat widget; the dedicated AI surface is `AIGuideScreen` and is reached from the **Guidance** row on `MoreScreen`.

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
| `MoreScreen.tsx` | Profile | Index of every secondary screen. The two top rows are **Guidance** (`AIGuide`) and **Membership** (`Membership`); the rest cover Recipes, Fasting, Community, Profile, Settings, Trust Center, Preferences, Widgets, Report, Learn, the lists, and the Plan view. There is no floating chat widget — `AIGuide` is reached from this index, not from a global FAB. |

### AI Guide and messaging

| File | What it does |
| --- | --- |
| `AIGuideScreen.tsx` | Chat with the assistant. Registered on the More stack as `AIGuide` and reachable from the **Guidance** row on `MoreScreen`. Sends only the user message + short history; the backend attaches structured context, persona, and guardrails. Uses `aiApi.getStructuredContext` once on mount to display "what your coach has shared" — purely informational, never assembled into a prompt by the client. Persists locally via `db/chatDb.ts`. |
| `MembershipScreen.tsx` | Access surface. Shows account state, coach identity, member-since date, founding-member badge if applicable, and an in-app **MESSAGE YOUR COACH** action that routes to the Home stack's `Messages` screen. Suitable for external Stripe / coach-managed access — there is no in-app billing chrome on the client side. Reads `usersApi.getFoundingNumber()` and `aiApi.getStructuredContext()` only. |
| `MessagesScreen.tsx` | One-on-one messages with the assigned coach. REST round-trip through `messagesApi`; a Supabase Realtime broadcast channel pings a refetch on new messages. 60 s fallback poll covers WebSocket drops. |
| `NotificationsScreen.tsx` | Coach nudges feed (`nudgesApi`). |

### Logging and planning

| File | What it does |
| --- | --- |
| `ClientWorkoutViewerScreen.tsx` | Scheduled-date overlines, serif plan names and hairline exercise rows with catalog names and prescribed sets/reps or seconds/weights, including coach-approved set adjustments. Pending and completed assignments both open `WorkoutAssignmentDetail`; refresh and honest loading/error/empty states remain. Coach names and previous-session numbers are not returned by this list API and are not invented. Start/resume and exercise details stay on the unchanged assignment detail route. |
| `PlanScreen.tsx` | Read-only view of the meal plan the coach has assigned. Reads from BOTH `mealPlansApi.list` (Sprint-A) and `mealTemplatesApi.todayForClient` (Sprint-B canonical) and merges them so a coach assigning via either path lands on the same screen (P0-1 unification). |
| `RecipesScreen.tsx`, `RecipeDetailScreen.tsx` | Browse and save recipes (`recipesApi`). The list passes `{ recipeId }` (a serialisable string) when navigating, never the full recipe object — `RecipeDetailScreen` reads from the React Query cache for synchronous paint and falls back to `recipesApi.getById(recipeId)`. This eliminates React Navigation's non-serializable-params warning and keeps state rehydration intact. New recipe-aware screens must follow the same id-only param pattern. |
| `GroceryListScreen.tsx`, `ShoppingListScreen.tsx`, `PrepGuideScreen.tsx` | List management + weekly prep guide (`listsApi`, `prepGuideApi`). |
| `FastingScreen.tsx` | Start/end fasting timer (`fastingApi`); backend is the source of truth, no intermediate local store. |
| `HabitsScreen.tsx` | Daily habit check-ins (`habitsApi`). |
| `WorkoutHistoryEditScreen.tsx` | One serif workout headline, hairline weight/reps/notes inputs and one forest Save changes action. Cancel retains the discard confirmation; save retains the replace-all payload and workout-query invalidation. |

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

Trust Center policy links (2026-09-30): the footer links to the **Privacy Policy** (`PRIVACY_POLICY_URL`, `https://app.trygrowthproject.com/privacy`), the **Consumer Health Data Privacy Policy** (`CONSUMER_HEALTH_POLICY_URL`, `/consumer-health-privacy`, required to be reachable from in-app settings by Washington RCW 19.373) and the help centre (`helpUrl()`). The list lives in `src/screens/trustCenterLinks.ts`; the URLs live in `src/config/env.ts`. Policy pages sit at the site root, so never build them with `helpUrl()` (the old `helpUrl('/privacy')` opened `/help/privacy`, which is not the policy). The transparency bullets say what the coach sees (consultation answers, logs, check-ins, connected health data), that Roman conversations are private from the coach and kept until the client deletes them or the account (owner 10-01 20:32, OR-110-1), and that service providers such as Anthropic process data only as the policy describes. The unsupported "US East" data-residency row and bullets were removed. A link that does not open shows, under the link, copy that names the page and fits the cause (OR-112-15, `src/screens/trustCenterLinkFailure.ts`): offline says so and to tap again once connected; a phone that cannot open web links (`Linking.canOpenURL` false or `Linking.openURL` rejects) gets the exact web address, selectable, with Copy web address; anything else gets the address, the support email (`SUPPORT_EMAIL`) with a short reference, Email support and the shared `SupportEmailFallback`. Every failure except offline goes to Sentry through `captureErrorWithoutPii` (no signed-in user id, no request data, no breadcrumbs) with a closed allowlist only (`LinkFailureReport`: event name, link id, operation, cause, an error-class enum, platform, reference); no text from the native exception is ever sent (Sol B-315-1). Tests: `src/screens/__tests__/trustCenterPolicyLinks.test.tsx` and the real-SDK canary `src/screens/__tests__/trustCenterLinkFailure.canary.test.ts`. Any reusable consumer-health link (for example the consultation agreement screen) should import `CONSUMER_HEALTH_POLICY_URL` from `src/config/env.ts`.

### Clinic tutorial additions (featureFlags.clientTutorial, default OFF)

| Screen | Addition |
| --- | --- |
| `HomeScreen.tsx` | `<TutorialHomeSlot />` below the coach introduction banner: the pinned macro explanation card (C08, real `/me/macros/current` or onboarding numbers), a "Message your coach" row into HomeStack `Messages`, and after a skipped tour one quiet line that resumes it. |
| `WorkoutScreen.tsx` | `<PlanExplanationCard />` above the coach-assigned CTA: the assigned program, its weeks and days a week, and "Why this plan" with the reasons from onboarding complete. |
| `MoreScreen.tsx` | "Health and sleep" (`Health`) and "Connected devices" (`Connections`) rows. Both were registered routes with no entry point. |
| `SettingsScreen.tsx` | Settings > Tutorial: resume or run the tour again. |

### Lighter start for never-trackers (no flag; driven by the backend `macro_display_mode`)

| Screen | Behaviour while `simple` (absent field = `full`, unchanged) |
| --- | --- |
| `HomeScreen.tsx` | Number grid shows Calories, Protein and Water. Once the simple week ends, `FullMacrosIntroCard` (Roman, once, dismissible, persisted) introduces carbohydrate and fat. |
| `LogScreen.tsx` | Summary bar shows Eaten, Remaining and Protein. Food entries show protein only. |
| `ClientMacrosScreen.tsx` | Calories and Protein, plus one quiet note that carbohydrate and fat join after the first week. |

Rules and persistence: `src/macros/README.md`.
| `wearables/ConnectProviderSheet.tsx` | Emits the tutorial `wearable_connected` signal on an on-device grant or OAuth success. |

Roman's tour runs over these real screens. See `src/tutorial/README.md`.

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

- `CommunityFeedScreen` is gone. It was an orphan — `CommunityScreen` covers Wins from inside the More stack — and the duplicate route was never reachable from a fresh signup. Do not reintroduce it; if a future feed needs to ship, extend `CommunityScreen`.
- The ranked `Leaderboard` tab inside `CommunityScreen` was excised in the streak/badge/trophy doctrine sweep. Ranked competition is incompatible with the quiet-luxury voice; the Wins feed is the only social surface.
- `TrophyShareScreen`, the `FirstWinCelebration` overlay, and the `IdentityBadge` / `TrophyArtifact` components were deleted in the wave-5b cleanup (#63). They are not registered as screens, not imported anywhere, and are explicitly forbidden by the doctrine test (`src/__tests__/quietLuxuryDoctrine.test.ts`).
- The `FloatingChatWidget` and the `RootNavigator.hideWidget` predicate it lived behind are gone. The dedicated AI surface is `AIGuideScreen`, reached from the **Guidance** row on `MoreScreen`.

## Release notes

- Home is the screenshot anchor for the listing — date headline + CONTINUE CTA + 2×2 number grid. Don't recompose it for marketing without coordinating with whoever owns the design tokens.
- The macro grid on Home follows a strict three-state contract: logged value with target hint when known, `0 of {target}g` when a target exists but no logs yet, and a tappable **Log to see** prompt that routes to the Log tab when no target is configured. The grid never renders a bare placeholder. The contract is guarded by `src/screens/client/__tests__/homeMacroDisplay.test.ts`.
- The AI Guide screen is part of the "Personal communications → in-app messages" data-safety declaration, not the "Marketing" category. Keep that mapping in sync with `PLAY_STORE_READINESS.md` §8 if the screen ever does push notifications.
- The Trust Center entry point lives in Settings → Trust & Privacy. Its export and delete actions fire `data_export_requested` and `account_deletion_requested` analytics events; Play reviewers exercise both during data-safety verification.
- `MembershipScreen` is intentionally read-only on the client side. Coach-managed billing is handled by the coach app (`CoachBillingScreen` under the Settings stack). If a self-serve client billing surface is ever introduced, it must add a backend contract and a new screen — do not bolt it onto `MembershipScreen`.

## 1:1 coach packages on iOS (clinic launch)

Client packages are 1:1 person-to-person coaching (App Review Guideline 3.1.3(d)) paid through Stripe, so they stay available on iOS. `ClientPackagesScreen` and `PackageCheckoutScreen` name the individual coach through `oneToOneCoachingLabel()`, for example "1:1 coaching with Bradley". The unsolicited package prompt is governed by `lib/packagePromptGate.shouldOfferPackagePrompt()`, checked by Day1Win and by the 24h `package_prompt`: it is offered only after an explicit inactive entitlement (unknown or failed lookups suppress it, so comp clients never see it) and never on a hidden iOS build, where purchase happens only on the labelled 1:1 coaching screen. The feature paywall (`ProtectedScreen` / `PaywallSheet`) shows "Your coach manages your access" with Message your coach on hidden iOS builds, and Membership hides its website link there. Purchase-flow copy speaks of coaching, not of unlocking app features or access.

**Catalog evidence (audit #304 C1).** Client package schemas carry no service-type field, so the app treats every client-purchasable package as 1:1 coaching. Keeping these packages on iOS depends on the owner confirming, or the server enforcing, that every client-purchasable package is real-time 1:1 coaching. Standalone digital content (programs, PDFs or videos sold on their own) must not be sold as a client package. If mixed products are ever allowed, add a trusted per-product classification from the server and fail closed on iOS for unknown or non-P2P products at the list, paywall, share-link checkout and webview entry points.


**Failed payments (S-DUNNING).** `HomeScreen` and `ClientPackagesScreen` render the inline `DunningBanner` (from `src/entitlements/dunning`) on Days 0-9 of a failed payment. It shows the amount, the failure date, the lock date, Update card (Stripe Billing Portal) and Message coach. It renders nothing unless `GET /v1/checkout/dunning` reports an active, unlocked v2 cycle. The legacy payment-status `dunning` banner on `ClientPackagesScreen` stays as it was, and is always null today.
