# 18 — Clone starter programs (mobile coach)

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app
**Owner:** Mobile (coach-side)
**Cross-repo:** Backend draft PR **#117 (AI Program Builder)** — provides the
generation / cloning endpoint and rewriting logic.

## WHY

Coaches new to the platform stare at an empty `ProgramTemplatesScreen`.
A library of starter programs they can *clone into their own templates
list* — optionally rewritten in their voice (#11) — collapses the
zero-to-one friction. Cloning is local to their own template namespace
so they can edit freely without affecting the canonical starter.

This is also the most visible payoff of the AI program-builder work:
"the model wrote you a program; tweak it and ship it."

## WHEN to build

After:
- `ProgramTemplatesScreen.tsx` is stable (it is, today).
- Backend PR #117 is shipped and the cloning endpoint is live.
- #11 (voice/tone) is ideally available so cloned programs can adopt
  the coach's voice; it is not strictly required — without it, clones
  use the canonical text verbatim.

## WHERE in the repo

- New screen: `src/screens/coach/StarterProgramsScreen.tsx` — browsable
  catalog of starter programs.
- Entry: button on existing `ProgramTemplatesScreen.tsx` ("Browse
  starter programs").
- Existing screen reused on tap: a starter detail view → "Clone into
  my templates" CTA. Implement as a modal or new route
  `StarterProgramDetailScreen.tsx`.
- API additions in `src/services/api.ts`:
  `coachApi.listStarterPrograms`, `getStarterProgram`,
  `cloneStarterProgram(id, options)`.
- Type: `src/types/starterProgram.ts`.

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Primary user:** Coach.
- **Secondary user:** Clients indirectly receive the cloned program
  via existing assignment flows; no client-side change.

## WHAT MVP includes

- Browseable list of starter programs (name, summary, duration, level
  tag). Server-paged.
- Detail screen with the program's outline (weeks → days → workouts
  / meals at a high level). Read-only.
- "Clone into my templates" CTA with two options:
  - *Use original wording* (default).
  - *Rewrite in my voice* (visible only when #11 is enabled and a
    voice is configured; otherwise greyed with helper text).
- On confirm, backend clones the program into the coach's namespace
  and returns the new template's id; mobile navigates to the
  existing edit screen for that template.

### Out of scope for v1

- Cloning between coaches' personal templates (only canonical
  starters).
- Versioning / "update from canonical" merge flows.
- Bulk-clone multiple programs at once.
- Preview of the rewritten text before cloning (defer; not worth the
  extra round-trip in v1).

## HOW to implement safely

1. **Cloning is server-side.** Mobile sends `id` and `options`,
   receives the new template id. Do not duplicate the program payload
   on the device.
2. **Idempotency.** A double-tap on "Clone" must not create two
   templates. Use the standard idempotency-key header pattern
   already established in the API client (or a debounced button if
   the backend doesn't expose that).
3. **The rewrite option is gated.** Visibility logic:
   - Hide entirely if `features.coachAIVoiceTone` is off (the user
     has never seen the voice setting; revealing it here is
     confusing).
   - Show greyed if the flag is on but no voice is configured;
     helper text "Set your AI voice in Settings to enable".
   - Show enabled only when a voice is configured.
4. **Loading on clone is determinate-feel.** Server-side rewriting
   may take 5–15 s. Show a skeleton on the destination edit screen,
   not a blocking modal.
5. **Error state on clone is honest.** Failure means "couldn't clone
   right now — try again" — not a silent abort. The user thought
   they made a template; they didn't.

## Screens / navigation sketch

```
ProgramTemplatesScreen
  └─ "Browse starter programs" button  ──► StarterProgramsScreen
                                            ├─ List (paged)
                                            └─ Tap row  ──► StarterProgramDetailScreen
                                                            ├─ Read-only outline
                                                            └─ "Clone into my templates"
                                                                ├─ Use original wording
                                                                └─ Rewrite in my voice (gated)

After clone success
  └─ navigate to existing program-template edit screen for the new id
```

## API contract dependency

- `GET /coach/starter-programs?page=&limit=` → paged
  `StarterProgramSummary[]`.
- `GET /coach/starter-programs/:id` → `StarterProgram`.
- `POST /coach/starter-programs/:id/clone` body
  `{ rewrite_with_voice: boolean }` → `{ template_id: string }`.
- The clone endpoint reuses the LLM gateway from PR #117 when
  `rewrite_with_voice` is true; otherwise it's a pure copy.

## Feature flag / rollout

- Flag: `features.starterPrograms`.
- Roll out without rewrite first (rewrite gated by #11's flag and
  the configured-voice condition above).
- Kill switch hides the entry button on `ProgramTemplatesScreen` and
  the detail/list screens.

## Testing plan

- Unit: rewrite-option visibility logic (3 states).
- Component: list pagination, detail render, clone confirm.
- Integration: clone → land on edit screen with the new id, confirm
  the template appears in the coach's `ProgramTemplatesScreen` list.
- Manual: rewrite enabled → confirm the cloned text differs from the
  canonical and reflects the configured voice.

## Risks

- **Rewrite quality.** A bad rewrite is worse than the canonical
  text. The 1:1 copy default is the safety net.
- **Catalog freshness.** Starter programs are server-curated. Mobile
  is read-only. Document that a new starter only requires a server
  push, not a mobile release.
- **Edit screen capacity.** The existing edit screen must handle the
  full size of a starter program. Verify before flag-on; if not,
  ship behind a separate "view-only" mode for cloned starters first.

## Dependencies

- Backend PR #117 — cloning + LLM rewrite.
- #11 for the rewrite path; not blocking the basic clone.
- Existing `ProgramTemplatesScreen` and edit flow.

## Acceptance criteria

- [ ] Flag off → no entry button on `ProgramTemplatesScreen`.
- [ ] Flag on → catalog browseable, detail readable, clone creates
      a new template owned by the coach.
- [ ] Rewrite option follows visibility rules across the three
      states.
- [ ] Double-tap on Clone produces one template, not two.
- [ ] No hardcoded hex; theme tokens only.
- [ ] `src/screens/coach/README.md` updated.
