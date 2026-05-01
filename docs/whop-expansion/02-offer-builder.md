# 02 — Offer Builder — coach-side product authoring

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Coach app
**Owner:** Mobile coach team

## WHY

The storefront ([01](./01-coach-storefront.md)) is a render of
`Offer` rows. The Offer Builder is where those rows are created and
edited. Without a coach-side authoring surface, every storefront is
seeded by ops, every price change is a backend ticket, and the
"one-stop-shop" promise collapses. The builder is also the only
surface that decides which existing primitives (programs, spaces,
events, application forms) compose into a sellable bundle.

## WHEN to build

- After backend #119 (payments engine) exposes "create offer" with
  at least one offer kind end-to-end.
- After `docs/expansion/18` (clone starter programs) ships, so the
  builder can reference an existing program by id rather than
  invent an inline-program shape.
- In parallel with [01](./01-coach-storefront.md), but the
  storefront should be the first surface verified end-to-end with
  a hand-seeded offer; the builder lands once the read path is
  proven.

## WHERE in the repo

- New screen group: `src/screens/coach/offers/`
  - `OfferListScreen.tsx` — list of this coach's offers.
  - `OfferEditorScreen.tsx` — create / edit a single offer.
  - `OfferKindPickerScreen.tsx` — first step of "new offer".
  - `OfferPricePickerScreen.tsx` — price shape (one-time /
    subscription / deposit / free / application).
  - `OfferContentPickerScreen.tsx` — pick programs / spaces /
    events to bundle.
- Entry: new row "Offers" in `SettingsScreen` (or a new tab on the
  coach Dashboard — final placement is a doctrine call, not a
  builder call; see HOW).
- API: `src/services/api.ts` — `coachApi.listOffers`,
  `getOffer`, `createOffer`, `updateOffer`, `pauseOffer`,
  `unpublishOffer`. No delete — pause + archive only, to preserve
  audit trail for paid offers.
- Type: `src/types/storefront.ts` (shared with 01). Reuse the
  `Offer` shape; add a `DraftOffer` companion type for create-flow
  state.

## WHO owns and uses it

- **Builder:** Mobile coach team.
- **Author:** Coach. In Team Mode (`docs/expansion/20`), only the
  *owner* role authors offers; *junior coach* role can view and
  share. Enforce server-side; mobile renders the row read-only for
  unprivileged roles.
- **Audience:** Other coaches do not see this surface. Clients do
  not see this surface.

## WHAT MVP includes

- **OfferListScreen** — list of offers with status chip
  (draft / published / paused / sold out / archived), price label,
  edit affordance.
- **Create flow (modal stack):**
  1. Pick kind: 1:1, program, space, event, application.
  2. Title, blurb (≤ 140 chars), description (markdown editor with
     live preview — reuse the existing markdown surface from check-ins
     if present, otherwise plain textarea + sanitised render).
  3. Price shape (see HOW).
  4. Bundled content (zero or more programs / spaces / events; for
     application kind, an application form ref from the intake
     templates work, `docs/expansion/14`).
  5. Publish toggle (stays draft until flipped).
