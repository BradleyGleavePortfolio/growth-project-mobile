# 06 — Coach marketplace + discovery

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Surface:** Client app (primary). Web has a sibling marketplace
page; mobile and web read the same backend index.
**Owner:** Mobile client team

## WHY

A storefront ([01](./01-coach-storefront.md)) is useful only to
someone who already knows the coach's slug. The marketplace is the
*pre-conversion* surface — a discovery feed that introduces a
prospect to coaches they don't yet know, ranked or curated for
relevance. Without it, every coach has to drive their own traffic
externally, and the platform's discovery flywheel never starts.

This is also the first surface where TGP behaves like a network
rather than a SaaS — coach A's content can convert a buyer who
arrived via coach B's link.

## WHEN to build

After:
- `docs/expansion/16` public coach profile is live.
- [01-coach-storefront](./01-coach-storefront.md) is GA, so the
  marketplace can deep-link to offers.
- Backend #121 (marketplace + slug index) exposes a search/list
  endpoint with ranking signals already computed server-side.
- `docs/expansion-wave-2/03` profile images & avatars in the
  field.

## WHERE in the repo

- New screens:
  - `src/screens/client/MarketplaceScreen.tsx` — feed.
  - `src/screens/client/MarketplaceSearchScreen.tsx` — search +
    filter sheet.
  - `src/screens/client/MarketplaceCoachCardScreen.tsx` — a
    "preview-detail" card for a coach (not the full storefront —
    that lives at `/c/<slug>`).
- Entry: new "Discover" entry on Home (above-the-fold tile) and
  a More-stack row "Marketplace". No new tab.
- API: `src/services/api.ts` — `discoveryApi.list`,
  `discoveryApi.search`, `discoveryApi.getFeatured`.
- Type: `src/types/marketplace.ts`.

## WHO owns and uses it

- **Builder:** Mobile client team.
- **Author of card content:** Coaches via their public profile +
  storefront. The marketplace is read-only.
- **Audience:** Prospective and existing clients browsing
  cross-coach.

## WHAT MVP includes

- **MarketplaceScreen** — vertically scrollable feed.
  - Section 1: "Featured" (curated by ops, capped to ~5 cards).
  - Section 2: "For you" (server-ranked; v1 ranking is
    deliberately simple — recency of publish + activity).
  - Section 3: "By specialty" — chips that filter the feed
    inline (e.g. "Strength", "Nutrition", "Mobility"). Specialty
    taxonomy is server-driven.
- **MarketplaceSearchScreen** — text search + filter sheet
  (specialty, language, price range derived from offer min).
- **MarketplaceCoachCardScreen** — read-only preview: photo,
  name, tagline, 1–2 featured offer pills with prices, "View
  storefront" CTA → `StorefrontScreen`.
