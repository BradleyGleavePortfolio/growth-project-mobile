# Client screens

Everything a signed-in `student` user sees. Mounted under `ClientNavigator` with labelled Home, Train, Food and You tabs, plus flag-gated Calendar and Community tabs (six in launch builds). Food is a single screen; the other tabs wrap nested navigators. The More index lives in `MoreStack`, reached from You, with cross-tab shortcuts to habits and exercises. There is no global floating chat widget; the dedicated AI surface is `AIGuideScreen`, reached from the **Guidance** row on `MoreScreen`.

## Purpose

- Give a paying client one screen per primary intent: read coach guidance (Home), train (Workout), log food and water (Log + Plan), see progress (Progress), talk to coach + AI (Messages + AI Guide).
- Stay calm — the visual weight is in typography (Cormorant + Inter) and ample whitespace, not in colour or motion. Home is "one thought, not eleven."
- Work offline for the things that have to: food logging queues writes locally and replays them on reconnect; chat history persists in AsyncStorage.
- Honour tenancy. The client only ever sees their own data. The screens never request another user's id; the backend enforces ownership via JWT-scoped guards.

## Key files

### Tab roots

| File | Tab | What it does |
| --- | --- | --- |
| `HomeScreen.tsx` | Home | Muted date overline, verified meal/workout summary in serif, one forest action (Train or Log) and one hairline row of every `homeCells()` metric with serif tabular figures. Existing metric prompts still open Log; all supporting sections retain their relative order and actions below the row. Pulls from `useClientStore`. |
| `WorkoutScreen.tsx` | Train | Lists routines (`workoutApi.getRoutines`), launches `ActiveWorkoutScreen`, links to `RoutineBuilder` and `CoachGuidelines`. |
| `LogScreen.tsx` | Log | Day selector, macro summary, four meal sections, water tracker. Search modal hits `foodApi.search`; offline writes go through `services/foodLogQueue`. The `Plan` screen is reached from inside `MoreStack`, not from this tab. |
| `MoreScreen.tsx` | More | Hairline-separated groups: Your plan, Guidance and community, Food and preparation, Health and devices, Account, Learning. Every existing row remains a one-tap destination; order within each group follows the previous menu. Roman stays flag-gated; tutorial builds put health first, otherwise health follows plan. Neutral descriptions do not assume a coach, plan, targets, video or connected device. Cormorant title, Inter rows and semantic theme colors replace filled cards. Roman retains its existing avatar and wearable rows retain tutorial targets. Reachability tests cover every action with flags on/off, iOS/Android and semantic light/dark palettes. Six client tabs are unchanged. |

### AI Guide and messaging

| File | What it does |
| --- | --- |
| `AIGuideScreen.tsx` | Chat with the assistant. Registered on the More stack as `AIGuide` and reachable from the **Guidance** row on `MoreScreen`. Sends only the user message + short history; the backend attaches structured context, persona, and guardrails. Uses `aiApi.getStructuredContext` once on mount to display "what your coach has shared" — purely informational, never assembled into a prompt by the client. Persists locally via `db/chatDb.ts`. |
| `CheckoutReturnScreen.tsx` | Checkout verification, cancellation and access state. Failed verification does not claim a payment was received; pending access does not promise coach contact or notification. The backend's conditional first-ever-payment notification does not support a per-purchase notification claim. Existing Home, plans and purchase-unpack routes remain. |
| `MembershipScreen.tsx` | Access surface. Shows account state, coach identity, member-since date, founding-member badge if applicable, and an in-app **MESSAGE YOUR COACH** action that routes to the Home stack's `Messages` screen. Coach-managed inactive copy describes the invite condition, without predicting coach activity. Suitable for external Stripe / coach-managed access — there is no in-app billing chrome on the client side. Reads `usersApi.getFoundingNumber()` and `aiApi.getStructuredContext()` only. |
| `MessagesScreen.tsx` | One-on-one messages with the assigned coach. Bone page, hairline date dividers, Inter message rows and grouped 13 pt timestamps; square forest send control. Shared `MessageBubble` / `ThreadV2Parts` resolve semantic theme colours. Coach names never imply online presence. REST round-trip through `messagesApi`; a Supabase Realtime broadcast channel pings a refetch on new messages. 60 s fallback poll covers WebSocket drops. Sending, reply/copy/report, contact/block, pins, mute, editing, deletion, failed-send retry, older messages, coach-code and support paths remain unchanged. |
| `NotificationsScreen.tsx` | Coach nudges feed (`nudgesApi`): unfilled hairline rows, full 15 pt titles / 13 pt bodies and relative times, unread dot/weight, mark-read/all and refresh preserved. Empty, loading and request-failure states are distinct. |
| `PrivateCommunityHubScreen.tsx` | Private rooms, recent posts and refresh. Empty copy describes invitations, not future coach activity. The unbuilt voice-note advertisement is removed; no working room/post action is removed. |
| `PurchaseUnpackScreen.tsx` | Receipt, released/upcoming items and next recurring charge. Empty copy names the coach only after a successful read; otherwise it says items appear when released, without guessing a coach or promising notifications. Reads `/v1/clients/me/coach` for the name. Done, retry, refresh, item destinations and the deliverables list retain their existing handlers. |

