# Coach screens

Everything a signed-in `coach` user sees. Mounted under `CoachNavigator` (5 tabs: Clients / Dashboard / Templates / Messages / Settings). The Settings tab is a nested stack — `SettingsHome → Billing → TrustCenter` — so child screens are reachable without leaving the tab. The coach surface is read-mostly — the source of truth for client data is the backend; these screens are dashboards over it.

## Purpose

- Show the coach the state of every client they own: streaks, last log, last check-in, alerts.
- Let the coach issue invite codes that bind new signups to their account, and revoke codes they no longer want to honour.
- Talk to clients (per-thread DMs) and ship lightweight nudges (push notifications + in-app banners).
- Manage program templates and per-client meal plans.
- Stay tenant-safe — the coach can only see clients whose `coach_id` matches their own `user.id`.

## Key files

| File | What it does |
| --- | --- |
| `ClientsListScreen.tsx` | Searchable, filterable list of clients (`coachApi.getClients`). Routes to `ClientDetail`, `ClientMessages`, and `InviteCodes`. |
| `ClientDetailScreen.tsx` | Per-client timeline — workouts, weight logs, food logs, check-ins. Surfaces guidelines + the "send nudge" form. Reads `coachApi.getClientTimeline`, `getClientCheckIns`, `getClientSummary`. |
| `ClientMessagesScreen.tsx` | One-on-one thread with a single client. Realtime ping + 60 s safety poll, same shape as the client side. |
| `MessagesScreen.tsx` | Inbox across all clients. Pulls `coachApi.getUnreadCounts`. |
| `CoachHomeScreen.tsx` | Dashboard — `coachApi.getDashboard` + `coachApi.getAlerts`. The coach's first-open screen. Renders weight-trend / missed-check-in alerts as the activity feed when alerts exist; renders an explicit empty state explaining what *would* appear here when they don't. There is no "Activity feed coming soon" placeholder — the doctrine forbids it. |
| `InviteCodesScreen.tsx` | Create / list / revoke invite codes. Each code has optional `max_uses` and `expires_at`. The share handler calls `buildInviteUniversalLink(code)` so the pasted URL — `https://app.trygrowthproject.com/join/<code>` — opens the recipient's app via Universal Links / Android App Links and pre-fills the code. The plain code stays in the message body for recipients without the app. |
| `ProgramTemplatesScreen.tsx` | Authoring surface for reusable program / meal-plan templates. |
| `CoachBillingScreen.tsx` | Subscription state surface. Renders a status pill (`active` / `trialing` / `past_due` / `paused` / `canceled` / `none`), the plan, seat usage, and renewal / trial dates when present. The CTA opens the backend portal session URL in `expo-web-browser`'s in-app sheet and refreshes status when the sheet closes. Shows an explicit empty state on `404` (backend not yet shipped) instead of a vague spinner. Reachable as `Settings → Subscription → Billing & access`. |
| `SettingsScreen.tsx` | Coach-side settings: business profile (name, bio), notification preferences (server-backed via `notificationsApi.getPreferences` / `updatePreferences`), local haptics toggle, password change (Supabase), **Subscription → Billing & access** entry, **Privacy & Data** section linking to Trust Center, account deletion, and sign out. Polls `usersApi.getAccountStatus` on mount and renders either *Delete account* or *Deletion scheduled — tap to cancel* with the permanent-on date when present. The static *Theme: Dark* row is gone — the app ships a single bone/forest light theme, and a row that didn't reflect that was untrue chrome. |

## Data flow

```
Coach signs in (same flow as client) ─► role='coach' ─► CoachNavigator mounts

ClientsListScreen ──► coachApi.getClients(status?)            (server-filtered)
ClientDetailScreen ─► coachApi.getClientSummary(clientId)
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
| `GET /coach/billing/status` → `CoachBillingStatus` | `CoachBillingScreen` | Renders the `none` empty state. |
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
- Coach billing is in-app only as a status surface and a portal handoff. There is no in-app card capture, no in-app price list, no Stripe Elements. Coaches who churn do so through the same portal a coach who upgrades does. If a future iteration introduces in-app purchase, it must declare against Play Billing / StoreKit and add the corresponding Play data-safety entry.