- **Empty / "no results"** — honest copy ("No coaches match this
  filter yet"), with a "Clear filters" action.

### Out of scope for v1

- Reviews / ratings (deferred — coordinates with a profile change
  in `docs/expansion/16`).
- Personalised recommendations beyond simple recency/activity.
- Geographic discovery / "coaches near me".
- Coach-side opt-in/opt-out of marketplace listing as a separate
  toggle (use the existing "show profile publicly" — if profile
  is public, marketplace shows it; otherwise hidden).
- Paid placement / boosted listings.
- Sponsorship / "promoted by" labels.
- Cross-marketplace aggregator (other coaching platforms).

## HOW to implement safely

1. **Server is the source of ranking.** Mobile renders what the
   feed endpoint returns. Do not re-rank locally.
2. **No silent boosts.** If a coach is featured, the feed must
   render them in the explicit "Featured" section, not silently
   prepended to "For you". This protects the doctrine of honest
   surfaces.
3. **Profile-off hides marketplace.** The "Show profile publicly"
   toggle in `docs/expansion/16` doubles as the marketplace
   inclusion toggle.
4. **Affiliate-attributed traffic does not feed ranking.** Per
   the risk noted in [05](./05-affiliate-referral-dashboards.md),
   the backend must exclude paid-affiliate-attributable revenue
   from "popular" signals. Mobile cannot enforce; coordinate
   with the ranking spec.
5. **Card height is fixed enough to skeleton honestly.**
   Variable text length is allowed but bounded.

## Screens / navigation sketch

```
Home → "Discover" tile  ──► MarketplaceScreen
                              ├─ Featured (capped, server-curated)
                              ├─ For you (server-ranked)
                              ├─ Specialty chips → in-place filter
                              └─ "Search" affordance ──► MarketplaceSearchScreen
                                                            ├─ Text + filter sheet
                                                            └─ Results

Tap any card  ──► MarketplaceCoachCardScreen
                     └─ "View storefront" ──► StorefrontScreen
```

## API contract dependency

- `GET /discovery/feed?cursor=&specialty=&language=` →
  `{ featured: CoachCard[], items: CoachCard[], nextCursor:
  string | null }`
- `GET /discovery/search?q=&specialty=&language=&priceMin=&priceMax=`
  → `{ items: CoachCard[], nextCursor: string | null }`
- `GET /discovery/specialties` → `Specialty[]` (server-driven
  taxonomy).

```ts
type CoachCard = {
  slug: string;
  name: string;
  tagline: string;
  photoUrl: string | null;
  specialties: string[];          // ids
  languages: string[];            // BCP-47
  featuredOfferIds: string[];     // 0..2
  priceFromMinor: number | null;  // min across published offers
  currency: string | null;
};

type Specialty = { id: string; label: string; iconKey: string };
```

## Stripe / TGP-balance abstraction

The marketplace does not surface payment details beyond a
"From $X" indicator. All purchase flow happens downstream in the
storefront → checkout module. No payment session is created on
this surface.

## Loading / error / empty states

- **Loading:** skeleton card grid (6 cards).
- **Empty (feed):** "No coaches match this filter yet."
- **Empty (search):** "Nothing matches '<q>'." with a
  "Clear search" action.
- **Network error:** retry surface; cached prior page.
- **Featured-only fallback:** if "For you" is empty (cold
  account), only the Featured section renders.

## Accessibility

- Each card is a single tappable element with an
  `accessibilityLabel` of name + tagline + price-from.
- Specialty chips render as filter buttons with on/off state
  announced.
- Featured section is announced as a region with its own header
  ("Featured coaches").
- Photos use the avatar fallback path from
  `docs/expansion-wave-2/03` when `photoUrl` is null.

## Analytics

- `marketplace_viewed` — `{ section: 'feed' | 'search' }`
- `marketplace_card_tapped` — `{ slug, position, section }`
- `marketplace_filter_applied` — `{ specialty?, language?,
  priceRangeIdx? }`
- `marketplace_search_submitted` — `{ qLength, hadResults: bool }`
- `marketplace_to_storefront` — `{ slug, source: 'card' | 'cta' }`

No PII; slug is public.

## Feature flags / entitlements

- Flag: `features.marketplace`. Off by default. When off, the
  Discover tile is hidden and the More-stack row is hidden.
- No buyer-side entitlement gating.
- Coach-side: marketplace inclusion is governed by the public
  profile toggle (no separate flag).

## Privacy / moderation

- A profile flagged for moderation server-side disappears from
  the feed; mobile receives a non-flagged result set.
- Specialty labels are a closed taxonomy; no free-text
  categories on the buyer side.
- Search query strings are not persisted client-side beyond the
  current screen instance.

## Rollout

1. Internal — featured section seeded with team accounts; verify
   render and analytics.
2. Add 5–10 paid coaches; verify "For you" populates and ranks
   sensibly.
3. Flip on for a beta cohort behind `features.marketplace`.
4. GA after the search endpoint clears performance budgets in
   staging.

## Tests

- Unit: filter state reducer (chip toggle, search submit).
- Component: feed rendering with mixed featured/items; empty;
  error; loading.
- Integration: tap card → coach card screen → "View storefront"
  → storefront screen.
- Manual: search with non-Latin characters; long taglines; no
  photo (avatar fallback); profile-off coach absent from feed.

## Risks

- **Cold-start dilution.** A small marketplace with a thin
  "For you" looks empty. The Featured section + specialty chips
  are the cold-start UX; do not let "For you" lead with empty
  space.
- **Slug enumeration.** A public discovery feed exposes slugs
  by design. Slugs are already public; the risk is that tying
  search hits to user accounts must not leak buyer identity.
  Server-side: no buyer-side personalisation in v1, so no leak.
- **Rate-limit abuse.** Search is a public endpoint — rate-limit
  server-side; mobile retries respect 429 with backoff.
- **Doctrine trap.** The marketplace is the most likely place
  for "fake activity" to creep in (e.g. "12 people viewed today").
  Resist; v1 has no per-coach activity counters.

## Dependencies

- Backend #121 marketplace + slug index.
- `docs/expansion/16` public coach profile (toggle drives
  inclusion).
- `docs/expansion-wave-2/03` profile images.
- [01-coach-storefront](./01-coach-storefront.md) (downstream
  surface).

## Acceptance criteria

- [ ] Flag off → Discover tile hidden; More-stack row hidden.
- [ ] Flag on → feed renders Featured + For you + chips; search
      surface returns results.
- [ ] Profile-off coaches do not appear.
- [ ] Specialty chips filter the feed in-place; "Clear filters"
      restores it.
- [ ] Empty / error / loading states are honest per doctrine.
- [ ] No hardcoded hex; theme tokens only.

## Operator handoff notes

- The Featured curation surface is ops-side (web admin or a
  back-office tool). The mobile spec does not include a coach-
  facing "request to be featured" flow in v1.
- Specialty taxonomy churn is the most likely future change.
  Cache the taxonomy with a short TTL, do not bake labels into
  bundle.
- The first time a coach reports "I'm not appearing in the
  feed", the answer is almost always either profile-off or the
  ranking-cooldown after publish. Add a help-centre article to
  cover both before flipping the flag.