### Calendar

`calendar/CalendarHomeScreen.tsx` leads with the earliest live session: client-local date and time, coach, duration and status. Join or Call opens a real link during the existing join window; an empty schedule with an available appointment offers one forest booking action. Welcome calls, all appointment types, later/past sessions, paging, refresh, messages and support remain reachable. `CalendarSessionScreen.tsx` retains recap, device-calendar export, reschedule, cancel and rebooking. Missing links say “Call link not added yet.” Cancel still notifies the coach through the backend booking emitter. Shared `calendarUi.tsx` uses theme colours, transparent hairline rows, Inter supporting text, tabular serif times and 48-point haptic controls without animation.

### Health activity overview
`wearables/HealthFitnessScreen.tsx` uses `cards/ActivityBars.tsx` instead of activity rings in loaded, loading and empty states. Each QuietBar shows the latest actual daily value and its sample date; completed missing samples show an absent value, not zero, while initial queries say “Loading samples”. `wearables/starterGoals.ts` is the sole fallback: 5,000 steps, 20 exercise minutes and 250 active kcal, visibly labelled “Starter goal”. Explicit typed coach/client targets override each fallback. The current API exposes no activity-target storage or goal editor, so no edit button is shown. Heart, Workouts, Body and Steps detail routes, refresh/retry, AI slot and Connections CTA remain; coach embeds stay read-only.

### Logging and planning

More → **Meal plan** opens `Plan`; its neutral “View meal plans” description does not promise a weekly plan or assume a coach/assignment exists.

