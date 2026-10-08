# Coach screens

Everything a signed-in `coach` user sees. Mounted under `CoachNavigator` (5 tabs: Clients / Dashboard / Templates / Messages / Settings). The Settings tab is a nested stack — `SettingsHome → Billing → TrustCenter` — so child screens are reachable without leaving the tab. The coach surface is read-mostly — the source of truth for client data is the backend; these screens are dashboards over it.

## Purpose

Meal-plan empty-state directions name the client’s **Meal plan** entry under More, not a Plan tab. After AI meal-plan approval, `ClientDetail` opens its coach-side Plan tab via `initialTab: 'mealplan'`, including on return to an already-mounted client detail.

Client-detail Summary requests the device's calendar day using the existing `date` query.
Weekly totals multiply food nutrition by recorded portions, read `protein_g`, and sum
saved workout `weight_per_set × reps_per_set` volume before display rounding. Weekly
and Workouts use `lb` captions. Food review formats the recorded eat day and meal label
without changing portions, notes, targets or sharing states. Weekly disclosure,
7/14/30-day food filters, feedback, meal plans, refresh and workout AI actions remain.
Regression and action parity: `src/__tests__/coachWeekly131.test.tsx`.

Timeline and Weekly have independent loading, failure and verified-empty states.
Failed reads say which tab could not load, without showing raw server text or
claiming that no activity exists. Try again reloads that tab's selected 7/30/90-day
period. The shared QuietLoading skeleton and QuietError forest text action leave
check-in review and weekly disclosure unchanged. Regression and action parity:
`src/__tests__/coachTimelineStates132.test.tsx` (agent 132).

- Show the coach the state of every client they own: streaks, last log, last check-in, alerts.
- Let the coach issue invite codes that bind new signups to their account, and revoke codes they no longer want to honour.
- Talk to clients (per-thread DMs) and ship lightweight nudges (push notifications + in-app banners).
- Manage program templates and per-client meal plans.
- Stay tenant-safe — the coach can only see clients whose `coach_id` matches their own `user.id`.

## Key files