- **Edit flow** — same as create, with field-level confirm if a
  field that affects existing buyers is changed (price, included
  content). The confirm explains the impact ("Existing buyers keep
  their current entitlement; new buyers see the updated price").
- **Pause / unpause** — instant, no confirm.
- **Unpublish** — confirm modal; the offer becomes invisible to
  storefront and marketplace but existing buyers retain access.
- **Archive** — only available on offers with zero historical
  purchases. Soft delete server-side.

### Out of scope for v1

- Coupons / promo codes.
- A/B price testing.
- Tiered pricing within a single offer (use multiple offers).
- Dynamic / metered pricing.
- Offer-level analytics dashboards (a separate dashboard pack
  later — surface lightweight counts only here).
- Bulk import / export.
- Image upload for the hero (defer like profile photo — see
  `docs/expansion/16` HOW). Ship without hero rather than ship a
  half-working uploader.

## HOW to implement safely

1. **Placement.** The builder is a coach-side surface. The
   doctrine and `docs/expansion/README.md` say "no sixth tab" —
   so the builder hangs off Settings (row "Offers") or off the
   Templates tab as a sibling stack. Do not add a new tab.
2. **Price shape is finite.** Encode it as a discriminated union
   (see API contract) so the renderer in [01](./01-coach-storefront.md)
   never has to guess. Mobile validation is shape only; backend
   is source of truth for what the coach's tier can publish.
3. **Tier gating.** Some offer kinds and price shapes are
   entitlement-gated (e.g. subscriptions only on paid coach
   tiers). Read entitlements from the existing store; do not
   re-fetch.  Disabled options render with a "Upgrade to enable"
   tooltip — server-side `403` is the source of truth.
4. **Content picker reads, does not author.** Picking a program
   in the builder must not create a program. If the coach has no
   programs, the picker shows an empty state with a "Create a
   program" link out to the existing Templates surface. Same for
   spaces and events.
5. **Idempotency.** Save → server returns the canonical offer.
   Replace the local draft with the server response. Do not
   merge.
6. **Drafts are local until first save.** A draft offer that is
   never saved does not exist on the server. Persist drafts in
   AsyncStorage so a kill-the-app mid-edit recovers the state.

## Screens / navigation sketch

```
Coach app → SettingsScreen → "Offers"  ──► OfferListScreen
                                              ├─ "+" → OfferKindPickerScreen
                                              │            └─ pick kind
                                              │                 └─ OfferEditorScreen
                                              │                      ├─ Title / blurb / description
                                              │                      ├─ Price → OfferPricePickerScreen
                                              │                      ├─ Content → OfferContentPickerScreen
                                              │                      └─ Publish toggle
                                              └─ Existing offer row  ──► OfferEditorScreen (edit)
                                                                            └─ Action sheet:
                                                                                 ├─ Pause / Resume
                                                                                 ├─ Unpublish
                                                                                 └─ Archive (if 0 buyers)
```

## API contract dependency

- `GET /coach/offers` → `Offer[]`
- `GET /coach/offers/:id` → `Offer`
- `POST /coach/offers` body `DraftOffer` → `Offer`
- `PUT /coach/offers/:id` body `DraftOffer` → `Offer`
- `POST /coach/offers/:id/pause` → `Offer`
- `POST /coach/offers/:id/unpublish` → `Offer`
- `POST /coach/offers/:id/archive` → `Offer | 409` (409 if buyers exist)

`PriceShape` (mobile's target consumption contract):

```ts
type PriceShape =
  | { kind: 'free' }
  | { kind: 'oneTime'; amount: Money }
  | { kind: 'subscription'; amount: Money; interval: 'month' | 'year';
      trialDays?: number }
  | { kind: 'deposit'; deposit: Money; total: Money;
      schedule: 'on_approval' | 'on_first_session' }
  | { kind: 'application'; depositAmount: Money | null }; // application kind
                                                          // may collect a hold

type Money = { currency: 'USD' | 'GBP' | 'EUR'; amountMinor: number };
```

## Stripe / TGP-balance abstraction

The builder does not see Stripe. It writes a `PriceShape` and the
backend translates that into Stripe Products/Prices on save. If
the coach is not Connected, the backend returns a typed `412`
("connect required"); mobile shows an "Connect to publish" CTA
that routes to the existing Stripe Connect surface (or to a
wait-list if the coach's region isn't supported).

## Loading / error / empty states

- **Loading:** skeleton list (3 rows).
- **Empty:** "You haven't created any offers yet. Tap + to start."
- **Save error:**
  - Validation: inline per-field errors.
  - 412 (connect required): "You need to connect your payouts
    account before publishing a paid offer." with action.
  - 403 (entitlement): "Subscriptions are available on the Pro
    plan. Upgrade to enable." with link to billing.
  - Network: keep the editor mounted, show a non-blocking toast,
    do not lose the draft.

## Accessibility

- Each price-kind option in the picker is an individually labelled
  radio button with a visible description; do not rely on the
  group label alone.
- The "Publish" toggle announces its current state and the impact
  ("Off, hidden from clients" / "On, visible to clients").
- Confirm modals trap focus and announce the destructive action
  first.

## Analytics

- `offer_create_started` — `{ kind }`
- `offer_create_completed` — `{ id, kind, priceKind }`
- `offer_edit_completed` — `{ id, fieldsChanged: string[] }`
  (no PII; field names from a fixed allowlist).
- `offer_paused` / `offer_unpublished` / `offer_archived` —
  `{ id, hadBuyers: bool }`.

## Feature flags / entitlements

- Flag: `features.offerBuilder`. Off by default. When off, the
  Settings row is hidden.
- Entitlement gating per price kind: `entitlements.offer.subscription`,
  `entitlements.offer.deposit`, `entitlements.offer.application`.
  Free + oneTime are available on every paid tier; the others are
  Pro/Studio-only. Mobile renders the picker option as disabled
  with a "Upgrade" affordance when the entitlement is missing.
- Team Mode: only `owner` and `senior_coach` roles can author.

## Privacy / moderation

- Coach-authored copy is moderated server-side on save (same path
  as the profile bio). Mobile does not re-validate.
- Hero alt text is required for accessibility once images ship —
  the validator can enforce non-empty alt at submit time.
- A coach with a moderation flag on their account cannot publish
  new offers; the publish toggle renders disabled with an explainer.

## Rollout

1. Internal-only behind `features.offerBuilder`. One internal
   coach creates one free offer end-to-end.
2. Add `oneTime` for the same internal coach; verify Stripe
   Connect path with test cards.
3. Add subscription + deposit gates; flip on for a 5–10 coach
   ring with the entitlement on.
4. GA after the application funnel ships ([04](./04-application-funnel.md)).

## Tests

- Unit: `PriceShape` validators (currency / amount / interval
  combinations).
- Unit: draft persistence in AsyncStorage; recovery on remount.
- Component: editor renders all kinds; entitlement gating disables
  the right options; publish toggle visibility behaviour.
- Integration: create → publish → appears in storefront read
  path (mock the read endpoint, assert the render).
- Manual: 412 (no Stripe Connect) flow; 409 (archive with buyers)
  flow.

## Risks

- **Tier-gate drift.** If marketing changes which tier gets which
  price kind, the entitlement names must stay stable; only the
  tier-to-entitlement mapping changes server-side. Mobile reads
  entitlements, not tier names.
- **Hidden-publish foot-gun.** A coach who flips Publish without
  connecting Stripe sees a 412. The error must explain *exactly*
  what to do; do not fall back to a generic "something went wrong".
- **Multi-currency drift.** Price renderer in [01](./01-coach-storefront.md)
  must handle every currency the builder allows. Keep the
  allowed set small (USD/GBP/EUR for v1).

## Dependencies

- Backend #119 payments engine + Connect status endpoint.
- `docs/expansion/14` intake templates (application form ref).
- `docs/expansion/18` clone starter programs (program ref).
- `docs/expansion/20` team mode (role enforcement).
- [01-coach-storefront](./01-coach-storefront.md) (consumer of the
  authored offers).

## Acceptance criteria

- [ ] Flag off → Settings row hidden; deep-link to editor returns
      to Settings root.
- [ ] Flag on → coach can create, edit, pause, unpublish, archive
      offers across every supported kind / price shape they are
      entitled to.
- [ ] Disallowed price shapes render disabled with an upgrade
      affordance; server-side `403` is matched by the UI.
- [ ] Drafts survive an app kill mid-edit.
- [ ] Existing programs / spaces / events are referenced, not
      duplicated, by the content picker.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- "Why can't I delete an offer with buyers?" is a likely support
  question. The answer is in the audit-trail requirement; the
  archive-with-zero-buyers path is the safe alternative. Add an
  in-app explainer at the moment of the 409.
- The Templates tab (`ProgramTemplatesScreen`) is the most likely
  candidate for a sibling-stack placement of the builder. Final
  call goes to whoever owns the doctrine doc; do not flip the
  feature flag for non-internal coaches until that placement is
  decided.
- Watch for the first time a coach edits the price of an
  in-flight subscription. The confirm modal is the only safety
  net; verify the copy is unambiguous.