| File | What it does |
| --- | --- |
| `ClientMacrosScreen.tsx` | Read-only daily target: Cormorant/tabular calorie hero, monochrome QuietBar rows, fiber, notes and recorded effective date. Current targets use `/me/macros/current`; consumed values use today's `/log/daily` totals, never assumed zero on failure. “Set by” appears only when `/v1/clients/me/coach` matches the target's coach ID; otherwise “Your target”. Pull-to-refresh reloads targets and food totals; native back and simple/full visibility are unchanged. Follows `docs/QUIET_LUXURY_DOCTRINE.md`. |
| `ExerciseDetailScreen.tsx` | Exercise instructions with a serif name and hairline Muscles / Equipment / How to sections, rendered only when data exists. Signed video retains native playback, fullscreen and PiP; legacy GIF fallback remains. Missing/failed media copy reflects the current state and never assumes instructions exist. Retry reloads the same exercise. No fabricated history or records. |
| `ExerciseLibraryScreen.tsx` | Search-on-submit catalog with three horizontally scrollable text-filter groups (category, muscle, equipment), selected underlines and 44-point targets. Hairline rows retain name, muscle, category and difficulty, and include actual equipment. Cursor pagination, detail navigation and retry are unchanged; all colours use semantic theme tokens. |
| `PlanScreen.tsx` | Read-only view of the meal plan the coach has assigned. Reads from BOTH `mealPlansApi.list` (Sprint-A) and `mealTemplatesApi.todayForClient` (Sprint-B canonical) and merges them so a coach assigning via either path lands on the same screen (P0-1 unification). |
| `DeliverablesScreen.tsx`, `deliverables/dropRow.tsx` | Purchased content: unlocked items first in unfilled hairline rows with an outline open icon; upcoming items muted with their real unlock date/trigger, otherwise “Not unlocked yet.” Cormorant heading, Inter details, complete coach captions, semantic theme colours. Missing viewer references never invite a tap; empty and unavailable lists do not infer coach activity. Workout, meal-plan, message, signed PDF/video, retry, refresh and platform back paths are unchanged; a 44-point Back control now stays visible in every state above safe-area content. The shared row also styles PurchaseUnpack without changing its navigation. Tests: `src/__tests__/deliverablesScreen.test.tsx`. |
| `RecipesScreen.tsx`, `RecipeDetailScreen.tsx` | Browse and save recipes (`recipesApi`). The list passes `{ recipeId }` (a serialisable string) when navigating, never the full recipe object — `RecipeDetailScreen` reads from the React Query cache for synchronous paint and falls back to `recipesApi.getById(recipeId)`. This eliminates React Navigation's non-serializable-params warning and keeps state rehydration intact. New recipe-aware screens must follow the same id-only param pattern. |
| `RoutineBuilderScreen.tsx` | Create/edit routines from Train. Hairline serif name and exercise rows; drag grip plus labelled move-up/down, edit-focus and remove controls; sets, reps and rest remain inline. Search/muscle picker keeps loading, retry and empty states. Save is the sole forest primary; existing routines keep confirmed deletion. Uses the shared routine query/mutations and local exercise catalog; no new endpoint or route. |
| `GroceryListScreen.tsx`, `ShoppingListScreen.tsx`, `PrepGuideScreen.tsx` | List management + weekly prep guide (`listsApi`, `prepGuideApi`): semantic page colors, serif titles, hairline rows, tabular quantities, 44-point check/remove/week controls and numbered recipes beneath suggested-day overlines. Add, check/uncheck, remove, clear confirmation, refresh, week selection and View List → GroceryList remain reachable; list errors offer Try again and empty prep copy does not assume a coach. |
| `FastingScreen.tsx` | Start/end fasting timer (`fastingApi`); backend is the source of truth, no intermediate local store. |
| `HabitsScreen.tsx` | Daily habit ticks (`habitsApi`) and mood/energy/sleep/notes check-ins (`checkInsApi`). Hairline habit rows show real “completed of total today” counts and recorded week indicators. Tap to tick/untick, hold to delete; Add habit opens the existing target/unit sheet. Labelled check-in choices and 44 pt sleep/close controls retain every action, with one forest save action. No edit or history route exists on this screen. |

### Profile, settings, and trust