| File | What it does |
| --- | --- |
| `ClientsListScreen.tsx` | Searchable, filterable list of clients (`coachApi.getClients`). Routes to `ClientDetail`, `ClientMessages`, and `InviteCodes`. |
| `ClientDetailScreen.tsx` | Per-client timeline — workouts, weight logs, food logs, check-ins. Nine text tabs retain their destinations with an active underline. Workouts counts only shared recorded sessions this week; an empty visible list says “No shared workout sessions to show”, not that the client never trained. Hairline rows keep recorded date/duration, sets, volume, weight/reps and both note levels visible; RPE appears only if supplied. The top-recorded-load trajectory requires two same-exercise points, not an estimated 1RM. Build-with-AI, copy-and-adjust, back, messages, archive/unarchive and refresh remain reachable. Parity: `src/__tests__/coachClientWorkoutsMakeover127.test.tsx`; styling: `docs/QUIET_LUXURY_DOCTRINE.md`. Surfaces guidelines + the "send nudge" form. Reads `coachApi.getClientTimeline`, `getClientCheckIns`, `getClientSummary`. |
| `ClientPaymentsScreen.tsx` | COACH-PAY-M-130: one client's payments for their coach, opened from Summary > Payments only while `/me/feature-flags` reports `coach_payment_actions` (backend `FEATURE_COACH_PAYMENT_ACTIONS`, CF-COACH-PAY-BE-128). Per plan: price, billing state in words and only the actions the server allows (Pause billing, Resume billing, Restart plan, Cancel plan, each confirmed first); per payment: paid date, refunded and in-progress amounts, Refund. The refund sheet defaults to what is left, says whether access ends, and keeps one idempotency key per amount across retries. Reads `coachClientPaymentsApi` (`GET /v1/coach/clients/:clientId/payments`, `POST .../:purchaseId/refund|pause|resume|cancel`); copy in `src/lib/money/clientPaymentsCopy.ts`. Tests: `__tests__/ClientPayments.test.tsx`. |
| `ClientMessagesScreen.tsx` | One-on-one thread with a single client. Realtime ping + 60 s safety poll, same shape as the client side. |
| `MessagesScreen.tsx` | Inbox across all clients. Pulls `coachApi.getUnreadCounts`. |
| `broadcasts/BroadcastComposerScreen.tsx` | Compose one broadcast for all clients or a tag, package or program audience; send now, schedule or repeat it. Back or close asks “Discard this message?” while text remains. Keep editing preserves the message; Discard continues the original navigation action without sending. Empty or cleared messages leave directly. A successful send or schedule returns to the broadcast list without a discard prompt; failures retain the text and guard. Existing audience, preview, timing, repeat and send controls remain. Native-stack regression: `broadcasts/__tests__/broadcastLeaveGuard131.test.tsx`; existing action parity: `broadcasts/__tests__/broadcasts.test.tsx`. |
| `CoachHomeScreen.tsx` | Dashboard — `coachApi.getDashboard` + `coachApi.getAlerts`. The coach's first-open screen. Renders weight-trend / missed-check-in alerts as the activity feed when alerts exist; renders an explicit empty state explaining what *would* appear here when they don't. There is no "Activity feed coming soon" placeholder — the doctrine forbids it. |
| `InviteCodesScreen.tsx` | Create / list / revoke invite codes. Each code has optional `max_uses` and `expires_at`. The share handler calls `buildInviteUniversalLink(code)` so the pasted URL — `https://app.trygrowthproject.com/join/<code>` — opens the recipient's app via Universal Links / Android App Links and pre-fills the code. The plain code stays in the message body for recipients without the app. |
| `ProgramTemplatesScreen.tsx` | Authoring surface for reusable program / meal-plan templates. |
| `AIWorkoutDraftScreen.tsx` | Review a client's generated workout, edit week/day/exercise fields, save, approve or reject. Back and native removal ask “Discard edits?” only while local edits are unsaved; Keep editing preserves them and Discard continues the original navigation action without saving or rejecting. A successful save clears the guard; failures retain edits. Successful approval or explicit rejection clears it before returning to the existing destination. The footer keeps Save edits / Reject / Approve without internal model, token or dollar-cost provenance. Rejection asks for a reason without promising future draft improvements. Regression and action parity: `src/__tests__/aiWorkoutDraftKeep131.test.tsx`. |
| `CoachBillingScreen.tsx` | Subscription state surface. Renders a status pill (`active` / `trialing` / `past_due` / `paused` / `canceled` / `none`), the plan, seat usage, and renewal / trial dates when present. The CTA opens the backend portal session URL in `expo-web-browser`'s in-app sheet and refreshes status when the sheet closes. Shows an explicit empty state on `404` (backend not yet shipped) instead of a vague spinner. `coachBillingApi.getStatus` maps the backend `status` (raw Stripe status, or `unprovisioned`) to these states; a missing or unknown value reads as `none`, and the screen never throws on an unknown state. Settings no longer links here: coach plans were removed (owner 10-06), so the Subscription row is hidden (CF-COACH-BILLING-129). |
| `SettingsScreen.tsx` | Coach-side settings: business profile (name, bio), notification preferences (server-backed via `notificationsApi.getPreferences` / `updatePreferences`), local haptics toggle, password change (Supabase), **Subscription → Billing & access** entry, **Privacy & Data** section linking to Trust Center, account deletion, and sign out. Polls `usersApi.getAccountStatus` on mount and renders either *Delete account* or *Deletion scheduled — tap to cancel* with the permanent-on date when present. The static *Theme: Dark* row is gone — the app ships a single bone/forest light theme, and a row that didn't reflect that was untrue chrome. |
| `payments/CoachPackageEditScreen.tsx` | Package fields, pricing, recurring interval/trial options, save, publish/unpublish, archive, preview, content and subscribers. Archive guidance names the visible Unpublish package action only while on sale; `PACKAGE_HAS_ACTIVE_SUBSCRIBERS` is mapped to plain copy without directing the coach to cancel subscriptions, with View subscribers as the next step when already off sale. Legacy billing refusals offer Open Money (`CoachMoney`) and Contact support instead of the retired software Billing screen or an active-coach-plan requirement. Share remains available when a real share token exists; the disabled placeholder without a token is removed, not a working pathway. |
| `payments/CoachPackagesListScreen.tsx` | Package list, create/edit routes and refresh. Unavailable packages use neutral version-availability copy, without promising a future release. |
| `CreditPackCheckoutScreen.tsx` | Stripe-webview entry point for AI credit packs (Stream 1). Two-phase flow: selection (pack tiers + custom amount, bounded by `pack_options_cents` / `custom_pack_bounds_cents` from the budget query) then webview (`react-native-webview` pointing at the minted Stripe Checkout URL with the same origin allow-list + deep-link parser as `BrandedCheckoutWebViewScreen`). Not a 1:1 service: on iOS the route is replaced by the neutral hidden state (`withNonP2PPurchaseGate`, see `src/config/purchaseSurfaces.ts`); elsewhere billed via Stripe. On a US-link build (`creditPackCheckoutMode() === 'external'`) the screen says the coach pays TGP the pack price, opens the minted Stripe Checkout URL in the system browser with `Linking.openURL` (never the WebView), sends `tgp://checkout/success` and `tgp://checkout/cancel` as the return links, and waits in an `external` phase ("Done", "Open checkout again"). The success link shows the receipt, the cancel link returns to the packs, and returning to the app refetches the budget. An Android build with `EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK` on (eas.json preview profile only) takes the same `external` path (PACKS-BOTH-131). `route.params.preselect` (from `AIBudgetMount`): a pack amount tapped on the tutorial or hard-pause card starts that pack's checkout once on open; `'custom'` opens with the custom-amount field focused; any other value shows the list. The pack row and the browser wait state say "Credit packs are non-refundable." A checkout that does not start says why in plain words (busy, offline, other) and that nothing was charged. Success state is `SuccessReceipt` (quiet-luxury — see "Success state" below). |
| `PendingAiDraftsScreen.tsx` | Stream 2 inbox of pending AI execution drafts. Lists `AiActionDraft` rows in `status='pending'` for the current coach across the four Stream 2 capabilities (`draft.client_message`, `draft.assign_workout`, `draft.assign_meal_plan`, `draft.send_notification`). Per-capability card variants render the appropriate preview (message body / workout name + weeks + day-1 exercise count / meal plan macro summary / notification title + body). Approve + Reject buttons call the existing approval endpoints. Focus-gated 30s polling via `usePendingAiDrafts` composed with `useIsFocused()`. Reached from any client-detail screen via the `<AskAiActionSheet>` flow (`Summary tab → Ask AI pill → pick capability → submit prompt → navigate here`). |
| `CoachMealTemplatesScreen.tsx` | Not mounted: the unused `CoachMealTemplates` route had no entry action and is intentionally removed (MEAL-TEMPLATES-ROUTE-132). The screen source, `mealTemplatesApi`, hooks, daily-plan authoring/assignment and client Meal plan flow remain. Route/API parity: `__tests__/coachSettingsTruthfulness.test.tsx`. |

