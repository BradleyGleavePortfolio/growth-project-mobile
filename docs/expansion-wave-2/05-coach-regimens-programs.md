# 05 — Coach-created regimens / programs

> Multi-week programs (training + nutrition) authored by a coach as reusable templates and assigned per-client. Extends the existing `ProgramTemplatesScreen` rather than replacing it.

## WHY

`src/screens/coach/ProgramTemplatesScreen.tsx` exists today as the authoring surface for *templates*. PR #92's `18-clone-starter-programs.md` covers cloning starter programs (AI-driven). This brief specifies the **manual authoring path** that has to exist underneath the cloning surface — the actual data shape, editor UX, and assignment hand-off — none of which is fully specified in PR #92. Without it, "clone a program" has nothing to clone *into* a coach-friendly editor; the next implementation PR would reach for a one-off shape and we'd own a fork between AI-generated programs and hand-authored ones.

## WHEN

- Phase 0 — flag `wave2_programs` defined, off everywhere; existing minimal `ProgramTemplatesScreen` continues to ship.
- Phase 1 — manual authoring of training programs (multi-week, per-week sessions, per-session blocks/sets/reps).
- Phase 2 — nutrition program authoring (target macros per phase, optional meal-plan link).
- Phase 3 — wire to brief 06 (`per-client-assignment`) so a program can be assigned with start date + per-client overrides.
- Phase 4 — wire to PR #92's `18-clone-starter-programs.md` so the AI clone path lands into the same editor.

## WHERE

- Extends `src/screens/coach/ProgramTemplatesScreen.tsx` — list, search, filter, archive.
- New screen: `src/screens/coach/ProgramEditorScreen.tsx` — top-level program editor (name, length, phases).
- New screen: `src/screens/coach/ProgramWeekEditorScreen.tsx` — per-week sessions.
- New screen: `src/screens/coach/ProgramSessionEditorScreen.tsx` — per-session blocks.
- New screen: `src/screens/coach/ProgramPreviewScreen.tsx` — read-only preview as the client will see it.

Client-side, the rendering is **the existing `WorkoutScreen` + `ActiveWorkoutScreen`** with extended data. No new client screens introduced by this brief alone — they come with brief 06's per-client-assignment.

## WHO

| Role | Can do |
| --- | --- |
| Coach (head, L2+) | Create, edit, archive, duplicate, share with team. |
| Junior coach (Team Mode) | View shared templates; edit only if granted `programs.author` capability. |
| Client | Sees the program **only** when assigned (brief 06); reads via existing `WorkoutScreen` / `ActiveWorkoutScreen`. |
| Anyone else | None. |

## WHAT

### Data model (mobile expectation)

```ts
type ProgramId = string;
type ProgramKind = 'training' | 'nutrition' | 'hybrid';

interface Program {
  id: ProgramId;
  coachId: string;
  name: string;                  // ≤80 chars
  summary: string | null;        // ≤300 chars
  kind: ProgramKind;
  durationWeeks: number;         // 1–52
  phases: ProgramPhase[];        // 1+; phases sum to durationWeeks
  archivedAt: string | null;
  publishedAt: string | null;    // null = draft
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ProgramPhase {
  id: string;
  index: number;            // 0-based
  name: string;             // "Phase 1 – Base", ≤40 chars
  weeks: number;            // 1–52
  weekTemplate: ProgramWeekTemplate;  // applied to each week in this phase unless overridden
  weekOverrides: Record<number /* week-in-phase */, ProgramWeekTemplate>;
}

interface ProgramWeekTemplate {
  sessions: ProgramSessionTemplate[];  // 0–7 (one per day; missing day = rest)
  nutritionTargets?: NutritionTargets; // when kind ∈ ('nutrition','hybrid')
}

interface ProgramSessionTemplate {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;   // 0=Mon for the app (matches existing WorkoutScreen)
  title: string;                          // "Lower A"
  notes: string | null;
  blocks: ProgramBlock[];
}

interface ProgramBlock {
  id: string;
  kind: 'straight' | 'superset' | 'circuit' | 'amrap' | 'emom';
  movements: ProgramMovement[];
  restSeconds: number | null;
}

interface ProgramMovement {
  id: string;
  exerciseRef: { exerciseId: string; name: string } | { customName: string };
  setsTarget: number;
  repScheme: { type: 'fixed'; reps: number } | { type: 'range'; min: number; max: number } | { type: 'rir'; reps: number; rir: number };
  loadGuidance?: { type: 'percent_1rm'; pct: number } | { type: 'rpe'; rpe: number } | { type: 'absolute'; load: number; unit: 'kg' | 'lb' };
  tempo?: string;            // "3-1-1-0"
  notes?: string;
}

interface NutritionTargets {
  caloriesKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  hydrationL: number | null;
}
```

