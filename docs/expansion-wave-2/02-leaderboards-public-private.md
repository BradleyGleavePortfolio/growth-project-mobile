# 02 — Public + private leaderboards

> Per-challenge standings views with explicit visibility scope, opt-in display, and anonymisation. A leaderboard is a *property of a challenge* (brief 01), not a separate object.

## WHY

Leaderboards turn a challenge into a shared event rather than a private commitment. Without one, every participant runs the challenge in isolation; with one (handled correctly), the cohort gains a sense of momentum and the coach gains a low-effort retention surface. Handled *incorrectly*, leaderboards cause the harm the doctrine was written to prevent — comparison anxiety, body-shape ranking, public callouts of the lowest performer. This brief specifies the smallest viable form that ships *with* the consent and anonymisation guardrails baked in, not bolted on later.

## WHEN

- Phase 0 — flag `wave2_leaderboards` defined, off everywhere. Brief 01 (`coach-fitness-challenges`) ships with `leaderboardEnabled = false` enforced server-side regardless of the toggle in the editor.
- Phase 1 — flag on for the same internal-test cohort that pilots brief 01.
- Phase 2 — flag on for the pilot coach. Default visibility is `private`; `public_link` requires backend-side feature-flag-of-flags (defence in depth).
- Phase 3 — wider rollout. `public_link` permanently behind L3 entitlement (see brief 09).

## WHERE

- Adds a `Leaderboard` tab to `ChallengeDetailScreen` (coach) and a `Standings` section to `ChallengeDetailClientScreen` (client). No new top-level screens.
- Public-link variant adds a *web* surface that the mobile app does not own. The mobile app's only contribution is the share sheet that produces the URL and the deep-link router that routes the URL back into the app for signed-in users (`tgp://challenge/<id>?ref=public_link`).
- Reachable from: `ChallengesListScreen` → tap a challenge → `Standings`. No new bottom tab.

## WHO