The coach Settings Roman row and its accessibility hint both read “Ask about programming, nutrition or running your practice.” The existing flag-gated `RomanChat` destination is unchanged.

COACH-SETTINGS-131: *Active Clients* reads one 50-row page of `GET /coach/clients` (active clients; the route returns 20 rows unless `take` is sent, 50 at most) and shows the count, "50+" for a full page, and "—" while it loads or after a failed load, never 0. *Notification preferences* opens `ClientsStack → NotificationPreferences`, the only place the coach navigator registers that screen (the push router uses the same target); the old bare name from the Settings stack reached no navigator. Payments ends with a text-only *AI credits* row (`settings/AICreditsRow.tsx`, `useAIBudget`, polled only while Settings is focused): percent left, what uses the credits and the renewal day, a low-credit note from 80 percent used and a paused note at 100 percent. It sells nothing. It is hidden for a `sub_coach` (the budget route answers 403), and a failed read says so and tries again on tap. Tests: `__tests__/SettingsScreen.coachSettings131.test.tsx`.

### Stream 2 — AI execution drafts

The coach can ask the AI to propose a side-effecting action (message, workout assignment, meal plan assignment, push notification) and review every draft before it materialises. The flow is:

1. **Invocation** — `Client detail → Summary tab → Ask AI pill` opens `AskAiActionSheet` (`src/components/coach/ai-execution/AskAiActionSheet.tsx`). The coach picks one of four capabilities and types a short prompt (≤ 500 chars). The sheet calls the matching `coachAiExecutionApi.invoke*` method, which on the backend creates an `AiActionDraft` row in `status='pending'`. The sheet closes and routes to the pending-drafts inbox.

