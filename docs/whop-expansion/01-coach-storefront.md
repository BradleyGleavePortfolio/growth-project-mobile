# 01 — Coach Storefront — public browse & purchase

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app (in-app render of a coach's storefront), with
deep-link entry from web (out of repo).
**Owner:** Mobile client team primary. Web team owns the public,
unauthenticated storefront page; mobile honours the deep-link contract
and renders the same data inside the app.

## WHY

A coach today has no in-app surface that says "here is everything I
sell". The public profile (`docs/expansion/16`) introduces the coach;
the storefront is the next step — a list of offers (1:1 coaching,
group programs, deposits-style trials, paid spaces, paid event seats)
that a prospect can browse and buy. Without it, conversion lives in
DMs, off-platform, with no analytics, no recurring billing, and no
audit trail.

The storefront is also the binding surface for everything else in
this pack: the application funnel attaches to a *high-ticket offer*,
the affiliate program pays out on *offer purchases*, marketplace
discovery surfaces *offers* not just coaches, and rewards/bounties
unlock when a client *buys an offer*.

## WHEN to build

After:
- `docs/expansion/16` public coach profile is shipped (slug + deep
  link + authoring surface).
- Backend payments engine (#119) exposes a payment session create
  endpoint for at least one offer type.
- Backend marketplace/slug index (#121) returns an `offers[]` array
  on the public-profile read.

The storefront is the smallest mobile surface that demonstrates the
end-to-end loop (profile → offer → checkout → entitlement). Ship it
first within this pack so the others have a working anchor to plug
into.

## WHERE in the repo

- New screen: `src/screens/client/StorefrontScreen.tsx` — list of
  offers under a coach.
- New screen: `src/screens/client/OfferDetailScreen.tsx` — single
  offer detail + "Buy" / "Apply" CTA.
- Deep-link parser update: `src/services/deepLink.ts` (or wherever
  the universal-link parser lives — see `docs/expansion/16` for
  current location). Extend to accept:
  - `tgp://c/<slug>` → `CoachLandingScreen` (existing per
    `docs/expansion/16`)
  - `tgp://c/<slug>/offer/<offerId>` → `OfferDetailScreen`
  - Universal-link equivalents under `app.trygrowthproject.com`.
- API: `src/services/api.ts` — `clientApi.getCoachStorefront(slug)`,
  `clientApi.getOffer(offerId)`. These are the read surfaces; the
  buy action calls into the checkout flow defined in
  [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md).
- Type: `src/types/storefront.ts` (`Offer`, `OfferKind`, `PriceShape`).

## WHO owns and uses it

- **Builder:** Mobile client team (storefront + offer detail), with
  the deep-link wiring shared with `docs/expansion/16`.
- **Author of content:** Coach (offers come from the Offer Builder,
  see [02-offer-builder](./02-offer-builder.md)).
- **Audience:** Prospective and existing clients. An existing client
  is shown the storefront with already-owned offers marked; a fresh
  visitor is shown the public storefront and prompted to sign up at
  checkout.

## WHAT MVP includes

- **StorefrontScreen** — vertical list of `Offer` cards under a
  coach's slug. Each card shows: title, kind chip (1:1, program,
  space, event, application), price (or "Apply to join"), short
  blurb, "Owned" pill if entitled. Tap → `OfferDetailScreen`.
- **OfferDetailScreen** — hero (image or coach avatar), title,
  long-form description, what's included (read from the offer's
  bundled-content list, see 02), price breakdown, CTA:
  - Free → "Get started"
  - Fixed price → "Buy"
  - Subscription → "Subscribe"
  - Deposit → "Reserve" (with explainer copy on the deposit)
  - Application → "Apply to join" (routes to
    [04-application-funnel](./04-application-funnel.md))
- **Owned-state rendering.** If the buyer already owns the offer,
  the CTA becomes "Open" and routes to the offer's primary entry
  surface (program, space, event detail).
- **Auth gating.** Unauthenticated users can browse and read; they
  are prompted to sign up *at the moment of checkout*, not on
  arrival, so the storefront still demos to a cold visitor.
- **Sold-out / closed state.** Offers can be capped or paused by
  the coach; the card and detail render an honest disabled state
  ("Currently closed") with no CTA.

### Out of scope for v1

- Bundles of multiple offers in a single transaction.
- Coupons / promo codes (deferred until backend supports them).
- Tipping / pay-what-you-want pricing.
- Offer-level reviews (deferred with the wider review feature).
- Wishlist / save-for-later.
- In-storefront search (storefronts are short; search lives in
  marketplace, see [06-coach-marketplace-discovery](./06-coach-marketplace-discovery.md)).

## HOW to implement safely

1. **Storefront is read-only on mobile.** Authoring is the Offer
   Builder ([02](./02-offer-builder.md)). Do not let storefront code
   write offer state.
2. **Owned-state must come from a single source of truth** — the
   entitlements store. Do not infer "owned" from purchase history;
   query `clientApi.getEntitlements()` (or the existing equivalent)
   and key the offer card off it.
3. **CTA copy is offer-kind-driven.** Centralise the mapping in
   `src/types/storefront.ts` so the same offer kind renders the
   same CTA across storefront, marketplace, and notifications.
4. **Deep-link parser change is additive.** The `/c/<slug>` route
   already lives under `docs/expansion/16`. Add `/c/<slug>/offer/<id>`
   without touching the slug-only route. Snapshot tests on the
   parser before editing it.
5. **Honest empty state.** A coach with zero published offers
   renders "This coach hasn't published anything yet" — not a
   "coming soon" tile. Doctrine §3.

## Screens / navigation sketch

```
Deep link: tgp://c/<slug> or https://app.trygrowthproject.com/c/<slug>
  └─ CoachLandingScreen (per docs/expansion/16)
       └─ "View storefront" tile  ──► StorefrontScreen
                                          ├─ Offer card (1:1)
                                          ├─ Offer card (program)
                                          ├─ Offer card (space)
                                          ├─ Offer card (event)
                                          └─ Offer card (application)

Tap any offer card  ──► OfferDetailScreen
                          ├─ Hero
                          ├─ Description
                          ├─ Included content list
                          ├─ Price breakdown
                          └─ CTA  ──► Checkout / Application / Open

Existing client deep-linking direct to an offer
  tgp://c/<slug>/offer/<offerId>  ──► OfferDetailScreen
                                        (slug + offer id resolved server-side)
```

## API contract dependency

- `GET /public/coach/:slug/storefront` → `{ coach: PublicProfile,
  offers: Offer[] }`. The coach half is the existing public-profile
  shape; offers is the new array.
- `GET /public/offer/:offerId` → `Offer | 404`. Used for direct
  deep-link entry without re-fetching the storefront.
- `GET /me/entitlements` → `Entitlement[]`. Used to compute the
  "Owned" pill. Already present today for program access; extend
  to cover offer kinds.

`Offer` shape (mobile's target consumption contract):

```ts
type OfferKind = '1on1' | 'program' | 'space' | 'event' | 'application';

type Offer = {
  id: string;
  coachId: string;
  coachSlug: string;
  kind: OfferKind;
  title: string;
  blurb: string;        // ≤ 140 chars, plain text
  description: string;  // markdown, server-side sanitized
  heroImageUrl: string | null;
  price: PriceShape;    // see 03 for shape
  includedContent: IncludedRef[]; // ids of programs, spaces, events
  status: 'published' | 'paused' | 'soldOut';
  applicationFormId: string | null; // present iff kind === 'application'
};
```

## Stripe / TGP-balance abstraction

The storefront does not call Stripe. It renders a price and routes
to the checkout flow defined in
[03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md).
The price field's `currency` and `intervalLabel` are display-only
on the storefront; the actual payment session is created at the
moment of CTA tap, in the checkout module. This isolates the
storefront from any rail change (Stripe → other) without a re-spec.

## Loading / error / empty states

Per `docs/platform-readiness/07`:

- **Loading:** skeleton card list (3 cards), no spinner.
- **Empty (coach with no offers):** "This coach hasn't published
  anything yet."
- **Empty (slug not found):** "This profile isn't available." —
  same copy as `docs/expansion/16`.
- **Network error:** retry surface with the user's last good cached
  copy (React Query `keepPreviousData`).
- **Sold out / paused offer:** card disabled, CTA replaced with the
  state label, still tappable into detail for context.

## Accessibility

- Card is a single tappable element with an `accessibilityLabel`
  combining title + price + ownership state.
- CTA buttons announce their kind ("Buy, button" vs "Subscribe,
  button"), not just generic "Open".
- Hero images have alt text from the offer's `heroAlt` field; if
  absent, fall back to title + " preview image".
- Price text uses no colour as the only differentiator —
  subscription vs deposit is also distinguished by an icon and
  label.

## Analytics

Events (PostHog):

- `storefront_viewed` — `{ coachSlug, offerCount, source }`
- `offer_card_tapped` — `{ offerId, offerKind, position }`
- `offer_detail_viewed` — `{ offerId, offerKind, deeplinked: bool }`
- `offer_cta_tapped` — `{ offerId, offerKind, ownedAtTap: bool }`

`source` values: `landing`, `marketplace`, `deeplink`, `home_tile`.

No PII fields. Coach slug is treated as public.

## Feature flags / entitlements

- Flag: `features.coachStorefront`. Off by default. When off, the
  "View storefront" tile on `CoachLandingScreen` is hidden and
  direct deep-links to `/c/<slug>/offer/<id>` render an honest
  "not available" screen.
- Entitlement: none on the buyer side (anyone can browse). On the
  coach side, *publishing* a paid offer requires a Stripe-Connect
  capable coach tier — this is enforced in the Offer Builder
  ([02](./02-offer-builder.md)), not here.

## Privacy / moderation

- Public storefronts surface coach-authored copy. Server-side
  moderation (link blocklist, profanity filter) lives in the
  authoring path; mobile does not re-validate.
- Hero images go through the same moderation path as profile
  photos (`docs/expansion-wave-2/03`).
- A reported storefront is rendered as "This profile isn't
  available" — same surface as a hidden profile.

## Rollout

1. Land the screens behind `features.coachStorefront`, off.
2. Flip on for one internal coach with one published free offer;
   verify owned-state, deep-link, and analytics end-to-end.
3. Flip on for a small ring of paid coaches (5–10) once the
   payment session abstraction is verified in [03](./03-checkout-deposits-subscriptions.md).
4. General availability after the funnel ([04](./04-application-funnel.md))
   ships, so high-ticket offers have an "Apply" path.

## Tests

- Unit: deep-link parser — `tgp://c/X`, `tgp://c/X/offer/Y`, plus
  universal-link equivalents.
- Unit: CTA-copy mapping by `OfferKind`.
- Component: storefront list rendering, owned-state, paused state,
  empty state, error state.
- Integration: storefront → offer detail → checkout entry; assert
  navigation params and that no payment call fires before CTA.
- Manual: cold-start deep-link to an offer (app not running) on
  iOS and Android; warm-start; flag-off rendering.

## Risks

- **Deep-link drift.** The `/c/<slug>` route is shared with the
  public profile feature; an additive change here must not
  regress the slug-only route. End-to-end coverage on both
  platforms is mandatory before the flag goes on.
- **Owned-state lag.** Right after a purchase, the entitlements
  store may not have refreshed. Mitigation: invalidate the
  entitlements query on a successful checkout webhook (already
  the pattern for program entitlements).
- **Storefront pretending to be a marketplace.** Discovery lives
  in [06](./06-coach-marketplace-discovery.md). Resist the urge
  to add cross-coach features here.

## Dependencies

- Backend #121 (slug index + offers array).
- Backend #119 (payment session creation, consumed by 03).
- `docs/expansion/16` public coach profile (deep-link contract).
- [02-offer-builder](./02-offer-builder.md) for authoring.
- [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md)
  for the buy flow.

## Acceptance criteria

- [ ] Flag off → no storefront tile; direct offer deep-links route
      to "not available".
- [ ] Flag on → coach storefront renders all published offers in
      `position` order, with correct CTA per kind.
- [ ] Owned offers show the "Open" CTA; tapping opens the
      entitlement's primary surface.
- [ ] Sold-out / paused offers render disabled state, not hidden.
- [ ] Deep-link to a specific offer works cold and warm on iOS
      and Android.
- [ ] No hardcoded hex; theme tokens only.
- [ ] Existing `/c/<slug>` route has zero regressions.

## Operator handoff notes

- The first paid coach to test this flow needs a Stripe-Connect
  account live in test mode. Coordinate with the payments work in
  [03](./03-checkout-deposits-subscriptions.md) before flipping
  the flag for them.
- If marketing wants to share a "buy this offer" link directly,
  give them the universal-link form
  (`https://app.trygrowthproject.com/c/<slug>/offer/<id>`) — the
  custom-scheme form is for in-app composition only.
- The "Owned" pill copy is intentionally neutral; do not change it
  to "You bought this" or "Member" without coordinating with the
  doctrine doc owner.
