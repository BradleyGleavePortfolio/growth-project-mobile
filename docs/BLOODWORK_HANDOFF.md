# Bloodwork / Labs Review — Mobile Scaffold (handoff)

**Status:** scaffolded on mobile, feature flag **OFF by default**, no backend wiring.
**Scope (v1):** clients **manually enter** lab results. Coach reviews. AI may
draft *educational* context, but only after a coach explicitly approves it
does it surface to the client. **Not medical advice. Not a diagnosis. Not a
clinician replacement.**

This document is the handoff for the backend / platform team. Nothing in this
list ships in the current PR — the PR is the typed-contract + UX shell only.

---

## What is in the PR

| Path | Purpose |
| --- | --- |
| `src/types/bloodwork.ts` | Typed contracts: panel, marker, source type (defaults to `manual`), reference range, validation status, freshness, review state, AI draft, disclaimer level. |
| `src/lib/bloodworkSignoff.ts` | Pure visibility / state-transition rules. AI insights only render when `coach_reviewed` AND `aiDraft.status === 'approved'`. |
| `src/constants/bloodworkCopy.ts` | All user-facing copy. Forbidden-claim list + required disclaimer phrases. |
| `src/config/featureFlags.ts` | `isFeatureEnabled('bloodwork')`. OFF unless `EXPO_PUBLIC_FEATURE_BLOODWORK=true`. |
| `src/screens/client/BloodworkEntryScreen.tsx` | Client-facing manual-entry form. Honest empty state. Disclaimer pinned at top. Submit handler is a stub. |
| `src/screens/coach/BloodworkReviewQueueScreen.tsx` | Coach review queue scaffold. Empty state copy. Action buttons are stubs that call `canTransition`. |
| `src/__tests__/bloodworkCopy.test.ts` | Forbidden-claims test for UI copy + required disclaimer phrases. |
| `src/__tests__/bloodworkSignoff.test.ts` | Visibility + transition rule tests. |
| `src/__tests__/bloodworkFeatureFlag.test.ts` | Pins flag-OFF-by-default. |
| Navigator wiring | `Bloodwork` route on the client `MoreStack`; `BloodworkReviewQueue` route on the coach `ClientsStack`. **Not linked from any UI** — coaches/clients can only reach it programmatically. The flag flip + a single entry-point row is a follow-up PR. |

## What is intentionally **not** in v1

These are non-goals for the first release. They are documented here so future
work has a known landing place but **must not be enabled by default**.

- **Photo / PDF attachment upload of lab printouts.** Type contract has an
  `attachmentPlaceholderId` slot. v1 stores nothing. A future PR can add a
  signed-upload endpoint behind a separate flag and a privacy review.
- **OCR of lab printouts.** Out of scope for v1. If added, run on the
  *coach* side, not the client side; output should populate the same
  `BloodworkPanel` contract and require coach signoff like manual entry.
- **EHR / lab-provider import (Apple Health, Quest, LabCorp, etc.).** Out
  of scope. Will require provider-specific consent capture, dedicated audit
  trail, and a `BloodworkSourceType` other than `manual`.
- **Clinician-entered records.** Out of scope until verified-clinician
  identity is in the auth model.
- **Diagnostic interpretation, urgent triage, prescriptive advice,
  dosing guidance.** Forbidden by copy + tests. Do not add.

---

## Backend contract the mobile scaffold expects

The shapes are in `src/types/bloodwork.ts`. The mobile screens will hit:

```
POST /labs/panels                  — submit a manual-entry draft
GET  /labs/panels?clientId=…       — list panels for a client
GET  /labs/panels/:id              — single panel with all markers
POST /labs/panels/:id/transition   — coach moves through review states
POST /labs/panels/:id/ai-draft     — coach approves / rejects AI draft
GET  /coach/labs/review-queue      — coach review queue list
```

### Server-side requirements (must, before flag flips on)

1. **Encryption at rest.** Bloodwork is sensitive PHI-adjacent data. Encrypt
   columns at rest (or use a dedicated encrypted table).
2. **Audit log.** Every read AND write must be logged with `actor_id`,
   `panel_id`, `action`, `timestamp`. Reads, not just writes — coaches
   reading their clients' values is itself an auditable event.
3. **Tenant scoping.** A panel is visible to (a) the client who owns it
   and (b) the coach assigned to that client. Anyone else (including other
   coaches in the same org) gets 404, not 403.
4. **Server-side validation.**
   - reject panels with no markers
   - reject markers with neither numeric `value` nor textual `valueText`
   - clamp implausible numeric values and surface as `value_implausible`,
     do not silently drop
   - on `unit` mismatch with the reference range, set
     `validationStatus: 'unit_mismatch'` rather than rejecting the row
5. **Consent capture.** Before a client's first panel is created, the
   server must record an explicit consent acknowledgement
   (`consent_version`, `accepted_at`). The mobile flag check is not enough.
6. **State-transition gate.** Mirror `canTransition` from
   `src/lib/bloodworkSignoff.ts`. Server must reject illegal transitions
   even if the client tries to bypass the UI.
7. **AI draft pipeline.** Drafts MUST start in `unapproved`. Only a coach
   may move them to `approved` or `rejected`. The client API must never
   return draft text from a non-approved AI draft.
8. **Soft-delete + retention.** Panels should soft-delete on user
   deletion request, with a privacy-policy-aligned retention window.
9. **Clinician-escalation language.** The "Refer to clinician" coach
   action emits an in-app message and notification using copy approved
   by legal. Do not let coaches free-text into that surface — keep the
   message templated from `BLOODWORK_CLINICIAN_REFERRAL_NOTE`.

### Server-side requirements (should, can land in iterations)

- Plausibility window per common marker (the textbook ranges, broad).
- Unit-conversion helper (mg/dL ⇄ mmol/L, ng/mL ⇄ nmol/L) on the server.
- Backfill `code` (LOINC-shaped) from `name` over time.

---

## Flipping the flag on

Once the backend is live and the legal review on `BLOODWORK_DISCLAIMER_LONG`
+ the clinician-referral copy is signed off:

1. Add a row entry on `MoreScreen` (client) that navigates to `Bloodwork`.
2. Add an entry on the coach `Dashboard` (or `Settings`) that navigates to
   `BloodworkReviewQueue`.
3. Set `EXPO_PUBLIC_FEATURE_BLOODWORK=true` in the relevant EAS environment.
4. Add an analytics event on first open + first submit (PII-stripped).
5. Re-run the forbidden-claims test against any new copy strings the coach
   side adds.

## Testing notes

- `npm test -- bloodwork` runs all three test files in this PR.
- `npm run typecheck` should be clean.
- `npm run lint` should be clean (or, at minimum, no new warnings against
  the bloodwork files).

## Open questions for product / legal

- Final wording of the long-form disclaimer (currently ours is conservative).
- Whether v1 should ship to all clients, only paid tier, or as an opt-in
  toggle inside Preferences.
- Whether coach-rejected AI drafts are ever shown back to the coach for
  audit (yes/no — currently the type permits it; the screen does not).