2. **Review + decide** — `PendingAiDraftsScreen` renders a per-capability card with the appropriate preview. Approve calls `coachAiExecutionApi.approveDraft(id)` which the backend's `AiApprovalService` resolves to the right materialiser (inserts `CoachMessage` / `ClientWorkoutAssignment` / `DailyMealPlanAssignment` / `Notification` row + dispatches push). Reject calls `coachAiExecutionApi.rejectDraft(id)` and surfaces the audit reason on the gateway side.

3. **Polling** — The inbox uses `usePendingAiDrafts` (`src/hooks/usePendingAiDrafts.ts`) with focus-gated 30-second refetch, mirroring Stream 1's `useAIBudget` pattern. Backgrounded app does not poll.

**Backend dependency**: the four `draft.*` capabilities live on the AI gateway side of the backend (Stream 2 PR). Until that PR merges, the mobile `coachAiExecutionApi` falls back to an in-memory mock so end-to-end flows are testable. Set `EXPO_PUBLIC_AI_EXECUTION_MOCK=off` in staging once backend lands.

**Doctrine** (§3, §5): the "AI draft" badge on each card is a quiet caption-typography label with a hairline border — NOT a celebratory pill. No springs, no particle bursts, no celebration overlays. Single forest accent on the Approve button; Reject uses a hairline-bordered quiet style.

### Success state — `SuccessReceipt`

The credit-pack purchase confirmation uses the `SuccessReceipt` component (defined inline at the bottom of `CreditPackCheckoutScreen.tsx`). It is the pattern any future purchase-confirm surface on the coach side should follow.

Why this pattern exists: `docs/QUIET_LUXURY_DOCTRINE.md` §3 bans confetti, particle bursts, and full-screen celebration overlays. An earlier draft of the screen rendered a particle burst that violated the doctrine and tripped `src/__tests__/quietLuxuryDoctrine.test.ts`. The Round-3 audit + operator decision pulled it.

What it does instead:

- **Motion**: opacity fade-in 0→1 over `motion.duration.base` (400ms) with `Easing.out(Easing.cubic)`. After the fade settles, ONE icon pulse: scale 1.0 → 1.02 → 1.0 over 600ms total (300ms out, 300ms back) with `Easing.inOut(Easing.cubic)`. Both animations use the native driver. Nothing else animates — no translateY, no rotate, no springs, no particles.
- **Color**: single forest accent (`colors.success` on the check icon). No gold, no primary. Background stays bone (`colors.background`). The single-accent rule comes from doctrine §5.
- **Typography**: pulled from `theme/tokens`. `typography.h2` (Cormorant Garamond 400) for the title; `typography.body` for the body line; `typography.bodySmall` muted for receipt-row labels; `typography.bodyMd` ink for receipt-row values. Display weight never exceeds 500 per doctrine §1.
- **Receipt rows**: hairline divider, then two metadata rows in the visual register of an Amex statement or a Loro Piana confirmation page. "New balance" shows the *snapshot* projection (previous remaining cents + amount paid) captured BEFORE the budget query is invalidated, so the value is deterministic and never races with the backend webhook. Falls back to the pack amount alone when the previous balance was unavailable. "Paid to" reads "TGP, through Stripe" (no receipt-email claim: whether Stripe emails one depends on a Stripe account setting). The title reads "Payment complete" and the body says the credit is on its way and is added to the coach's AI credits once Stripe confirms the payment, because the webhook applies it after Stripe's return. It never names Coach Home, because below 60% use (common right after a pack) Coach Home shows no meter.
- **Auto-dismiss**: 1800ms after mount the wrapper calls `onDone()` which routes the coach back to Coach Home. Glanceable, not lingerable. Coach Home's invalidated budget query will surface the confirmed balance once the backend webhook applies the credit.
- **Accessibility**: each metadata row carries a single `accessibilityLabel` composing label + value ("New balance, $25.00") so screen readers read the row as one coherent line rather than two disjoint nodes.