| File | What it does |
| --- | --- |
| `ProfileScreen.tsx` | Identity and personal details. Reads `usersApi.getFoundingNumber` for the founding-member badge. On focus, reads `/v1/clients/me/coach` and `/consent/me?coach_id=` to describe which workout/meal scopes are shared with that coach. Confirmed `owner_access` preserves owner-coach visibility; absent coach or unconfirmed access shows no sharing sentence. Never claims exclusive access to logs. Settings, report, widgets, learning, personal-info editing and sign-out remain reachable. |
| `SettingsScreen.tsx` | Seven visible groups on one screen, no added taps: Account, Training and food, Notifications, Privacy and data, Roman, Support, About. Every existing row/control stays; see [settings/README.md](settings/README.md). |
| `PreferencesScreen.tsx` | Personalisation toggles persisted via `preferencesApi`. |
| `ReportScreen.tsx` | Shareable weekly summary — image-friendly card output. |
| `WidgetsScreen.tsx` | iOS / Android widget setup walkthrough. |
| `EducationScreen.tsx` | Lesson library (`lessonsApi`) with monochrome hairline rows, recorded dates and real completion counts; filters, refresh, lesson links, detail back and server-confirmed completion remain reachable. No invented Featured badges or coach assumption in the empty state. Follows `docs/QUIET_LUXURY_DOCTRINE.md`. `TimelineScreen.tsx` keeps all four lane filters, refresh and cursor paging with recorded event dates. `ClientPathCopilotScreen.tsx` keeps its existing feature gate and refresh; unavailable data makes no promises of future suggestions or coach review. Both use semantic theme colors. |
| `CommunityScreen.tsx` | Founders' circle leaderboard / wins (`communityApi`). |
| `LeaderboardScreen.tsx` / `LeaderboardSettingsScreen.tsx` | Coach-roster opt-in rankings. Computed self-rank and score lead an unfilled hairline list; settings use semantic theme colours, a forest save action and 13 pt supporting text. Back, settings, optional display name, opt-in/out, name saving and sticky self row are unchanged. Copy describes this leaderboard rather than promising future privacy or immediate activity updates. Render parity: `src/__tests__/leaderboardRedo.test.tsx`. |
| `ProgressScreen.tsx` | Weight chart + macro adherence (`weightApi`, `logApi.getWeekly`). |
| `CoachGuidelinesScreen.tsx` | Read-only guidelines with the supplied title and optional Added date (never an invented workout plan or update date), Inter reading copy, hairlines, skeleton loading, back and retry. Semantic theme colors and neutral empty/error states follow `docs/QUIET_LUXURY_DOCTRINE.md`. |

The **Trust Center** itself lives at `src/screens/TrustCenterScreen.tsx` (not in this directory because it is shared with the coach navigator). DES-BB-127 gave it hairline sections, small-caps overlines and a Cormorant summary line, with every action unchanged.

Trust Center policy links (2026-09-30): the footer links to the **Privacy Policy** (`PRIVACY_POLICY_URL`, `https://app.trygrowthproject.com/privacy`), the **Consumer Health Data Privacy Policy** (`CONSUMER_HEALTH_POLICY_URL`, `/consumer-health-privacy`, required to be reachable from in-app settings by Washington RCW 19.373) and the help centre (`helpUrl()`). The list lives in `src/screens/trustCenterLinks.ts`; the URLs live in `src/config/env.ts`. Policy pages sit at the site root, so never build them with `helpUrl()` (the old `helpUrl('/privacy')` opened `/help/privacy`, which is not the policy). The transparency bullets say what the coach sees (consultation answers, logs, check-ins, connected health data), that Roman conversations are private from the coach and kept until the client deletes them or the account (owner 10-01 20:32, OR-110-1), and that service providers such as Anthropic process data only as the policy describes. The unsupported "US East" data-residency row and bullets were removed. A link that does not open shows, under the link, copy that names the page and fits the cause (OR-112-15, `src/screens/trustCenterLinkFailure.ts`): offline says so and to tap again once connected; a phone that cannot open web links (`Linking.canOpenURL` false or `Linking.openURL` rejects) gets the exact web address, selectable, with Copy web address; anything else gets the address, the support email (`SUPPORT_EMAIL`) with a short reference, Email support and the shared `SupportEmailFallback`. Every failure except offline goes to Sentry through `captureErrorWithoutPii` (no signed-in user id, no request data, no breadcrumbs) with a closed allowlist only (`LinkFailureReport`: event name, link id, operation, cause, an error-class enum, platform, reference); no text from the native exception is ever sent (Sol B-315-1). Tests: `src/screens/__tests__/trustCenterPolicyLinks.test.tsx` and the real-SDK canary `src/screens/__tests__/trustCenterLinkFailure.canary.test.ts`. Any reusable consumer-health link (for example the consultation agreement screen) should import `CONSUMER_HEALTH_POLICY_URL` from `src/config/env.ts`.

