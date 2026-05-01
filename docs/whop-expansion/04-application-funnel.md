# 04 — Application funnel — high-ticket gating

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app (apply) + coach app (review)
**Owner:** Mobile client team (apply path) + mobile coach team
(review path)

## WHY

High-ticket coaching offers don't sell in a single tap; they sell
through a qualifying conversation. Today that conversation is in DMs
or off-platform, with no audit trail, no deposit hold, and no way to
route a lead to a junior coach. The application funnel is the
in-app version: a buyer applies, optionally pays a refundable
deposit hold, the coach reviews, and on approval the deposit is
captured (or refunded on rejection) and the entitlement is granted.

The funnel is also the only honest way to ship a "limited cohort"
program — capacity-constrained offers without an application step
end up oversold or arbitrary.

## WHEN to build

After:
- `docs/expansion/14` intake templates ships (the form schema is
  reused).
- [02-offer-builder](./02-offer-builder.md) supports the
  `application` offer kind.
- [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md)
  supports the `applicationHold` typed action.
- Backend #123 (application/funnel service) exposes the state
  machine and review queue endpoints.

## WHERE in the repo

- New screens (client):
  - `src/screens/client/ApplicationScreen.tsx` — render the
    application form for an offer.
  - `src/screens/client/ApplicationStatusScreen.tsx` — the buyer's
    view of their submitted application (pending, approved,
    rejected, withdrawn).
- New screens (coach):
  - `src/screens/coach/applications/ApplicationsListScreen.tsx` —
    queue of incoming applications, filterable by offer.
  - `src/screens/coach/applications/ApplicationDetailScreen.tsx` —
    review one application, take an action.
- API: `src/services/api.ts` — `clientApi.startApplication`,
  `submitApplication`, `withdrawApplication`,
  `getMyApplications`, `coachApi.listApplications`,
  `getApplication`, `approveApplication`, `rejectApplication`.
- Type: `src/types/application.ts`. Reuses `IntakeFormSchema` from
  `docs/expansion/14`.

## WHO owns and uses it

- **Builder:** Mobile client team for the apply path; mobile coach
  team for the review path. The two halves share the
  `Application` type and React Query keys.
- **Author of form schema:** Coach (via the intake templates
  surface).
- **Audience (apply):** Prospective clients applying to a paid
  high-ticket offer.
- **Audience (review):** Coach (or the senior_coach role in Team
  Mode; junior_coach can read but not approve/reject by default —
  configurable per coach in the team-mode work).

## WHAT MVP includes

### Buyer side

- **ApplicationScreen** — renders the offer's
  `IntakeFormSchema`. Mixed input types (short text, long text,
  single-select, multi-select, scale 1–10, date, file upload —
  defer file upload if the existing intake-template work
  defers it). Required-field validation client-side; the backend
  is the source of truth.
- **Deposit step** — if the offer carries a deposit, the submit
  flow routes through `startCheckout({ offerId, kind:
  applicationHold })`. The hold is placed on submit; capture
  happens on coach approval; refund happens on coach rejection
  or buyer withdrawal before approval.
- **ApplicationStatusScreen** — accessible from a "Your
  applications" row on Profile. Shows status timeline, a
  "Withdraw" CTA while pending, and a deep-link to the relevant
  entitlement on approval.

### Coach side

- **ApplicationsListScreen** — sectioned list (New, In review,
  Approved, Rejected, Withdrawn). Filter by offer. Counts in
  section headers.
- **ApplicationDetailScreen** — buyer name + photo (per
  `docs/expansion-wave-2/03`), submitted answers rendered in form
  order, deposit status (held / captured / refunded), action
  buttons (Approve, Reject, Need more info).
- **Need more info** — sends an in-app message to the buyer
  through the existing messaging surface; no extra schema
  required, just routes to compose with a prefilled context.

### Out of scope for v1

- Bulk approve / bulk reject.
- Application templates inside the funnel (the form lives in
  intake templates).
- Multi-coach review (only the assigned reviewer can act in v1).
- Application analytics beyond raw counts.
- Auto-reject rules / scoring.
- Public "applications closed" landing page (handled by offer
  status `paused`).

## HOW to implement safely

1. **One state machine, one source of truth.** States: `submitted
   → in_review → approved` or `rejected` or `withdrawn`. Mobile
   reads `status`; mobile never *infers* the state from other
   fields. Server-side enforces transitions.