If you add another purchase-confirm surface (e.g. a future subscription upgrade flow), copy this pattern. Do not reintroduce confetti, springs, or any motion outside the fade + single pulse.

## Data flow

```
Coach signs in (same flow as client) ─► role='coach' ─► CoachNavigator mounts

ClientsListScreen ──► coachApi.getClients(status?)            (server-filtered)
ClientDetailScreen ─► coachApi.getClientSummary(clientId, deviceCalendarDay)
                  ─► coachApi.getClientTimeline(clientId, days)
                  ─► coachApi.getClientCheckIns(clientId, ...)
                  ─► coachApi.getMyGuidelines() / postGuidelines

InviteCodesScreen ──► coachApi.listInviteCodes / createInviteCode / revokeInviteCode
                  └─► Share sheet: https://app.trygrowthproject.com/join/<code>

MessagesScreen ──► coachApi.getUnreadCounts                   (badge totals)
ClientMessagesScreen ─► coachApi.getClientMessages / sendClientMessage / markClientThreadRead
                    └─► subscribeToMessages(coachId, refetch) // Realtime broadcast

CoachHomeScreen ──► coachApi.getDashboard
                ──► coachApi.getAlerts                        (renders as activity feed)
                ──► navigation.navigate('SettingsStack')      (Settings is a nested stack)

CoachBillingScreen ──► coachBillingApi.getStatus              (GET /coach/billing/status)
                  ──► coachBillingApi.openPortalSession       (POST /coach/billing/portal-session → { url })
                          └─► WebBrowser.openBrowserAsync(url) → status refetch on dismiss

SettingsScreen ──► usersApi.getAccountStatus                  (GET /users/me/account/status)
              ──► usersApi.deleteAccount                      (DELETE /users/me/account; existing endpoint)
              ──► usersApi.cancelAccountDeletion              (POST /users/me/account/cancel-deletion)
              ──► coachApi.updateBio / notificationsApi.updatePreferences / supabaseAuth.updatePassword
              ──► SettingsStack: SettingsHome → Billing → TrustCenter
```

The coach's `AsyncStorage` profile (`user_data`) holds `id`, `name`, and `role: 'coach'`. The backend filters every response to coach-owned rows; the mobile app does **not** ever issue a request like "give me all clients" — it asks "give me my clients" implicitly through the JWT.

## App-store / deep-link dependencies

- `InviteCodesScreen` produces deep-link URLs for the client side (`tgp://join/<code>` and `https://.../join/<code>`). The share handler calls `buildInviteUniversalLink(code)` so the URL pasted into SMS / email / WhatsApp opens the app via Universal Links / Android App Links and pre-fills the code. There is no special server endpoint that produces invite URLs.
- For the universal-link form to launch silently into the client app on the recipient's device, `assetlinks.json` and `apple-app-site-association` must be hosted at `https://app.trygrowthproject.com/.well-known/...`. Until then, the universal link opens a chooser; the custom-scheme form (`tgp://`) still works.
- The custom scheme is the same `tgp://` scheme the client app declares — there is no separate coach-app bundle. A coach who taps their own invite link with the app installed gets routed to the signup screen, which is fine because they're already signed in and the linking config is a no-op for authenticated states.

## Backend dependencies

`CoachBillingScreen` and the deletion-status row in `SettingsScreen` call four backend endpoints. The mobile build degrades gracefully when any of them returns `404`, but the screens will render limited state until the backend ships the corresponding handler:

| Endpoint | Used by | Behaviour on 404 |
| --- | --- | --- |
| `GET /coach/billing/status` → `{ status, current_period_end, cancel_at_period_end, trial_end }`, mapped by `toCoachBillingStatus` | `CoachBillingScreen` | Renders the `none` empty state. |
| `POST /coach/billing/portal-session` → `{ url }` (Stripe billing portal) | `CoachBillingScreen` CTA | CTA disabled; explicit copy explains the portal isn't reachable yet. |
| `GET /users/me/account/status` → `AccountStatus` | `SettingsScreen` deletion row | Falls back to "Delete account" affordance; cancel-deletion path inert. |
| `POST /users/me/account/cancel-deletion` → `{ cancelled }` | `SettingsScreen` deletion row | The "Deletion scheduled — tap to cancel" tap surfaces the backend error verbatim. |

The existing `DELETE /users/me/account` (already shipped via Trust Center) is unchanged. Deploying the mobile build before any of the four ship is safe — none of the existing surface breaks.

## Security and tenancy

- All `coachApi.*` endpoints derive the coach id from the JWT. The mobile app never sends `coach_id` as a parameter; passing the wrong one would be ignored.
- `revokeInviteCode` is destructive and irreversible — the screen wraps it in an Alert confirmation and uses `warningTap` haptics.
- Coach-side messages and nudges go to a specific client id; the backend re-validates ownership before forwarding. A coach cannot DM another coach's client, even if they fabricate the request.
- `ProgramTemplatesScreen` writes are scoped to the coach who created them. Templates are not shared across coaches.

## Environment variables

Same set as the client side — `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. The Realtime channel uses the Supabase URL + anon key.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Clients list is empty after sign-in | Coach has no attached clients yet, or the JWT is stale | Issue an invite code, share it, wait for a client signup. The list refetches on focus. |
| Invite code creation fails with a 4xx | Coach exceeded an account limit (set server-side) | Surface the backend error verbatim — the coach can revoke an unused code to free a slot. |
| ClientDetail shows blank metrics | The client is new and has no logs yet | Expected. The screen renders an empty state, not zeros. |
| Realtime ping silent on a coach phone | Backgrounded WebSocket or aggressive Doze | 60 s poll fallback fires; foreground transition refetches. |
| Booking inbox, invites, pending AI drafts, risk board or a Programs list did not load | Network drop, timeout or a server failure | One calm sentence and a forest "Try again" text action (`ui/states/QuietStates`); "Check your connection" only when the request got no answer. Loading is the shared skeleton. |
| Share sheet copies an invite URL but recipient's phone opens a browser | `assetlinks.json` not hosted yet, or fingerprint mismatch | Use the `tgp://` form for now, or chase the hosted-file deployment. |

## Tests

There are no jest tests specific to coach screens; integration coverage lives in the smoke matrix. The underlying helpers (`store/coachStore`, API clients) have unit tests where shared with the client side. Run:

```bash
npm test
npm run typecheck
```

## Tests

There are unit tests covering this PR's surface specifically:

- `src/services/__tests__/billingAndAccountApi.test.ts` — pins the request shapes for `coachBillingApi.getStatus`, `openPortalSession`, `usersApi.getAccountStatus`, `cancelAccountDeletion`, and asserts the existing `deleteAccount` is unchanged.
- `src/navigation/__tests__/coachNavigation.test.ts` — guards the `SettingsStack` shape (`SettingsHome → Billing → TrustCenter`) and the `CoachHome → SettingsStack` navigation target.
- `src/screens/coach/__tests__/InviteCodesShare.test.ts` — asserts the share payload contains the universal-link URL.

Run:

```bash
npm test
npm run typecheck
```

Doctrine still passes — no `fontWeight: '700' | '800'`, no "Coming Soon" / "Activity feed coming soon", no emoji, no TODO/FIXME.

## Device QA requirements

Coach sale-readiness is the kind of surface that *cannot* be signed off on a simulator alone. Before promoting any build that touches these screens, the release manager exercises the following on a real Android 13+ device after `adb install`-ing the APK:

