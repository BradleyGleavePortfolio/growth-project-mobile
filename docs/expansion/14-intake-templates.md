# 14 — Intake templates in invite/onboarding flow

**Status:** Pre-build
**Last reviewed:** 2026-04-30
**Surface:** Coach app (authoring) + Onboarding (consumption)
**Owner:** Mobile (split — coach team authors, onboarding team consumes)

## WHY

The 10-step onboarding quiz is one-size-fits-all. Coaches with a niche
(injury rehab, postpartum, performance) waste the first session asking
the same custom questions every new client. An intake template — owned
by the coach, applied at invite time, executed during onboarding —
captures those answers up front, so when the client opens the app on
day 1 the coach already has the picture.

Intake templates also share a substrate with weekly check-in templates
(#05): same question primitives, different lifecycle. Building both well
once is cheaper than two parallel systems.

## WHEN to build

After the invite flow stabilises (it has been live for several
releases) and after #05's question primitives exist. Specifically:

- #05 ships first → primitives exist (`Question`, renderer, validators).
- #14 reuses those primitives in two new contexts: a coach authoring
  surface and an extra step in onboarding.

If #05 is still in flight, do not start #14 — the question primitives
are the integration point.

## WHERE in the repo

- New coach screens:
  - `src/screens/coach/IntakeTemplatesScreen.tsx` — list of templates
    the coach has authored.
  - `src/screens/coach/IntakeTemplateEditorScreen.tsx` — author / edit a
    template.
- Onboarding integration:
  - New step component in `src/screens/onboarding/`: `IntakeStep.tsx`,
    inserted between the existing quiz and the post-quiz handoff when
    the invite carries an `intake_template_id`.
- Invite flow:
  - `InviteCodesScreen.tsx` gains an "Intake template" picker per code
    (optional). The link / share copy do not change shape — the
    backend resolves the bound template at redemption time.
- API: `coachApi.listIntakeTemplates`, `getIntakeTemplate`,
  `createIntakeTemplate`, `updateIntakeTemplate`,
  `deleteIntakeTemplate`. Onboarding gets
  `clientApi.getMyIntakeTemplate()` returning whichever template was
  bound to the invite.

## WHO owns and uses it

- **Builder:** Coach team (authoring surfaces) + onboarding team
  (consumption step). Coordinate so the question renderer is the same
  component on both sides.
- **Author:** Coach.
- **Respondent:** Client (once, during onboarding).
- **Consumer of answers:** Coach (visible on `ClientDetailScreen` as a
  new "Intake" section).

## WHAT MVP includes

- **Authoring:** create up to 3 templates per coach in v1; each
  template is a list of questions (max 15) using the same primitives
  as #05. Rename, duplicate, delete supported.
- **Binding:** when generating an invite code (`InviteCodesScreen`), an
  optional dropdown picks which template the recipient will run. Codes
  without a binding behave exactly as today.
- **Onboarding:** if the redeemed invite carried a binding, an extra
  step renders the template after the standard quiz. Submit posts the
  answers; the step is skippable only if the coach marked it optional
  in the editor.
- **Coach view of answers:** new section on `ClientDetailScreen`
  showing the most recent intake answers, read-only.

### Out of scope for v1

- Conditional / branching questions (defer; single-flow is enough for
  most templates).
- File-upload questions.
- Versioning / history of edits to a template.
- Multi-language templates.

## HOW to implement safely

1. Reuse #05's question primitives. Do not fork. If a primitive needs
   to be more general, generalise it once and update both consumers.
2. Author once, render twice — the renderer used in
   `IntakeTemplateEditorScreen`'s preview must be the same component
   the onboarding step uses, so a coach previewing sees exactly what
   the client will see.
3. Validate template at save time on the device (max 15 questions,
   non-empty title) and again on the server. Server is the source of
   truth; mobile validation is courtesy.
4. The invite-binding picker on `InviteCodesScreen` defaults to "None"
   — the existing flow is unchanged for existing coaches.
5. Onboarding looks up the bound template on entry; if the binding is
   stale (template deleted between invite generation and redemption),
   the step is skipped and the coach is notified server-side. The
   client never sees an error screen.
6. Coach view of answers is read-only for v1. No editing; no
   "regenerate intake" flow.

## Screens / navigation sketch

```
Coach side
─────────
SettingsScreen / Templates tab
  └─ "Intake templates"  ──► IntakeTemplatesScreen
                              ├─ List + "New template"
                              └─ Tap row  ──► IntakeTemplateEditorScreen
                                              (questions, optional flag, preview)

InviteCodesScreen
  └─ Create-code form: + "Intake template" picker (optional, default None)

ClientDetailScreen
  └─ New "Intake answers" section (read-only)

Onboarding side
───────────────
Existing 10-step quiz
  └─ if invite has intake_template_id  ──► IntakeStep (renders template)
       └─ submit  ──► proceed to handoff
  └─ otherwise: proceed straight to handoff (no change)
```

## API contract dependency

- `GET /coach/intake-templates` → `IntakeTemplate[]`
- `GET /coach/intake-templates/:id` → `IntakeTemplate`
- `POST /coach/intake-templates` body `IntakeTemplate` → `IntakeTemplate`
- `PUT /coach/intake-templates/:id` body `IntakeTemplate` → `IntakeTemplate`
- `DELETE /coach/intake-templates/:id` → `204`
- `POST /invites` body now accepts optional `intake_template_id` (existing
  endpoint extended).
- `GET /clients/me/intake-template` → `IntakeTemplate | null` (returns
  the bound template at redemption time; `null` when none).
- `POST /clients/me/intake-answers` body `{ template_id, answers }` →
  `IntakeAnswerSet`.
- `GET /coach/clients/:id/intake-answers/latest` → `IntakeAnswerSet | null`
  (powers the coach detail section).

## Feature flag / rollout

- Flag: `features.intakeTemplates`. When off:
  - `IntakeTemplatesScreen` and editor are not registered.
  - The picker on `InviteCodesScreen` is hidden.
  - Onboarding never queries the bound template (skips the lookup
    entirely).
  - The "Intake answers" section on `ClientDetailScreen` is hidden.
- Roll out coach-side first; only flip onboarding-side once at least
  one coach has authored a template and we've reviewed it manually.
- Kill switch is safe at any time — the redemption path falls back to
  the existing 10-step flow.

## Testing plan

- Unit: template validation (length caps, required fields).
- Unit: invite redemption with stale binding → graceful skip.
- Component: editor, picker, onboarding step, coach view section.
- Integration: author → bind to invite → redeem → answers visible on
  coach side.
- Manual: end-to-end with two real accounts and a fresh device.

## Risks

- **Two surfaces, one renderer.** If the editor preview drifts from the
  onboarding step renderer, coaches will ship templates that look
  different to clients than they intended. Pin them to the same
  component and write a snapshot test.
- **Stale bindings.** A coach edits or deletes a template mid-redeem.
  Handle with a server-side fallback to the canonical template (or
  skip), never an error screen for the client.
- **Question fatigue.** 15-question intakes feel like work. The cap is
  a feature; document it so a future operator doesn't quietly raise
  it.

## Dependencies

- #05 question primitives.
- Backend tables, endpoints, redemption-time binding.

## Acceptance criteria

- [ ] Flag off → no UI, no extra calls in onboarding, existing
      invite/onboarding behaviour unchanged.
- [ ] Flag on → coach can author, bind, see answers; client runs the
      bound step during onboarding.
- [ ] Stale binding at redeem time skips gracefully; no error screen.
- [ ] Editor preview matches onboarding render exactly (snapshot
      tested).
- [ ] No hardcoded hex; theme tokens only.
- [ ] READMEs updated under `src/screens/coach/`,
      `src/screens/onboarding/`.
