# 01 — Coach-created fitness challenges

> Time-boxed challenges authored by a coach (e.g. "30-day step", "8-week strength PR"). A coach defines the challenge, picks a metric and goal, scopes participation (own clients vs. invitable), and the client opts in. Progress is computed server-side from existing logs (food, weight, workouts) plus optional manual entries.

## WHY

The coach product today has no way to issue a structured group goal. Coaches running multi-client cohorts work around this by sending the same nudge through every 1:1 thread. That degrades over time (no leaderboard, no end-state, no completion record), it pollutes per-client message history, and clients have nothing to opt in to. A first-class challenge object lets one author act create N parallel commitments with a clear scope, deadline, and outcome, *without* turning this into a gamification surface (per `QUIET_LUXURY_DOCTRINE.md` rules 3 + 4 — no trophies, no hype copy).

## WHEN

- Phase 0 — flag `wave2_challenges` defined, off everywhere.
- Phase 1 — coach can create + edit a challenge; clients see no surface yet (server reads only).
- Phase 2 — flag on for one pilot coach + their opted-in clients; participation + progress visible; leaderboards still off (see [`02-leaderboards-public-private.md`](./02-leaderboards-public-private.md)).
- Phase 3 — leaderboard surface added behind its own flag; broader rollout decided per metrics (opt-in rate, opt-out rate, median client engagement, complaint volume).
- Sequencing: should ship *after* `06-per-client-assignment.md` because assignment is the primitive that lets the coach scope a challenge to a defined client list. Should ship *before* `02-leaderboards-public-private.md` because there is nothing to rank without challenges.

## WHERE

### Coach surface
- New screen: `src/screens/coach/ChallengesListScreen.tsx` — reachable from `CoachHomeScreen` ("Challenges" row, hidden when flag off) and from `ProgramTemplatesScreen` ("Linked challenges" sub-section when a template defines a default challenge).
- New screen: `src/screens/coach/ChallengeEditorScreen.tsx` — author surface (create / edit / archive).
- New screen: `src/screens/coach/ChallengeDetailScreen.tsx` — per-challenge dashboard: roster, progress, drop-outs, exports.

### Client surface
- New `MoreScreen` row "Challenges" (hidden when no active or invited challenge exists *and* the flag is off).
- New screen: `src/screens/client/ChallengesScreen.tsx` — list of invited / joined / completed challenges.
- New screen: `src/screens/client/ChallengeDetailClientScreen.tsx` — single challenge, progress, days remaining, opt-out.

### Navigation registration
- Both screens registered on the coach `MoreStack` (or the existing `Templates` stack — TBD by mobile lead) and on the client `MoreStack` respectively. **No new bottom tab is added** — the four-tab client shape and five-tab coach shape are immutable per cross-cutting constraints.

## WHO

