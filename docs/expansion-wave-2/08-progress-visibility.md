# 08 — Progress visibility

> What a coach sees about a client's progress, and what a client sees about their own. The visibility rules — shared, scoped, redacted — across weight, training, nutrition, check-ins, and assignments.

## WHY

The shipped app (`ProgressScreen.tsx`, `ReportScreen.tsx`) already shows the *client* their own progress. The coach side (`ClientDetailScreen`, `coachApi.getClientTimeline`, `getClientCheckIns`, `getClientSummary`) shows a coach's view of a single client. Wave 2 adds new artefacts (program assignments, challenges, content engagement, voice notes) that produce *progress signals*. Without a single contract for who sees what, each new artefact will reinvent the visibility rule, and a client will eventually find a screen where their progress is shown to someone they didn't expect.

## WHEN

- Phase 0 — flag `wave2_progress_v2` defined, off everywhere; existing surfaces unchanged.
- Phase 1 — unify the existing coach client-detail timeline + client report view onto a shared *Progress object* (server-side projection).
- Phase 2 — add Wave-2 signals (challenge progress, assignment milestones, content engagement) to the Progress object.
- Phase 3 — coach-shared views with the client (see "Shared views" below).
- Phase 4 — exportable / printable client report (PDF), driven from the same projection.

## WHERE

- Extends `src/screens/client/ProgressScreen.tsx` and `src/screens/client/ReportScreen.tsx`.
- Extends `src/screens/coach/ClientDetailScreen.tsx`.
- New screen: `src/screens/coach/ClientProgressOverviewScreen.tsx` — denser cross-client view (pulls from existing `coachApi.getDashboard` plus new endpoints).
- No new client-side top-level screen. The existing `Progress` link from `MoreScreen` remains the entry.

## WHO

| Role | Sees their own progress | Sees one client's progress | Sees cross-client progress |
| --- | --- | --- | --- |
| Client | Yes, full | n/a | No |
| Coach (head) | n/a | Yes, full, for own clients | Yes, in `ClientProgressOverviewScreen` (own clients only) |
| Junior coach (Team Mode) | n/a | Yes, for shared clients only | Same |
| Anyone else | No | No | No |

A coach **cannot** see things the client has explicitly redacted (see "Redaction layer").

## WHAT

### Progress object (mobile expectation, server-projected)

```ts
interface ClientProgress {
  clientId: string;
  windowStart: string;     // ISO date
  windowEnd: string;       // ISO date
  weight: WeightSeries;
  training: TrainingSummary;
  nutrition: NutritionSummary;
  checkIns: CheckInSummary;        // matches PR #92 brief 05/06
  assignments: AssignmentSummary;  // brief 06
  challenges: ChallengeSummary;    // brief 01
  contentEngagement: ContentEngagementSummary;   // brief 04
  redactions: RedactionSet;        // see below
}

interface WeightSeries {
  points: Array<{ date: string; kg: number; isManual: boolean }>;
  trendKgPerWeek: number | null;
  goalKg: number | null;
}

interface TrainingSummary {
  sessionsCompleted: number;
  sessionsScheduled: number;
  prCount: number;
  byWeek: Array<{ weekStart: string; completed: number; scheduled: number }>;
}

interface NutritionSummary {
  daysLogged: number;
  proteinTargetHitDays: number;
  caloriesAvgKcal: number | null;
}

interface CheckInSummary {
  submitted: number;
  windowSize: number;
  lastSubmittedAt: string | null;
  flagsRaised: number;     // questions answered with concerning values; see PR #92 #08
}

interface AssignmentSummary {
  active: Array<{ id: string; subjectKind: 'program' | 'content_item' | 'challenge'; status: string; progressPct: number | null }>;
  recentlyCompleted: Array<...>;
}

interface ChallengeSummary {
  active: Array<{ id: string; metric: string; rank: number | null; progress: number }>;
  completed: Array<...>;
}

interface ContentEngagementSummary {
  itemsViewed: number;
  itemsAssigned: number;
}

interface RedactionSet {
  weight: 'visible' | 'hidden_by_client';
  bodyImages: 'visible' | 'hidden_by_client' | 'never_existed';
  voiceNotesBody: 'visible' | 'hidden_by_client';
  // server adds keys as new artefacts emerge; mobile defaults to 'visible' for unknown keys to avoid breaking older builds when the server adds a key
}
```

### Shared views