2. **Deposit capture is a server event.** Mobile never calls
   "capture" — it calls `approveApplication`, which the server
   translates into a capture against the held PaymentIntent.
   Same for refund on reject.
3. **Withdraw race.** A buyer can withdraw a pending application;
   if the coach has already approved in the same second, the
   server resolves to "approved, deposit captured, withdrawal
   refused". Mobile renders the resolved state from the response,
   does not local-state-merge.
4. **Idempotent actions.** Approve/reject are idempotent on the
   application id — re-tapping the action returns the same
   resolved state.
5. **Form rendering reuses the intake-templates renderer.** Do
   not invent a second form rendering library.

## Screens / navigation sketch

```
Buyer
─────
StorefrontScreen / OfferDetailScreen (kind: application)
  └─ "Apply to join"  ──► ApplicationScreen
                              ├─ Form fields
                              └─ Submit  ──► (optional deposit hold)
                                                └─ ApplicationStatusScreen.pending

Profile → "Your applications"  ──► ApplicationStatusScreen list
                                       └─ tap  ──► ApplicationStatusScreen.detail

Coach
─────
Coach Home / Dashboard tile "Applications"  ──► ApplicationsListScreen
                                                     ├─ New / In review / Approved / Rejected / Withdrawn
                                                     └─ tap row  ──► ApplicationDetailScreen
                                                                        ├─ Approve  → capture deposit, grant entitlement
                                                                        ├─ Reject  → refund deposit, notify
                                                                        └─ Need more info  → DM the applicant
```

## API contract dependency

- `POST /me/applications` body `{ offerId, answers, idempotencyKey }`
  → `Application` (and starts a `applicationHold` payment session
  if the offer requires one — returned in the response).