### Clinic tutorial additions (featureFlags.clientTutorial, default OFF)

| Screen | Addition |
| --- | --- |
| `HomeScreen.tsx` | `<TutorialHomeSlot />` below the coach introduction banner: the pinned macro explanation card (C08, real `/me/macros/current` or onboarding numbers), a "Message your coach" row into HomeStack `Messages`, and after a skipped tour one quiet line that resumes it. |
| `WorkoutScreen.tsx` | `<PlanExplanationCard />` above the coach-assigned CTA: the assigned program, its weeks and days a week, and "Why this plan" with the reasons from onboarding complete. |
| `MoreScreen.tsx` | "Health and sleep" (`Health`) and "Connected devices" (`Connections`) rows. Both were registered routes with no entry point. |
| `SettingsScreen.tsx` | Settings > Support: resume or run the tour again. |

### Lighter start for never-trackers (no flag; driven by the backend `macro_display_mode`)

| Screen | Behaviour while `simple` (absent field = `full`, unchanged) |
| --- | --- |
| `HomeScreen.tsx` | Number grid shows Calories, Protein and Water. Once the simple week ends, `FullMacrosIntroCard` (Roman, once, dismissible, persisted) introduces carbohydrate and fat. |
| `LogScreen.tsx` | Summary bar shows Eaten, Remaining and Protein. Food entries show protein only. |
| `ClientMacrosScreen.tsx` | Calories and Protein, plus a neutral note naming the current view; no claim about what a client needs. |

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

Client packages are 1:1 person-to-person coaching (App Review Guideline 3.1.3(d)) paid through Stripe, so they stay available on iOS. `ClientPackagesScreen` and `PackageCheckoutScreen` name the individual coach through `oneToOneCoachingLabel()`, for example "1:1 coaching with Bradley". The list, shared `packageDetail/PackageDetailSurface` and `PackageSelectionSheet` use bone-page hairline sections, serif names and tabular price figures, Inter reading text, and 44-point purchase/back/retry targets. The detail's “What's included” and “How it works” overlines group the unchanged inclusions and billing information; preview checkout stays disabled. Styling does not change amounts, price formatting, terms, purchase states, payment calls or actions (see `docs/QUIET_LUXURY_DOCTRINE.md`). The unsolicited package prompt is governed by `lib/packagePromptGate.shouldOfferPackagePrompt()`, checked by Day1Win and by the 24h `package_prompt`: it is offered only after an explicit inactive entitlement (unknown or failed lookups suppress it, so comp clients never see it) and never on a hidden iOS build, where purchase happens only on the labelled 1:1 coaching screen. The feature paywall (`ProtectedScreen` / `PaywallSheet`) shows "Your coach manages your access" with Message your coach on hidden iOS builds, and Membership hides its website link there. Purchase-flow copy speaks of coaching, not of unlocking app features or access.

**Catalog evidence (audit #304 C1).** Client package schemas carry no service-type field, so the app treats every client-purchasable package as 1:1 coaching. Keeping these packages on iOS depends on the owner confirming, or the server enforcing, that every client-purchasable package is real-time 1:1 coaching. Standalone digital content (programs, PDFs or videos sold on their own) must not be sold as a client package. If mixed products are ever allowed, add a trusted per-product classification from the server and fail closed on iOS for unknown or non-P2P products at the list, paywall, share-link checkout and webview entry points.


**Failed payments (S-DUNNING).** `HomeScreen` and `ClientPackagesScreen` render the inline `DunningBanner` (from `src/entitlements/dunning`) on Days 0-9 of a failed payment. It shows the amount, the failure date, the lock date, Update card (Stripe Billing Portal) and Message coach. It renders nothing unless `GET /v1/checkout/dunning` reports an active, unlocked v2 cycle. The legacy payment-status `dunning` banner on `ClientPackagesScreen` stays as it was, and is always null today.