### Authoring shape, plain prose

- A program has *phases*. Each phase has a default *week template*, optionally overridden per week-in-phase.
- A week has up to seven sessions, one per weekday. Missing days = rest.
- A session has *blocks* (straight set / superset / circuit / AMRAP / EMOM). Each block has movements with a *rep scheme* and optional *load guidance*.
- Nutrition targets are per-phase only in v1 (per-day variation lives in `mealPlansApi`, which is a separate object — not unified into Program in v1 to keep the editor scope contained).
- **No "Coming Soon" rows.** A field that the editor doesn't support yet is *not in the editor at all*.

## HOW

### Screens / navigation sketch

```
ProgramTemplatesScreen
  ├── List (filter: All · Drafts · Published · Archived; search by name)
  ├── + new program → ProgramEditorScreen (blank)
  └── Tap row → ProgramEditorScreen (edit)

ProgramEditorScreen
  ├── Header: name, kind, duration
  ├── Phases section
  │     ├── Drag-to-reorder (react-native-draggable-flatlist)
  │     ├── Tap a phase → ProgramWeekEditorScreen
  │     └── + new phase
  ├── Nutrition targets (when kind ∈ ('nutrition','hybrid'))
  ├── Preview action → ProgramPreviewScreen
  └── Footer: Save draft · Publish · Archive

ProgramWeekEditorScreen
  ├── Phase context: "Phase 1 – Base · Week 1 of 4"
  ├── 7 day rows (Mon–Sun); empty = rest
  └── Tap day → ProgramSessionEditorScreen

ProgramSessionEditorScreen
  ├── Title, notes
  ├── Blocks (drag-to-reorder)
  ├── + new block
  └── Per-block: kind selector, movements editor, rest seconds

ProgramPreviewScreen
  └── Read-only render in the same component the client will use (WorkoutScreen-style)
```

### API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/coach/programs` | List my programs (drafts + published). |
| `POST` | `/coach/programs` | Create. |
| `PATCH` | `/coach/programs/:id` | Edit. |
| `POST` | `/coach/programs/:id/publish` | Draft → published. |
| `POST` | `/coach/programs/:id/archive` | Archive. |
| `POST` | `/coach/programs/:id/duplicate` | Duplicate (returns new draft). |
| `GET` | `/exercises?q=` | Exercise lookup for the movement editor. |
| `GET` | `/me/programs/active` | Client side: program assigned to me (used by `WorkoutScreen`). |

Versioning: `X-Capability: programs`. The mobile build must understand both *unassigned* (template) and *assigned* (per-client instance) shapes — the latter lives in brief 06.

### Media upload UX

None in v1. v2 might add per-movement video links (mirroring brief 04 video rules). v1 movements are name + scheme only.

### Accessibility

