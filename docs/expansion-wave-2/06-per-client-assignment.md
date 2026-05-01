# 06 — Per-client assignment

> A single primitive for assigning *anything* (program, content item, challenge) to *one* client with a start date and per-client overrides. The unifying surface that makes the rest of Wave 2 coherent.

## WHY

Today, "assign a program" is implicit (the coach's `Plan` flow points the client at a meal plan via `mealPlansApi.list`). "Assign a piece of content" doesn't exist. "Assign a challenge" is being designed in brief 01. Each one needs the same primitives — an assignable thing, a target client, a start date, optional overrides — and inventing them three times is how product surfaces decay. This brief specifies the **assignment object** as a first-class concept and the editor that creates it.

## WHEN

- Phase 0 — flag `wave2_assignments` defined, off everywhere.
- Phase 1 — assignments for *programs* (brief 05).
- Phase 2 — assignments for *content items* (brief 04, `pinnedToAssignmentId`).
- Phase 3 — assignments for *challenges* (brief 01); challenges are unusual because they are 1:N — they reuse the assignment table per-participant.
- Sequencing: this is the **prerequisite** brief for 04, 05, and 01's invite path.

## WHERE

- New screen: `src/screens/coach/AssignmentEditorScreen.tsx` — modal-style, reachable from `ClientDetailScreen`, `ProgramTemplatesScreen` (per-program "Assign" action), and `ContentBoardScreen` (per-item "Pin to assignment" action).
- Existing `src/screens/coach/ClientDetailScreen.tsx` gets a new "Active assignments" section and an "Assignment history" sub-section.
- New screen: `src/screens/client/AssignmentDetailScreen.tsx` — read-only view of the current assignment for the client.
- `src/screens/client/HomeScreen.tsx` updated (in the implementation PR) to show "Today's assignment" — *only* if an active assignment exists; otherwise the existing single-CTA layout is unchanged.

## WHO

| Role | Can create assignment | Can view |
| --- | --- | --- |
| Coach (head) | Yes, for own clients | All assignments for own clients |
| Junior coach | Only if `assignments.create` capability granted (Team Mode) | Shared clients only |
| Client | No | Own assignments |
| Anyone else | None | None |

## WHAT

### Assignment object (mobile expectation)

```ts
type AssignmentId = string;
type AssignmentSubjectKind = 'program' | 'content_item' | 'challenge';

type AssignmentStatus =
  | 'scheduled'       // start date in the future
  | 'active'          // started, not ended
  | 'paused'          // coach-paused
  | 'completed'       // ended naturally (program duration done, challenge endDate passed)
  | 'cancelled';      // coach-cancelled before completion

interface Assignment {
  id: AssignmentId;
  coachId: string;
  clientId: string;             // for program / content_item; equals participantId for challenge
  subject: { kind: AssignmentSubjectKind; id: string; version: number };
  startDate: string;            // ISO date in client's timezone
  endDate: string | null;       // null for content_item; computed for program; equals challenge.endDate
  status: AssignmentStatus;
  overrides: AssignmentOverrides | null;
  notes: string | null;         // coach note shown to client at top of AssignmentDetailScreen
  createdAt: string;
  updatedAt: string;
}

type AssignmentOverrides = ProgramOverrides | ContentOverrides | ChallengeOverrides;

interface ProgramOverrides {
  // Per-week-in-program rest-day adjustments and per-session swaps.
  // v1: rest-day swap only; full session swap is post-MVP.
  restDaySwaps: Array<{ weekIndex: number; oldDay: number; newDay: number }>;
  loadAdjustment?: 'standard' | 'easier' | 'harder';   // applies an override at render time
}

interface ContentOverrides {
  // Phase-2: pin to a phase / week of a program assignment.
  pinnedToAssignmentId: AssignmentId | null;
}

interface ChallengeOverrides {
  // v1: none. Challenges are 1:N, not per-client tweakable.
  _noOverrides: true;
}
```

### Why `overrides` is optional, typed, narrow

The temptation is to put a generic JSON blob here. We resist: every override key requires a server-side renderer that respects it, a client-side reader that understands it, and a validation rule. We will add override keys *with the screen change that uses them*, not pre-emptively. v1 ships with `restDaySwaps` and `loadAdjustment` only.

## HOW

### Screens / navigation sketch

```
ClientDetailScreen (existing, extended)
  ├── Existing: timeline, summary, guidelines, send nudge
  ├── NEW: Active assignments
  │     ├── 0 to 3 cards (program, content, challenge)
  │     └── + assign → AssignmentEditorScreen
  └── NEW: Assignment history (collapsed, expandable)

AssignmentEditorScreen (modal-style, full-screen on Android)
  ├── Step 1: pick subject kind
  │     └── Tabs: Program | Content item | Challenge (challenge gated by brief 01 flag)
  ├── Step 2: pick the subject (search; pulls from /coach/programs etc.)
  ├── Step 3: start date + (program only) phase / week to start at
  ├── Step 4: overrides (collapsible; defaults: none)
  ├── Step 5: optional coach note
  └── Confirm → POST /coach/assignments → toast on success → close modal

AssignmentDetailScreen (client side)
  ├── Subject card (program / content / challenge)
  ├── Coach note (if present)
  ├── Status row (active / scheduled / paused / completed / cancelled)
  ├── Action: open the underlying surface (WorkoutScreen for program, reader for content, challenge detail for challenge)
  └── If paused/cancelled: explanatory copy, no destructive affordance
```

### API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/coach/assignments?clientId=` | Coach: assignments for a client. |
| `POST` | `/coach/assignments` | Create. |
| `PATCH` | `/coach/assignments/:id` | Edit notes/overrides; restricted fields per status. |
| `POST` | `/coach/assignments/:id/pause` | Pause an active assignment. |
| `POST` | `/coach/assignments/:id/resume` | Resume. |
| `POST` | `/coach/assignments/:id/cancel` | Cancel. |
| `GET` | `/me/assignments` | Client view: my assignments (active + scheduled + recent completed). |
| `GET` | `/me/assignments/:id` | Client detail. |

Versioning: `X-Capability: assignments`. Backend serves only the assignment kinds whose `X-Capability` includes them — a mobile build that doesn't know about challenges receives no challenge assignments (empty filter, not error).

### Conflict / edge-case rules

- A client can hold **at most one active program assignment** at a time (server-enforced). Assigning a new program with overlapping dates returns 409 with a "this overlaps existing program assignment" reason; the editor surfaces it as a confirmation modal: "End the current program first?"
- Content-item assignments are **unbounded** (a client can have many).
- Challenge assignments are **independent of program assignments** (a client can be in three challenges simultaneously while running one program).
- `startDate` in the past for a program → server backfills `status: 'active'`. For a challenge with `startDate` already past, server enforces `endDate > now` or rejects.
- Pausing a program freezes the client's schedule (no day advances during pause). Resume sets a new effective start date `= old start + paused duration`.

### Media upload UX

None directly. The pinned-content variant (Phase 2) hooks into brief 04's existing media path.

### Accessibility

- Assignment editor is a multi-step modal; every step's confirm button is keyboard-reachable and announces step progress (`"Step 2 of 5"`).
- Per-step back button is present and announces "Go back to step n."
- Status pills (`scheduled`/`active`/`paused`/`completed`/`cancelled`) have both an icon and a text label — colour is never the only signal.
- Date pickers respect platform a11y settings.
- Reduce-motion respected for the modal slide-in.

### Loading / error / empty states

- **Loading (active assignments section)**: 1 shimmer card, height matches the real card.
- **Empty (no active assignments)**: "No active assignments." + "ASSIGN" CTA (coach side). Client side: copy reads "Your coach hasn't assigned a program or resource yet."
- **Error**: "Couldn't load assignments." + retry. Sentry tag `surface: 'wave2.assignments'`.
- **Conflict modal (409 on create)**: explicit two-button layout — `END CURRENT PROGRAM` / `KEEP CURRENT PROGRAM`. No silent override.
- **Offline (coach)**: editor disabled. Existing assignment view shown from cache; status pill displays last-fetched timestamp.

### Privacy / moderation

- Assignment notes are **coach → client** authored content. Server does not run content moderation on them in v1; the assumption is paying coach accountability. Client can report a note via long-press → `POST /me/assignments/:id/report-note`.
- Only the coach who created an assignment, the assigned client, and (under Team Mode) shared junior coaches can read it. Server enforces.
- Coach pause / cancel is logged; the client's `AssignmentDetailScreen` shows a non-blaming copy: "This assignment is paused." (no reason exposed unless the coach explicitly added one in `notes`).
- A cancelled assignment retains its history for both sides (read-only) for 90 days, after which it is purged from the coach's history and remains in the client's history view as "Cancelled — older than 90 days, details removed."

### Feature flags / entitlements

- `wave2_assignments` (PostHog) — top-level. Default off.
- `assignments.programs` / `assignments.content` / `assignments.challenges` — per-subject sub-flags so each can roll independently. All start off; turned on as their parent briefs ship.
- No tier entitlement on assignment authorship — assignment is a *coaching primitive*, not a premium feature. (The *thing being assigned* may be tier-gated; that gate is upstream.)

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_assignment_created` | `subject_kind`, `has_overrides`, `start_in_days_bucket`, `has_note` | Editor confirm |
| `wave2_assignment_paused` | `subject_kind`, `days_active_bucket` | Pause action |
| `wave2_assignment_resumed` | `subject_kind` | Resume action |
| `wave2_assignment_cancelled` | `subject_kind`, `days_active_bucket` | Cancel action |
| `wave2_assignment_overlap_resolved` | `chose: 'replace' \| 'keep'` | 409 modal resolution |
| `wave2_assignment_view` | `role`, `subject_kind`, `status` | Detail open |

No client / coach IDs, no note text.

### Rollout

1. Backend service stands up. Mobile gets `GET /me/assignments` returning empty `[]`; existing surfaces unchanged.
2. Flag `wave2_assignments` + `assignments.programs` on for internal coach. Validate a single-program assignment end-to-end.
3. Flag on for pilot coach. After 1 week, enable `assignments.content`.
4. After brief 01 ships, enable `assignments.challenges`.
5. Rollback: top-level flag off → coach loses the editor entry; client's `AssignmentDetailScreen` gracefully empty-states.

### Tests

- **Unit**: status transitions — only legal transitions are allowed (`scheduled→active→paused→active→completed`, `→cancelled` from any non-completed).
- **Unit**: overlap detection.
- **Unit**: `loadAdjustment` resolves correctly at render time given a `standard` Program.
- **Hook**: `useAssignment(id)` Loading/Empty/Error/Data; `useMyAssignments()` for client.
- **Component (RNTL)**: editor multi-step navigation; conflict-modal two-button choice; pause/resume/cancel actions.
- **Component**: client `AssignmentDetailScreen` for each kind (program / content / challenge).
- **Snapshot at scale=1.6×**: editor steps 3 and 4 (the heaviest forms).
- **Backend contract**: 404 on `GET /me/assignments` → mobile shows empty state, never error state.

### Risks

| Risk | Mitigation |
| --- | --- |
| Two coaches (Team Mode) assign overlapping programs to the same client. | Single-active-program rule is server-enforced; second assignment 409s; editor handles. |
| Coach cancels assignment as a hostile act; client sees a confusing screen. | Cancel-confirm copy + non-blaming client-side framing. Cancel is reversible within 24 h via `resume`. |
| Override schema balloons over time. | Brief explicitly enumerates v1 overrides. Adding a new override key requires a brief update, not just code. |
| Time-zone drift in `startDate`. | Storage is ISO date (no time); render uses client's local TZ; server documents the convention. |
| Client confused by "scheduled" assignment that doesn't yet appear in Workout/Content surfaces. | Client `HomeScreen` shows a "Starts {relative_date}" row; tapping opens `AssignmentDetailScreen` (read-only preview). |
| Notes contain abusive content; client is harmed before report flow runs. | Reporting flow is one tap; long-press on the note. Trust review notified. |
| Assignment object becomes the dumping ground for coach-side workflow. | Brief is explicit: only programs/content/challenges in v1; new kinds need their own brief and cap-flag. |

### Dependencies

- Brief 04 (`coach-content-boards`) — `pinnedToAssignmentId` field reads from this.
- Brief 05 (`coach-regimens-programs`) — programs are the largest assignment subject.
- Brief 01 (`coach-fitness-challenges`) — challenges reuse the assignment plumbing.
- PR #92 `docs/expansion/06-coach-checkins-widget.md` — the check-ins widget shows assignment progress.
- PR #92 `docs/expansion/12-ready-to-scale-checklist.md` — assignments are a first-class checklist item.
- PR #93 `docs/platform-readiness/04-role-based-navigation-architecture.md` — junior-coach `assignments.create` capability gate.

### Acceptance criteria

- A coach can assign a program to a client, see it on `ClientDetailScreen`'s active section, and the client sees it on `HomeScreen` and `AssignmentDetailScreen`.
- Pause / resume / cancel each move the assignment through the documented status transitions.
- A second program assignment that overlaps surfaces the conflict modal and respects the chosen resolution.
- Junior-coach without capability sees the assignments section as read-only.
- Sentry shows zero `surface: 'wave2.assignments'` errors over a 7-day pilot.

### Operator handoff

- **Owning surface**: mobile lead (cross-cuts coach + client). Backend lead owns the assignment service.
- **Out-of-band steps**: assignment service deployed; PostHog flags created (4 of them); `assignments.create` capability metadata added to Team Mode role definitions.
- **"Done" means**: pilot coach assigns 1 program, 2 content items, and 1 challenge to a single pilot client across 2 weeks; client engages with all three from `HomeScreen`; pause + resume + cancel all work without a support contact; zero unhandled errors.