| Role | Can see leaderboard | Can see *my* row on leaderboard | Can see participant names |
| --- | --- | --- | --- |
| Coach (head) of the challenge | Always, regardless of participant opt-in | n/a | Always |
| Junior coach | Only if shared via Team Mode (backend PR #118) | n/a | Yes |
| Client (participant), opted in to display | Yes, full | Yes (named) | Yes (other opted-in only); opted-out shown as anonymised handle |
| Client (participant), opted out of display | Yes, but their own row is anonymised; can still see others who opted in | No (anonymous) | Yes (other opted-in only) |
| Client (non-participant) of the same coach, `visibility=cohort` | Yes, read-only | n/a | Yes (opted-in only) |
| Anyone with `public_link` | Yes, read-only marketing page | n/a | Anonymised handles only by default |
| Signed-out | `public_link` view only; CTA to install / sign in |

The default for a participant's *display name* is anonymised initials (e.g. `B.G.`). To appear by full first name, the client toggles "Show my name on leaderboards" in `PreferencesScreen`. The toggle is per-user, not per-challenge — one decision, applied everywhere — and is **off by default**.

## WHAT

### Visibility model

```ts
type LeaderboardVisibility =
  | 'private'      // participants of THIS challenge only
  | 'cohort'       // all clients of the authoring coach
  | 'public_link'; // anyone with the link

interface LeaderboardEntry {
  rank: number;
  userId: string;          // never rendered; used only as React key
  displayName: string;     // either "First L." or "B.G." per the user's pref + visibility
  progress: number;        // metric-native (steps, days, kg, etc.)
  status: 'joined' | 'completed';   // opted_out is filtered out client-side too
  isMe: boolean;
  isCoach: boolean;        // true for coach's own row when participating
}
```

A participant's display name on the leaderboard is the **minimum** of:

1. their global `show_name_on_leaderboards` preference, and
2. the most-restrictive scope rule for the challenge visibility:

| Visibility | Default name shown if user did not opt in |
| --- | --- |
| `private` | First name + last initial (e.g. `Bradley G.`) |
| `cohort` | First initial + last initial (`B.G.`) |
| `public_link` | Anonymised handle (`Member 17`) |

If the user opts in via `PreferencesScreen`, the display lifts one step (cohort goes to first-name-last-initial; public stays at first-initial-last-initial — never full name on a public link without an *additional* explicit per-challenge consent, which v1 does not collect).

### Anti-pattern guardrails

- **No "loser of the day" / "bottom of the leaderboard" highlighting.** The list ends at the lowest opted-in entrant; there is no bottom-three callout.
- **No streak/badge/trophy iconography**, per merged PR #70. Position is rendered as a numeral; the only accent allowed is the existing camel hairline for founding members (per doctrine §6).
- **Tied ranks share a number** (`1, 2, 2, 4`). No "tiebreak by weight" or other physical-attribute proxies.
- **No celebratory animation** on rank change. The list re-orders with the standard 400 ms `decel` motion. No confetti, springs, or pop-ins.
- **No notifications** ("You moved up 2 spots!") in v1. Brief 07 (`coach-client-messaging-surfaces`) is the place for *coach-authored* messages; rank-change pings are out of scope and out of doctrine.

## HOW

### Screens / navigation sketch

```
ChallengeDetailScreen (coach)
  ├── Roster tab
  ├── Progress tab
  ├── Leaderboard tab          (this brief)
  │     ├── Header: title, days remaining, my (coach's) rank if participating
  │     ├── List: rank · displayName · progress
  │     ├── Tap row: NOT navigable in v1 (privacy)
  │     └── Footer: "n participants chose to display anonymously."
  └── Settings tab
        └── Visibility selector (private / cohort / public_link L3 only)
        └── "Generate public link" action (only when visibility=public_link)

ChallengeDetailClientScreen (client)
  ├── Header
  ├── My progress
  ├── Standings section        (this brief)
  │     ├── Top 3 + my row pinned
  │     ├── "Show full standings" expansion
  │     └── "Hide my name" affordance → routes to PreferencesScreen toggle
  └── Opt-out CTA
```

### API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/challenges/:id/leaderboard` | Returns `LeaderboardEntry[]` redacted per the requesting user's permission. |
| `GET` | `/challenges/:id/leaderboard/public` | Public-link variant; rate-limited; redacted to anonymised handles regardless of user prefs. |
| `POST` | `/challenges/:id/public-link` | Coach action: generate / rotate / revoke a public link slug. |
| `PATCH` | `/me/preferences` | Toggle `show_name_on_leaderboards`. |

The redaction is **server-side**. Mobile's job is to render whatever the server returns and *additionally* not log raw entries to Sentry / PostHog.

### Media upload UX

None. Leaderboards have no media in v1.

### Accessibility

- The leaderboard list uses `accessibilityRole="list"` with `accessibilityLabel="Standings"` and per-row `accessibilityLabel="Rank {n}, {displayName}, {progress} {unit}"`.
- The "isMe" row has a separate `accessibilityHint="This is your row."` (not just a colour cue).
- Tied ranks announce as "Tied for rank n."
- Top-3 pinning + "Show full standings" is a `Pressable` with appropriate `accessibilityState={{ expanded }}`.
- Default font scale to 2.0× must not break the row layout — long display names truncate with ellipsis, not overflow.

### Loading / error / empty states

- **Loading**: 5-row shimmer matching the row spec.
- **Empty (no participants joined yet)**: 1-line copy "Standings appear once participants join." No CTA.
- **Empty (no metric data yet, e.g. day 0)**: 1-line "Standings begin {date}."
- **Error**: "Standings are unavailable right now. Try again." with retry. Sentry tag `surface: 'wave2.leaderboards'`.
- **Offline**: cached snapshot rendered with a top `OfflineBanner`. Last-fetched ISO timestamp shown small under the title.
- **Public-link 404**: web surface owns the empty state; mobile only handles the deep-link path (signed-out → install prompt; signed-in non-participant → marketing-style read-only view).

### Privacy / moderation

- **Display-name minimisation** is the load-bearing privacy property. It is implemented server-side; mobile cannot widen it.
- **Coach can't impersonate a client on the leaderboard.** Coach's own row is rendered with `isCoach: true` and a small "Coach" suffix.
- **Reporting**: a row's long-press surfaces "Report this entry" → navigates to a server-side report endpoint (out of scope to define here; brief 04 `coach-content-boards.md` defines the same report surface and that pattern is reused).
- **Public link** carries no PII in the URL: the slug is a high-entropy random string, not a coach name or challenge title.
- **Rotation**: coach can rotate or revoke a public link; old links 404 within ≤ 5 minutes.
- **GDPR**: opt-out + name-minimisation is documented in `docs/well-known/` (Trust Center surface) before this ships.

### Feature flags / entitlements

- `wave2_leaderboards` (PostHog) — top-level off switch.
- `wave2_leaderboards.public_link` (PostHog) — separate flag, gated to L3 entitlement at the entitlement layer (defence in depth: flag *and* entitlement must both grant).
- `wave2_leaderboards.cohort_visibility` — kept on by default once `wave2_leaderboards` is on; separate flag exists for emergency rollback.

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_leaderboard_view` | `role`, `visibility`, `participants_bucket`, `is_public_link` | List render |
| `wave2_leaderboard_my_row_position_bucket` | `position_bucket`, `participants_bucket` | Per render — never the raw rank, to avoid leaking by replay |
| `wave2_leaderboard_name_pref_changed` | `to_value` | Pref toggle |
| `wave2_leaderboard_public_link_generated` | (no body) | Coach action |
| `wave2_leaderboard_public_link_revoked` | (no body) | Coach action |
| `wave2_leaderboard_report_entry` | (no body) | Long-press report |

PostHog must not receive raw `userId`, `displayName`, or `progress` values. The bucket helpers live in `src/services/analytics.ts` (to be added by the implementation PR).

### Rollout

1. Server-side enforcement lands first — backend redacts even if mobile asks for unredacted data.
2. Flag on for internal test cohort. Validate name-minimisation rules render correctly under each visibility.
3. Flag on for pilot coach with `private` only.
4. After 2 weeks of zero privacy incidents, enable `cohort` for pilot coach.
5. `public_link` enabled only at L3 entitlement, after a separate Trust Center docs update.
6. Rollback path: turning off `wave2_leaderboards` instantly hides the surface; backend continues redacting.

### Tests

- **Unit**: name-minimisation function — every (preference, visibility) pair maps to the documented display style.
- **Unit**: opt-out filter — a row with `status='opted_out'` is removed even if the server slipped one through.
- **Hook**: `useLeaderboard(challengeId)` Loading/Empty/Error/Data.
- **Component (RNTL)**: top-3 pin + my-row pin renders even when my row is rank 17.
- **Component**: tied ranks render as `1, 2, 2, 4`.
- **Snapshot at scale=2.0×**: long names truncate.
- **Integration manual**: public-link rotation invalidates a stale link; mobile shows a useful empty state on a revoked link.
- **Backend contract**: server returns the same redaction regardless of `Authorization` header tampering.

### Risks

| Risk | Mitigation |
| --- | --- |
| A participant feels publicly outed by appearing on a `public_link` board. | Default is opted-out + anonymised. The product never lifts a user above the *minimum* of (their pref, the visibility scope). Rotation + revoke is one tap. |
| Coach uses leaderboard to coerce or shame. | Brief copy + `QUIET_LUXURY_DOCTRINE.md` rules forbid bottom-callout UX. Reporting flow exists. |
| Rank churn becomes a notification spammer. | No rank-change notifications in v1. Period. |
| Rank inference from public link reveals private info (e.g. weight delta). | `weight_delta` metric is **disallowed** for `public_link` visibility (server-enforced); mobile editor disables the option in the UI. |
| Doctrine drift: future PR adds a "🥇" emoji or a "1st place" gold border. | This brief explicitly bans both. Code-review skill catches it. |
| Cohort-visibility leak: a non-participant sees opted-out users' progress. | Server filters; mobile filters again as a belt-and-braces measure. |

### Dependencies

- **Brief 01** (`coach-fitness-challenges`) — challenges are the parent object; nothing here functions without it.
- **Brief 09** (`tier-gated-l2-l3`) — `public_link` entitlement.
- **PR #93 `docs/platform-readiness/02-feature-flag-consumption.md`** — the `useFlag()` contract.
- **PR #93 `docs/platform-readiness/08-crash-and-analytics-readiness.md`** — analytics property redaction policy.
- **PR #93 `docs/platform-readiness/11-deep-links-readiness.md`** — `tgp://challenge/<id>?ref=public_link` parsing.
- **Backend** — leaderboard projection job; redaction; rotation/revoke endpoint; rate-limited public route.
- **Trust Center** — `docs/well-known/` updates before `public_link` ships.

### Operator handoff

- **Owning surface**: coach-side = coach lead. Client privacy review = security/trust lead.
- **Out-of-band steps**: PostHog flags created with the rollout plan above. Trust Center docs updated for `public_link` *before* its flag is enabled. Stripe / entitlement metadata supports `leaderboards.public_link` capability for L3 plans.
- **"Done" means**: pilot coach runs a challenge with `cohort` visibility; ≥80% of participants leave the default opt-out; no PostHog event leaks raw rank or display name; zero `surface=wave2.leaderboards` errors in a 7-day Sentry window.