| Role | Can do |
| --- | --- |
| Coach (head) | Create / edit / archive challenges. Invite their own clients. View per-challenge progress for their roster only. |
| Coach (junior, gated by Team Mode — backend PR #118) | View challenges shared by head; cannot create unless head grants the `challenges.author` capability. |
| Client | View their own invitations and joined challenges. Opt in / opt out. View their own progress. View leaderboard *only* if visibility allows (see brief 02). |
| Anonymous / signed-out | No surface. Universal-link `tgp://challenge/<id>` short-circuits to the auth gate. |

## WHAT

### Data model (client-facing shape — backend owns persistence)

```ts
type ChallengeId = string;          // server-generated cuid
type ChallengeMetric =
  | 'steps_total'
  | 'workouts_completed'
  | 'streak_days'         // generic adherence: any log on N consecutive days
  | 'protein_target_hit'  // counts days protein target was hit
  | 'weight_delta'        // signed delta vs. start weight
  | 'manual';             // coach scores manually via ChallengeDetailScreen

type ChallengeVisibility = 'private' | 'cohort' | 'public_link';
// private    -> participants only
// cohort     -> all clients of the authoring coach (default)
// public_link -> anyone with the link can view marketing page; join still requires invite/code

interface Challenge {
  id: ChallengeId;
  coachId: string;
  title: string;                    // "30-Day Step", max 60 chars
  description: string;              // markdown allowed in the editor; rendered as plain text in v1
  startDate: string;                // ISO date (TZ: client local at start)
  endDate: string;                  // ISO date, exclusive
  metric: ChallengeMetric;
  goal: number | null;              // e.g. 300_000 for steps_total; null for streak/manual
  visibility: ChallengeVisibility;
  leaderboardEnabled: boolean;      // controlled separately; see brief 02
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ChallengeParticipant {
  challengeId: ChallengeId;
  userId: string;
  status: 'invited' | 'joined' | 'opted_out' | 'completed' | 'failed';
  progress: number;                 // server-computed
  rank: number | null;              // surfaced only if leaderboard rules permit (brief 02)
  joinedAt: string | null;
  completedAt: string | null;
}
```

### Acceptance criteria

- Coach can create a challenge with title, dates, metric, goal, and visibility in ≤ 4 form steps.
- Server-rejected fields (e.g. end before start) surface inline error states; nothing destructive happens client-side on rejection.
- A client invited to a challenge sees it on their `MoreScreen` only after the flag is on for *their* user.
- Opt-out is one tap with confirmation; on opt-out the challenge moves to a "Past invitations" group.
- A coach can archive a challenge in-flight; participants keep their final progress snapshot but the challenge is read-only afterwards.
- Title and description copy is doctrine-clean (no exclamations, no hype, no emoji).

## HOW

### Screens / navigation sketch

```
CoachNavigator
└── Dashboard (tab)
    └── CoachHomeScreen
        └── "Challenges" row  (hidden if flag off)
            └── MoreStack/coach → ChallengesListScreen
                ├── ChallengeEditorScreen (new / edit)
                ├── ChallengeDetailScreen
                │   ├── Roster tab        — invited / joined / opted_out / completed
                │   ├── Progress tab      — per-participant progress
                │   ├── Settings tab      — visibility, leaderboard toggle, archive
                │   └── Export action     — CSV download via in-app browser

ClientNavigator
└── Profile (tab) → MoreStack
    └── "Challenges" row  (hidden if no challenge AND flag off)
        └── ChallengesScreen
            └── ChallengeDetailClientScreen
                ├── Header — title, dates, days remaining
                ├── My progress
                ├── Leaderboard (only if visibility permits — see brief 02)
                └── Opt-out CTA
```

The deep-link contract adds `tgp://challenge/<id>` and `https://app.trygrowthproject.com/challenge/<id>`. Both must be added to `src/navigation/linking.ts` (or wherever linking config lives — see `docs/platform-readiness/11-deep-links-readiness.md`) **without breaking** the existing `tgp://join/<code>` route. The follow-up implementation PR is responsible for that change; this docs PR does not modify any linking code.

### API contract (mobile expectation)

All endpoints under `/coach/challenges` (coach) and `/me/challenges` (client). Tenancy enforced server-side via JWT; mobile never passes a `coachId`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/coach/challenges` | List my (coach's) challenges. |
| `POST` | `/coach/challenges` | Create. |
| `PATCH` | `/coach/challenges/:id` | Edit. |
| `POST` | `/coach/challenges/:id/archive` | Archive. |
| `GET` | `/coach/challenges/:id/participants` | Roster + progress. |
| `POST` | `/coach/challenges/:id/invite` | Invite a client (body: `{ userId }`). |
| `POST` | `/coach/challenges/:id/manual-score` | For `metric=manual`, body: `{ userId, value }`. |
| `GET` | `/me/challenges` | My (client) invitations + joined. |
| `POST` | `/me/challenges/:id/join` | Opt in. |
| `POST` | `/me/challenges/:id/opt-out` | Opt out. |

Versioning: per `docs/platform-readiness/09-api-contract-compatibility.md`, mobile sends `X-API-Version: 2026-05-01` and `X-Capability: challenges`. Backend that does not yet understand challenges returns `404`, and mobile gracefully renders the empty state — never the error state.

### Media upload UX

v1 has **no media uploads on challenges**. A challenge cover image is *post-MVP*. When added (post-flag-on), the upload path follows brief [`03-profile-images-and-avatars.md`](./03-profile-images-and-avatars.md): `expo-image-picker` → server-signed presigned URL → POST. No raw S3 keys leave the server.

### Accessibility

- Every form input has an `accessibilityLabel` and `accessibilityHint`.
- Date pickers are keyboard-navigable and large-touch-target compliant (44 pt min).
- Progress bars have a `progressbar` role and `accessibilityValue` (`{ min, max, now }`).
- Color is never the only signal: completed / failed states use a distinct icon + text label, not just a hue.
- Default font scale up to 1.6× must not clip the editor form (snapshot test required).
- Reanimated transitions respect `AccessibilityInfo.isReduceMotionEnabled()`.

### Loading / error / empty states

Per `docs/platform-readiness/07-loading-error-empty-states.md`, every query-backed screen wraps in `<AsyncBoundary />`:

- **Loading**: 1× shimmer of the row layout. No spinner.
- **Empty**: editorial 2-line copy + single CTA. Coach empty: "No challenges yet. Create one when you're ready." with "CREATE" CTA. Client empty: "No active challenges." with no CTA (only the coach can invite).
- **Error**: human-language error + "TRY AGAIN" CTA. Sentry `captureError(err, { tags: { surface: 'wave2.challenges' } })`.
- **Offline**: cached list shown with a top `OfflineBanner` (existing component); writes (join, opt-out, manual-score) queue.

### Privacy / moderation

- Challenge metadata (title, description) is coach-authored. v1 has no client-authored copy on challenges, so no moderation pipeline is needed.
- Participation data is private to the participant + their coach. Server enforces; mobile never assumes.
- A client's progress is never sent to other clients except through the leaderboard — and only under the rules in brief 02.
- Opt-out removes the user from the participant list immediately on the server. Final progress is retained on the *coach*'s view as `status: 'opted_out'` for record-keeping; it does not appear on any leaderboard.
- Coach-facing CSV export is permission-gated server-side (head coach only); junior coaches see "Export disabled by your team admin" empty state on the action.

### Feature flags / entitlements

- `wave2_challenges` (PostHog) — gates the entire surface. Default off.
- `wave2_challenges.author` (entitlement, not flag) — gates the create/edit affordances. See `09-tier-gated-l2-l3.md` for entitlement plumbing; in practice, only paid coach tiers L2 + L3 can author.
- `wave2_challenges.manual_metric` — gates the `metric=manual` option (kept off by default until coach UX for scoring is reviewed).

### Analytics events

| Event | Properties (PII-redacted) | Where emitted |
| --- | --- | --- |
| `wave2_challenge_created` | `metric`, `visibility`, `goal_bucket` (not goal), `duration_days` | `ChallengeEditorScreen` save success |
| `wave2_challenge_archived` | `days_active` | `ChallengeDetailScreen.SettingsTab` |
| `wave2_challenge_invited` | `cohort_size_bucket` | `ChallengeDetailScreen.RosterTab` |
| `wave2_challenge_join` | `metric` | `ChallengeDetailClientScreen` |
| `wave2_challenge_opt_out` | `days_in` | `ChallengeDetailClientScreen` |
| `wave2_challenge_completed` | `metric`, `final_progress_bucket` | server-side; mobile only emits a `viewed` event |
| `wave2_challenge_view` | `role`, `surface` | `ChallengesScreen` and coach equivalents |

### Rollout

1. Land docs (this PR) + backend stub (server can return empty list at `GET /me/challenges`).
2. Flag on for `coach:internal_test` PostHog cohort (mobile lead + 1 coach).
3. Flag on for paid pilot coach (Team Mode head) for 2 weeks. Watch: opt-out rate, time-to-create, error volume.
4. Wider release. Leaderboards remain behind brief 02's flag.
5. Founding-member coaches' challenges are *visually unchanged* — the camel/forest accent is the only tier hint per doctrine.

### Tests

- **Unit (Jest)**: `challengesApi` shape, validation (end > start, goal sign per metric, max title length).
- **Hook**: `useChallenge(id)` returns Loading/Empty/Error/Data correctly under React Query.
- **Component (RNTL)**: `ChallengeEditorScreen` form errors, submit-disabled-while-pending, opt-out confirmation.
- **Snapshot at scale=1.6×**: editor form does not clip.
- **Integration (manual checklist in this brief)**: deep-link `tgp://challenge/<id>` lands on the right screen for signed-in / signed-out / wrong-coach states.
- **Backend contract test**: mobile sends `X-API-Version`; on 404, the empty state appears (no error state).

### Risks

| Risk | Mitigation |
| --- | --- |
| Coaches use challenges as a substitute for actual programming. | Editor copy + acceptance criteria specify challenges as *adjuncts* to programs, not replacements. Brief 05 (`coach-regimens-programs.md`) is the place for programming. |
| `metric=manual` becomes a vector for arbitrary coach narrative + bias. | Off by default; flag-gated; logged event records that a manual score was applied. |
| Doctrine drift: someone reintroduces "trophy"/"badge" vocabulary on the leaderboard surface. | Brief 02 explicitly bans those terms; lint check (existing `doctrine/excise-streak-badge-trophy-vocabulary` PR #70) covers types and components. |
| Opt-out is interpreted as "leave the cohort" by the client; they expect to be removed from the coach's roster. | Confirmation modal copy is explicit: "Leaving this challenge does not remove your coach access." |
| Time-zone drift around `startDate` / `endDate`. | Dates stored as ISO date (no time); the start at the client's local midnight is *the* event; server documents the convention. |
| Server returns ranks + progress for opted-out users by accident. | Backend contract test in this PR's follow-up; mobile defensively filters `status === 'opted_out'` from leaderboard rendering anyway. |

### Dependencies

- **Brief 06** (`per-client-assignment`) — assignment primitive used by the invite flow.
- **Brief 02** (`leaderboards`) — the visibility surface; not blocking authorship.
- **Brief 09** (`tier-gated-l2-l3`) — entitlement check on `challenges.author`.
- **Backend** — new endpoints listed above, plus participation-projection job.
- **PR #92's `docs/expansion/06-coach-checkins-widget.md`** — `CoachHomeScreen` is the entry point; that brief already documents the coach home layout. Adding a challenges row should not move check-ins.
- **PR #93's `docs/platform-readiness/04-role-based-navigation-architecture.md`** — junior-coach gating is the same pattern.
- **PR #93's `docs/platform-readiness/11-deep-links-readiness.md`** — adds `tgp://challenge/<id>` route without breaking `tgp://join/<code>`.

### Operator handoff

- **Owning surface**: coach-side = coach lead; client-side = client lead. Backend = backend lead (challenges service).
- **Out-of-band steps** before this can ship: backend service stood up; PostHog flag created in both staging and production projects; entitlement `challenges.author` exists in the billing system (Stripe metadata or backend-owned mapping).
- **"Done" means**: a head-coach pilot user can create a challenge, invite three clients, see two opt in and one opt out, archive the challenge, and export a CSV — entirely from the mobile app, without contacting support, with the flag on only for them. Sentry shows zero unhandled errors for that flow over a 7-day window.