- Drag-to-reorder lists provide keyboard / external-keyboard reorder buttons (long-press alternative) and announce moves via `AccessibilityInfo.announceForAccessibility`.
- Per-movement editor inputs (`setsTarget`, `repScheme`, `loadGuidance`) are numeric inputs with `keyboardType="number-pad"` and labelled `accessibilityLabel`s.
- Phase / week / session navigation supports back gestures and shows a breadcrumb in the header (so a screen-reader user knows which week of which phase they're editing).
- Default font scale to 1.6× must not clip the per-movement row.

### Loading / error / empty states

- **Loading list**: 4-row shimmer.
- **Empty (no programs)**: "Templates you build appear here." + "NEW PROGRAM" CTA.
- **Empty draft (new program)**: editor opens with one default phase ("Phase 1") and one empty week to anchor authoring.
- **Error**: human language + retry. Sentry tag `surface: 'wave2.programs'`.
- **Offline**: editor disabled with banner "You're offline. Resume editing when you reconnect." Drafts cached locally are *not* allowed in v1 — the risk of a phantom merge is too high; we intentionally lose offline authoring for now and will add it after the multi-coach (Team Mode) merge story is proven.
- **Validation errors**: surface inline at the field; prevent publish until resolved.

### Privacy / moderation

- Programs are **author-private until published**. A draft is never fetched by the client API.
- Published programs become visible only when **assigned** (brief 06) — there is no "browse the coach's library" surface for clients.
- Junior-coach access is governed by the head coach's Team Mode share decisions (backend PR #118).
- Programs do not contain client PII. They are template data; nothing here is PHI.
- Reporting is unnecessary at this layer (no client-authored content, no client-visible draft).

### Feature flags / entitlements

- `wave2_programs` (PostHog) — top-level. Default off.
- `programs.author` — entitlement, L2+ coaches.
- `programs.advanced_blocks` — flag-gates AMRAP / EMOM block kinds (kept off until coach UX feedback).
- `programs.nutrition` — flag-gates the Nutrition phase shape (separate flag from `wave2_programs` so it can lag training).

### Analytics events

| Event | Properties | Where |
| --- | --- | --- |
| `wave2_program_created` | `kind`, `duration_weeks`, `phase_count` | Editor save |
| `wave2_program_published` | `kind`, `duration_weeks` | Publish |
| `wave2_program_archived` | `was_assigned_count` | Archive |
| `wave2_program_duplicate` | (no body) | Duplicate |
| `wave2_program_block_added` | `kind` | Session editor |
| `wave2_program_publish_blocked` | `reason_code` | Validation block |
| `wave2_program_preview_open` | (no body) | Preview |

No exercise names, no client IDs.

### Rollout

1. Backend service shipped (programs CRUD + publish/archive/duplicate).
2. Flag on for internal test coach. Author one full 8-week training program end-to-end.
3. Flag on for pilot coach (no assignment yet — brief 06 is the next link).
4. Brief 06 ships → the program becomes useful to a client.
5. Brief 04 (`coach-content-boards`) `pinnedToAssignmentId` becomes coherent.
6. Rollback: flag off → editor row hidden in `ProgramTemplatesScreen`; existing simple shape continues to work.

### Tests

- **Unit**: validation — phases sum to `durationWeeks`; each week template has 0..7 sessions; rep schemes are bounded.
- **Unit**: serialisation — round-trip Program → JSON → Program is identity (no field loss).
- **Hook**: `useProgram(id)` and `usePrograms()` — Loading/Empty/Error/Data.
- **Component (RNTL)**: phase add/remove/reorder; per-session block reorder; movement edit.
- **Component**: publish-blocked path — surfaces inline errors.
- **Snapshot at scale=1.6×**: per-movement row.
- **Manual**: drag-to-reorder is reachable without the mouse / pinch (a11y).
- **Backend contract**: 404 → editor row hidden.

### Risks

| Risk | Mitigation |
| --- | --- |
| Editor scope creeps into per-day-variation nutrition. | v1 explicitly limits nutrition to phase-level; per-day stays in `mealPlansApi`. |
| Two coaches editing the same template (Team Mode). | v1 forbids: editor opens read-only if another session is active. Last-write-wins resolution is *not* attempted. |
| Long programs (52 weeks × 7 sessions × 8 movements) blow the editor on low-end Android. | List virtualisation (`FlashList`) on session / movement lists; lazy-load week templates. |
| Coach publishes an unfinished program. | Server-side validation duplicates client-side; publish-blocked code is surfaced human-readably. |
| AMRAP / EMOM rendering gets reused inconsistently between editor preview and `ActiveWorkoutScreen`. | Single shared renderer component; `ProgramPreviewScreen` and `ActiveWorkoutScreen` import the same component. Implementation PR enforces this. |
| Backwards-compat with existing simple `ProgramTemplate` rows on `main`. | Backend serves the new shape under a `?version=2` query param; old code paths see the legacy shape; migration plan in brief 06. |
| Drag-to-reorder a11y. | Long-press → reorder mode with explicit move-up / move-down buttons. |

### Dependencies

- Brief 06 (`per-client-assignment`) — what makes a published program useful.
- Brief 04 (`coach-content-boards`) — `pinnedToAssignmentId`.
- Brief 09 (`tier-gated-l2-l3`) — `programs.author` entitlement.
- PR #92 `docs/expansion/18-clone-starter-programs.md` — the AI-clone path that reuses this editor.
- PR #93 `docs/platform-readiness/05-reusable-expansion-ui-patterns.md` — `EditorialList`, `Stepper`, `Numeric` primitives.
- `react-native-draggable-flatlist`, `@shopify/flash-list` — implementation PR adds these.
- Backend programs service.

### Acceptance criteria

- A coach can create, save, publish, duplicate, and archive a multi-phase, multi-week program.
- A draft cannot be assigned (brief 06 enforces).
- Validation errors surface inline; the publish action is disabled until errors clear.
- The Preview screen renders identically to the eventual client view.
- A 12-week program with 5 sessions per week scrolls smoothly on a Pixel 5 / iPhone 12.
- Sentry shows zero `surface: 'wave2.programs'` errors in a 7-day pilot.

### Operator handoff

- **Owning surface**: coach lead. Backend = backend lead.
- **Out-of-band steps**: backend programs service; PostHog flags; `programs.author` entitlement metadata; Team Mode (backend PR #118) shipped before junior-coach editing is enabled.
- **"Done" means**: pilot coach authors and assigns one 8-week program (after brief 06 ships); a pilot client completes 4 weeks of it from the existing `WorkoutScreen`; zero unhandled Sentry errors; at least 80% of authored sessions have non-empty notes (a quality signal).