A "shared view" is a sub-projection that the **client controls** and the coach receives. Default for all paying clients: full visibility (today's behaviour). The new layer is **opt-out**, not opt-in: existing coaching relationships do not regress.

The client controls redaction in `PreferencesScreen`:

- "Hide my weight from my coach" — server stops including `weight.points` for this client; coach sees "Weight visibility: hidden by client" with a soft-tone copy (no negative framing).
- "Hide voice-message bodies" — coach sees voice-note metadata (sent / read) but cannot replay (server returns `audioUrl: null`). Outside scope of this brief but listed for completeness; ties to brief 07.
- "Hide body photos" — same.

Redaction is **server-enforced**. Mobile cannot defeat it; the redaction is applied before the response leaves the server.

## HOW

### Screens / navigation sketch

```
ClientNavigator → MoreScreen → "Progress" → ProgressScreen (existing)
  ├── (existing) charts and stats
  └── NEW (Phase 2): "From your coach" section
        ├── Active assignments (compact)
        ├── Active challenges (compact)
        └── "Sharing settings" link → PreferencesScreen redaction toggles

ClientNavigator → MoreScreen → "Report" → ReportScreen (existing)
  └── Export "shareable summary" — text + chart screenshot, share-sheet (existing pattern)

CoachNavigator → Clients tab → ClientDetailScreen (existing, extended)
  ├── (existing) timeline, summary, guidelines
  ├── NEW: Compact progress card (1 row each: weight trend / training / nutrition / check-ins)
  └── NEW: "Open full progress" → opens existing client-side ProgressScreen rendered read-only with coach context

CoachNavigator → Clients tab → ClientProgressOverviewScreen (new)
  └── Cross-client list: per-client one-line status (last log, last check-in, weight trend, assignment status, alerts).
```

### API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/me/progress?days=N` | Client view, with own redactions applied (n/a really — own data is always visible to self). |
| `GET` | `/coach/clients/:id/progress?days=N` | Coach view, with client redactions applied server-side. |
| `GET` | `/coach/progress-overview` | Cross-client summary; one row per client. |
| `PATCH` | `/me/preferences` | Updates `redactions` flags (existing `usersApi` extended). |

The schema is intentionally **a single object** (not three separate endpoints) because the alternative produces 3× the round-trips for the coach detail screen. Versioning: `X-Capability: progress-v2`. Mobile builds without it see the legacy timeline endpoint and continue to work.

### Existing endpoint compatibility

The current `coachApi.getClientTimeline`, `getClientCheckIns`, `getClientSummary` continue to be served. The new endpoint is *additive*. Mobile is responsible for picking one — the implementation PR will route the new screen to the new endpoint and the old screens (until migrated) to the old ones.

### Media upload UX

None directly. Body photos as a feature live in the brief 03 (avatars) and brief 07 (image attachments) trees and are *visible* to the coach via the messaging surface unless the redaction layer hides them.

### Accessibility

- Charts (existing `react-native-svg`) have an `accessibilityLabel` summary that names the metric, units, and trend direction.
- Per-day cells expose data to screen readers via `accessibilityValue={{ now, min, max, text }}`.
- Cross-client overview uses table-like semantics; row tap announces "{name}, last log {date}, weight {trend} kg/week, {alerts} alerts."
- Color is never the only signal (training-completion green vs missed grey is also a label "Completed" / "Missed").
- Default font scale to 1.6× must not crop the cross-client overview — long names truncate with ellipsis.
- Reduce-motion respected for chart entry (currently a 1-frame fade — preserved).

### Loading / error / empty states

- **Loading**: per-section shimmer — weight chart, training row, nutrition row, check-ins row.
- **Empty (new client, no data)**: "Logs and check-ins will appear here." — for both sides.
- **Empty (redacted)**: coach sees "Weight visibility: hidden by client" with a 2-line explainer copy. **Never** a guilt-inducing copy ("They won't show you this").
- **Error**: human language, retry, Sentry tag `surface: 'wave2.progress'`.
- **Offline**: cached projection from React Query persistor; OfflineBanner; section-level "Last fetched {ago}" annotation.
- **Mixed**: sections that resolved render; sections that errored show their own error state. Whole-screen failure is reserved for auth/network.

### Privacy / moderation

- The redaction layer is the load-bearing privacy property. v1 redactions are coarse (weight, voice bodies, body photos). Future briefs add granular redactions per-artefact.
- **Coach cannot see *that a client redacted*** beyond a neutral status pill — i.e. the coach knows visibility is reduced, but not the timeline of when the client toggled it.
- **Junior coach** sees the same redactions as the head coach (no widening through team mode).
- **Audit log**: coach reads of `/coach/clients/:id/progress` are server-logged so a client can request "who has read my progress" via Trust Center (out-of-band; Trust Center docs already cover this pattern).
- The cross-client overview never shows individual *values* that a client has redacted — only the redaction status pill.

### Feature flags / entitlements

- `wave2_progress_v2` (PostHog) — top-level. Default off.
- `progress_v2.cross_client_overview` — Phase 1 sub-flag.
- `progress_v2.redactions` — Phase 1; this is the load-bearing flag for the privacy layer. Once on, must not flip off without a Trust Center incident.
- No tier entitlement on the read; this is table-stakes coaching.

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_progress_view` | `role`, `surface: 'self' \| 'one_client' \| 'overview'`, `window_days_bucket` | Screen open |
| `wave2_progress_redaction_changed` | `key`, `to_value` | Pref toggle |
| `wave2_progress_view_redacted_section` | `role`, `key` | Coach view of redacted section |
| `wave2_progress_export_started` | `format: 'pdf' \| 'share_text'` | Phase 4 |
| `wave2_progress_export_failed` | `format`, `reason_code` | Phase 4 |

Never weight values, never names. Buckets only.

### Rollout

1. Server-side projection lands; backend exposes both old and new endpoints.
2. Internal coach + internal client validate parity (cross-check old vs new for the same client).
3. Pilot coach + their clients → flag on, redaction toggles default to *off* (full visibility), preserving today's behaviour.
4. Post-pilot, redaction toggles are surfaced to all clients.
5. Cross-client overview rolled out to pilot coach.
6. Rollback: top-level flag off → screens fall back to existing timeline + summary endpoints.

### Tests

- **Unit**: `redactions` apply server-side — but mobile defensively re-applies (defence in depth). Unit test the mobile filter for known redaction keys.
- **Unit**: `progress` shape parser — unknown keys preserved as `unknown`, never crash.
- **Hook**: `useProgress(clientId, days)` and `useMyProgress(days)` Loading/Empty/Error/Data.
- **Component (RNTL)**: per-section render under each redaction state.
- **Component**: cross-client overview, sort and filter.
- **Snapshot at scale=1.6×**: charts, redacted section.
- **Backend contract test**: an authenticated coach cannot fetch a redacted field by passing a query param, header, or alternate endpoint. (Backend PR responsibility; mobile contract test confirms the negative case.)

### Risks

| Risk | Mitigation |
| --- | --- |
| Redaction toggle becomes a client weapon ("I'll hide my weight to avoid hard conversations"). | Coaching-product tradeoff. Brief copy explicitly does not pathologise the toggle; the redaction status pill is neutral. Trust Center docs explain coach expectations. |
| Coach panics that "their data" is hidden. | Pre-launch coach communication explains the toggle: it has always been the client's data. |
| Server adds a new redaction key; older mobile builds default to "visible" for unknown keys. | This is the documented behaviour (defence is *server-side* enforcement). Server returns redacted-empty for unknown-to-old-mobile clients. |
| Cross-client overview becomes a surveillance surface. | Per-row data is the same the coach already sees on `ClientDetailScreen`. No new fields. |
| Audit log of coach reads bloats. | Server-side concern; mobile is unaffected. |
| Charts misread (skewed axes). | Existing charts already handle axis selection; reusing them. No new charts in this brief. |
| Redaction interaction with PR #92 brief 10 (`coach-generate-recap`) — recap might leak redacted data via LLM. | LLM gateway in backend PR #117 receives only fields the coach can read; redactions apply at the gateway boundary, not after generation. |

### Dependencies

- Brief 06 (`per-client-assignment`) — assignments summary lives here.
- Brief 01 / 02 — challenge progress / leaderboard rank surfaced.
- Brief 04 — content engagement metrics.
- Brief 07 — voice-note redaction reads from the same `redactions` key.
- PR #92 brief 05 / 06 / 08 / 10 — check-ins + AI recap pipeline; this brief documents how progress flows through them.
- PR #93 `docs/platform-readiness/09-api-contract-compatibility.md` — versioned endpoints.
- PR #93 `docs/platform-readiness/07-loading-error-empty-states.md` — `AsyncBoundary` reuse.
- Backend progress-projection job; backend redaction enforcement; audit-log table.

### Acceptance criteria

- A coach reads `ClientProgressOverviewScreen` and `ClientDetailScreen` against the new endpoint with parity to the legacy view (no regressions).
- A client toggles "Hide my weight" and the coach's view shows the redacted status pill within ≤30 s (poll/realtime).
- The cross-client overview renders 50 rows under 250 ms on iPhone 12 / Pixel 5.
- A redacted field is *never* present in any analytics event payload.
- Sentry shows zero `surface: 'wave2.progress'` errors over a 7-day pilot.

### Operator handoff

- **Owning surface**: mobile lead. Privacy review = security/trust lead.
- **Out-of-band steps**: backend projection + redaction enforcement; PostHog flags; Trust Center docs cover the redaction model **before** the toggle ships to clients.
- **"Done" means**: pilot coach reads progress for 5 clients across 2 weeks; one client toggles a redaction; the coach sees the neutral status pill without any error or stale value; audit log shows the coach's reads; zero unhandled Sentry errors.