- **Coach → Settings → Billing & access**: open the screen, confirm the status pill, dates, and seat usage match the backend payload, tap the portal CTA, complete or close the Stripe portal sheet, confirm the screen refreshes status when the sheet dismisses. If the backend has not shipped, confirm the explicit "No subscription" empty state renders instead of a spinner.
- **Coach → Settings → Delete account**: tap, confirm the row flips to *Deletion scheduled — tap to cancel* with the permanent-on date; tap again, confirm it returns to *Delete account*.
- **Coach → Settings → Invite Codes → Share**: confirm the share-sheet payload contains `https://app.trygrowthproject.com/join/<code>`. On a recipient device with the app installed and the well-known files hosted, confirm the link opens directly into `CreateAccount` with the code prefilled.
- **Coach → Settings → Privacy & Data → Trust Center**: confirm both export and delete actions are reachable from a single tab without dropping out of the Settings stack.
- **Welcome screen on a fresh install**: confirm *Request access* opens the mailto draft.

These rows belong in `docs/RELEASE_SMOKE.md`'s real-device-proof section; capture artefacts under `release-artifacts/<build>/` per the runbook.

## Release notes

- For Play / App Store review, supply both a coach test account *and* a client test account so reviewers can exercise the full bidirectional flow (`PLAY_STORE_READINESS.md` §9).
- The InviteCodes screen is the only place an invite URL is produced. If the universal-link host ever changes, that share string and `app.json → expo.android.intentFilters` must change together.
- "Become a coach" is **not** a self-serve action. The role is granted server-side; there is no surface in the mobile app that flips a client into a coach.
- Coach billing in store builds is a status surface, without software-subscription purchase, portal or payable-invoice links. Android development and web retain the existing portal handoff. Any future store purchase path needs the applicable store billing or enrolled alternative-billing integration.

## iOS: purchases that are not 1:1 services (clinic launch)

With `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` on (default in release builds; set in `eas.json` preview + production), iOS builds hide:
- The `CreditPackCheckout` route, wrapped by `components/purchases/withNonP2PPurchaseGate`. Its hidden state reads "Not available in this app" (packs are not sold in this version of the app; there is no web checkout) with no link or URL, and an AI budget push routes to Settings instead of this screen.
- The "Buy credits" banner CTA, the meter chip tap, and `PackOptionsRow` in the tutorial and hard-pause modals.
- Exception (owner decision 10 fallback): with `EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK` on (set only in the `eas.json` clinic profile), the credit-pack items above show again and checkout opens in the system browser, under Guideline 3.1.1(a) for the US storefront. The app cannot read the storefront, so that build must be offered only on the US App Store (owner action in App Store Connect), and the App Review notes must mention the US external link. Seat upgrades, subscriptions and one-to-many products stay hidden.
- Android (PACKS-BOTH-131): with `EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK` on (set only in the `eas.json` preview profile, the directly installed Android test app) the same credit-pack items show and checkout opens in the system browser with the same `tgp://` return links. Production and clinic Android builds keep them hidden (a Google Play build with the switch is an owner decision). Everything else sold stays hidden on Android.
- The "Start subscription" / "Manage billing" button and invoice links in `CoachBillingScreen`. The status copy switches to a neutral note.

Android release builds hide the same digital AI/software purchase surfaces through
`digitalPurchasesHidden`; Android development and web remain unchanged. Direct navigation
and budget notifications use the same decision as the visible buttons. Client real-time
1:1 human-coaching purchases, including recurring packages, remain available and are
not routed through this digital-only gate. See `src/config/purchaseSurfaces.ts`.

Google Play generally requires Play Billing for in-app digital goods, cloud software
and subscriptions unless an applicable enrolled alternative-billing program is
correctly integrated; a Stripe webview alone is not that integration.
[Google Play Payments](https://support.google.com/googleplay/android-developer/answer/9858738?hl=en).
The exception for 1:1 online coaching requires two individuals and no replay of the
paid session in a Play-distributed app.
[Google Play's policy explanation](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en).
