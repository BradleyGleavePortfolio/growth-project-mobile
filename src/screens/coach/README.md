# Coach screens

Everything a signed-in `coach` user sees. Mounted under `CoachNavigator` (5 tabs: Clients / Dashboard / Templates / Messages / Settings). The coach surface is read-mostly — the source of truth for client data is the backend; these screens are dashboards over it.

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
| `CoachHomeScreen.tsx` | Dashboard — `coachApi.getDashboard` + `coachApi.getAlerts`. The coach's first-open screen. |
| `InviteCodesScreen.tsx` | Create / list / revoke invite codes. Each code has optional `max_uses` and `expires_at`. Share button copies a `https://app.trygrowthproject.com/join/<code>` URL. |
| `ProgramTemplatesScreen.tsx` | Authoring surface for reusable program / meal-plan templates. |
| `SettingsScreen.tsx` | Coach-side settings: business name, accent colour, sign out. |

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
                ──► coachApi.getAlerts
```

The coach's `AsyncStorage` profile (`user_data`) holds `id`, `name`, and `role: 'coach'`. The backend filters every response to coach-owned rows; the mobile app does **not** ever issue a request like "give me all clients" — it asks "give me my clients" implicitly through the JWT.

## App-store / deep-link dependencies

- `InviteCodesScreen` produces deep-link URLs for the client side (`tgp://join/<code>` and `https://.../join/<code>`). These are constructed locally in the share handler — there is no special server endpoint that produces them.
- For the universal-link form to launch silently into the client app on the recipient's device, `assetlinks.json` and `apple-app-site-association` must be hosted at `https://app.trygrowthproject.com/.well-known/...`. Until then, the universal link opens a chooser; the custom-scheme form (`tgp://`) still works.
- The custom scheme is the same `tgp://` scheme the client app declares — there is no separate coach-app bundle. A coach who taps their own invite link with the app installed gets routed to the signup screen, which is fine because they're already signed in and the linking config is a no-op for authenticated states.

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

## Release notes

- For Play / App Store review, supply both a coach test account *and* a client test account so reviewers can exercise the full bidirectional flow (`PLAY_STORE_READINESS.md` §9).
- The InviteCodes screen is the only place an invite URL is produced. If the universal-link host ever changes, that share string and `app.json → expo.android.intentFilters` must change together.
- "Become a coach" is **not** a self-serve action. The role is granted server-side; there is no surface in the mobile app that flips a client into a coach.