- `GET /me/applications` → `Application[]` (the buyer's own).
- `GET /me/applications/:id` → `Application`.
- `POST /me/applications/:id/withdraw` → `Application`.
- `GET /coach/applications` → `Application[]` (filterable by
  `offerId`, `status`).
- `GET /coach/applications/:id` → `Application`.
- `POST /coach/applications/:id/approve` → `Application`.
- `POST /coach/applications/:id/reject` body `{ reason?: string }`
  → `Application`.

`Application` (mobile's target consumption contract):

```ts
type Application = {
  id: string;
  offerId: string;
  buyerId: string;
  buyerName: string;
  buyerPhotoUrl: string | null;
  status: 'submitted' | 'in_review' | 'approved' | 'rejected' |
          'withdrawn';
  submittedAt: string;        // ISO
  resolvedAt: string | null;
  answers: AnswerByFieldId;   // shape from IntakeFormSchema
  deposit:
    | { kind: 'none' }
    | { kind: 'held'; amountMinor: number; currency: string }
    | { kind: 'captured'; amountMinor: number; currency: string;
        capturedAt: string }
    | { kind: 'refunded'; amountMinor: number; currency: string;
        refundedAt: string };
  rejectReason: string | null;
};
```

## Stripe / TGP-balance abstraction from the user's perspective

A buyer applying to a high-ticket offer sees: "Apply to join. A
$<deposit> hold will be placed on your payment method until your
coach reviews. The hold is released if you're not accepted." They
do not see the word "Stripe", "PaymentIntent", or "capture". The
hold flows through the same checkout module ([03](./03-checkout-deposits-subscriptions.md))
as any other payment.

Approval → the buyer receives a "You're in" notification + the
captured-deposit receipt + an entitlement that opens the offer's
primary surface.

Rejection → the buyer receives a polite "Not at this time"
notification + the refund confirmation. The reject reason is
optional and never shown to the buyer unless the coach explicitly
chose to share it (a v1.1 toggle, deferred).

## Loading / error / empty states

- **Apply form loading:** skeleton fields based on `IntakeFormSchema`.
- **Submit failure:**
  - Validation: inline.
  - Deposit hold failure: routed through
    [03](./03-checkout-deposits-subscriptions.md) typed reason.
  - Network: keep answers cached locally, allow retry.
- **Empty (buyer no applications):** "You haven't applied to
  anything yet." with a link to the marketplace.
- **Empty (coach no applications):** "No applications yet — your
  application offers will appear here when buyers apply."
- **Coach action failure:** keep the screen mounted; surface a
  toast with the typed reason.

## Accessibility

- Form fields render with proper labels (no placeholder-as-label).
- Status timeline uses both a coloured dot and a textual state
  label.
- Approve/reject buttons trap focus into a confirm before
  capture/refund.
- Buyer's masked photo respects the "no avatar" path from
  `docs/expansion-wave-2/03`.

## Analytics

- `application_started` — `{ offerId, hasDeposit: bool }`
- `application_submitted` — `{ applicationId, offerId,
  depositKind: 'none' | 'held' }`
- `application_withdrawn` — `{ applicationId }`
- `coach_application_viewed` — `{ applicationId, offerId }`
- `coach_application_decided` — `{ applicationId, decision:
  'approved' | 'rejected' }`
- `coach_application_needs_more_info` — `{ applicationId }`

No PII (no answer text, no names) in event properties.

## Feature flags / entitlements

- Flag: `features.applicationFunnel`. Off by default. When off, the
  `application` offer kind is hidden in the builder
  ([02](./02-offer-builder.md)) and unbuyable in storefront /
  marketplace.
- Entitlement (coach side): `entitlements.application_funnel`.
  Pro/Studio tier only.
- Team Mode: `roles.review_applications` controls who can
  approve/reject.

## Privacy / moderation

- Application answers are private between buyer and coach (and
  team-mode reviewers). Server-side ACL enforces; mobile does not
  cache them long-term.
- Withdrawn applications are visible to the coach as
  "Withdrawn", with answers still readable for audit; if the
  buyer requests data deletion (existing user-deletion flow), the
  application body is replaced with a tombstone.
- Reject reason is private unless the coach opts to share.

## Rollout

1. Internal — one offer, one coach, deposit-free.
2. Add deposit-held variant; verify capture/refund paths in
   staging.
3. Flip on for the 5–10 coach ring after [03](./03-checkout-deposits-subscriptions.md)
   GA.
4. GA after team-mode role enforcement is verified on the
   review side.

## Tests

- Unit: state-machine helpers — every transition allowed/refused.
- Unit: deposit kind discriminator render mapping.
- Component: ApplicationScreen renders `IntakeFormSchema` for a
  variety of field combinations; submit blocks on missing
  required.
- Component: ApplicationsListScreen sectioning + counts.
- Integration: apply → coach approves → buyer entitlement
  appears; apply → coach rejects → buyer refund landed.
- Manual: withdraw race (buyer withdraws as coach approves);
  network drop mid-submit; deep-link from "Need more info" DM.

## Risks

- **Deposit-hold expiry.** Stripe holds expire after a finite
  window. The coach must be reminded to act before expiry; a
  server-driven reminder + a mobile toast on the coach
  application detail (e.g. "Hold expires in 2 days") covers it.
- **Reviewer drift in Team Mode.** A junior coach who can read
  but not act gets a clear disabled state on Approve/Reject —
  do not silently allow taps that 403.
- **Form complexity.** A 30-field form is a UX failure; coach
  authors will try it. The intake-templates work caps fields to
  a sensible max; the funnel inherits that cap.
- **GDPR right to erasure.** Coordinate the tombstone behaviour
  with backend privacy work; do not leak buyer answers in the
  coach's CSV export (out of scope v1, but the export is on the
  roadmap).

## Dependencies

- `docs/expansion/14` intake templates (form schema + renderer).
- `docs/expansion/16` public coach profile + slug.
- `docs/expansion/20` team mode (reviewer role enforcement).
- Backend #123 application/funnel service.
- [02-offer-builder](./02-offer-builder.md) for `application`
  kind authoring.
- [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md)
  for the deposit hold.

## Acceptance criteria

- [ ] Flag off → application kind unbuyable; no apply CTA visible.
- [ ] Flag on → buyer can apply, optionally place a hold, and
      see status updates.
- [ ] Coach can approve / reject / need-more-info; entitlement
      and deposit move correctly server-side.
- [ ] Withdraw mid-review resolves to a single canonical state
      from the server.
- [ ] Junior-coach role cannot approve/reject in Team Mode; the
      buttons render disabled with an explainer.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The first reject of a paying applicant is a sensitive UX event
  — review the buyer-facing notification copy with support
  before flipping the flag.
- The "Need more info" DM should NOT auto-prefill the answer
  body; the coach should write a targeted question. Prefilling
  the body invites copy-paste laziness.
- Watch the median time-from-submit-to-decision; if it climbs
  above 5 days, the deposit-hold expiry risk goes up. The
  reminder cadence is server-side; coordinate with the team
  that owns notifications.
