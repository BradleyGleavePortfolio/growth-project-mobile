# Wave 7 — Discovery marketplace UX

**Status:** Pre-build, docs-only.
**Last reviewed:** 2026-05-01.
**Backend dependency:** Marketplace + slug index service (cross-repo backend wave). Public coach profile (Wave 1, `docs/expansion/16-public-coach-profile.md`).
**Mobile dependencies:** Wave 6 (`Install` surface, public-proof consent), Wave 5 (#97 client / coach split), `docs/whop-expansion/06-coach-marketplace-discovery.md` (PR #96, source material).
**Position in 6–10 order:** Second. Marketplace presence is unlocked by Wave 6's `Install` surface; Wave 7 is the first *public-facing* surface added.

---

## 1. Persona contract

| Persona | What they see and do in Wave 7 |
| ------- | ------------------------------ |
| **Owner** | Manages the curated `featured` slot and editorial categories from web. Mobile companion is read-only — sees the same list a buyer sees. |
| **Coach** | Sees a `Marketplace presence` row inside their own `Settings → Install` (Wave 6). On install, they edit a public coach card (photo, headline, one-liner, tags, location, languages). Sees their own card preview as the buyer would. |
| **Sub-coach** | Cannot edit the marketplace card. Sees the head coach's card preview in read-only mode. Inherits the head coach's marketplace presence; does not have an independent listing. |
| **Client / Student** | Sees marketplace surfaces only when they tap "Find a coach" from `MoreStack → Account → Membership` (a future row, gated on `features.marketplace_browse_for_clients`). Default: clients do not see other coaches. |
| **Ambassador / Affiliate** | If their referral coach has a marketplace listing, the affiliate share-link uses the public slug (Wave 8). |
| **Buyer / Prospect** | Primary persona for Wave 7. Lands via `https://app.trygrowthproject.com/m/<slug>` Universal Link or `tgp://m/<slug>` custom scheme. Sees the public storefront stack — no auth required to browse. |

## 2. Navigation map

A new pre-auth stack: `PublicMarketplaceStack`. Mountable from:

- `AuthNavigator` (when an unauthenticated link comes in deep-linked).
- `ClientNavigator → MoreStack → Membership → FindCoach` (gated on `features.marketplace_browse_for_clients`).

Routes:

```
PublicMarketplaceStack
├── MarketplaceHome      — featured + categories + search
├── CategoryDetail       — coaches in a category
├── CoachCardPreview     — public coach card (matches docs/expansion/16)
├── SearchResults        — search by name, tag, location, language
└── PublicProofDetail    — testimonial detail (opt-in only, see §9)
```

Deep links:

| URL pattern | Route | Pre-auth allowed? |
| ----------- | ----- | ----------------- |
| `tgp://m` | `MarketplaceHome` | Yes |
| `tgp://m/<slug>` | `CoachCardPreview` | Yes |
| `tgp://m/<slug>/proof/<id>` | `PublicProofDetail` | Yes |
| `tgp://m/c/<categorySlug>` | `CategoryDetail` | Yes |
| `https://app.trygrowthproject.com/m/<slug>` | Universal Link → `CoachCardPreview` | Yes |

The pre-auth allowance is enforced in `RootNavigator`: if `AuthState=unauthenticated` and the deep link starts with `tgp://m`, mount `PublicMarketplaceStack` *inside* `AuthNavigator` instead of the Welcome screen. After successful sign-in, the user lands back where they were.

## 3. Screen contracts

### `MarketplaceHome`

- **Purpose:** Top-of-funnel browse surface. Shows featured slot, category grid, and a search bar.
- **Server data:** `useMarketplaceHome()` → `GET /v1/marketplace/home`. Returns `{ featured: PublicCoachCard[]; categories: Category[] }`.
- **Mutations:** None.
- **States:**
  - Loading: skeleton featured row + category grid.
  - Empty: should not be empty post-launch. If empty, render `Browse coming together — check back soon.` honest empty (no "Coming Soon" chrome).
  - Error: AsyncBoundary retry.
  - Offline: last cache shown; search disabled; a tokenised `Offline` badge.

### `CoachCardPreview`

- **Purpose:** A coach's public card. Mirrors the public profile spec in `docs/expansion/16` and adds optional opt-in surfaces (testimonials, before/afters, sample programs).
- **Server data:** `usePublicCoach(slug)` → `GET /v1/public/coach/:slug`. Returns `PublicCoachCard`.
- **Mutations:** `requestIntake(slug)` → `POST /v1/public/coach/:slug/intake-request` (anonymous). Buyer enters email + first name; backend kicks off the intake / application flow (Wave 9).
- **States:**
  - Loading: skeleton card.
  - Empty: `This coach is not accepting new clients right now.` if `accepting=false`.
  - Error: AsyncBoundary retry.
  - Offline: last cache shown if available; primary CTA disabled with `Offline — try again on Wi-Fi.` toast.

### `SearchResults`

- **Purpose:** Browse by query.
- **Server data:** `useMarketplaceSearch(query, filters)` → `GET /v1/marketplace/search?q=&tag=&loc=&lang=`.
- **Mutations:** None.
- **States:**
  - Loading: skeleton list.
  - Empty: `No coaches matched your search.` honest empty + filter-clear action.
  - Error: AsyncBoundary retry.
  - Offline: cached most-recent query if present; new searches disabled.

### `PublicProofDetail`

- **Purpose:** Detail view of a single piece of public proof (testimonial or before/after). Only renders if the source client has explicitly opted in (`public_proof_consent_v: 1` recorded; not revoked).
- **Server data:** `usePublicProof(slug, id)` → `GET /v1/public/coach/:slug/proof/:id`.
- **Privacy contract:** if the source client revokes consent, the artefact is removed within one app session. Mobile retries fetch on app foreground; on 410 Gone, navigates back with toast `This testimonial is no longer available.`

## 4. API contract dependencies

```ts
type PublicCoachCard = {
  slug: string;
  displayName: string;
  headline: string;
  oneLiner: string;
  photoUrl: string | null;
  tags: string[];        // e.g. ['fat_loss', 'menopause', 'powerlifting']
  location: { city: string | null; country: string };
  languages: string[];   // ISO codes
  accepting: boolean;
  publicProof: PublicProofItem[]; // empty array if coach has not opted in
};

type PublicProofItem = {
  id: string;
  kind: 'testimonial' | 'before_after_pair';
  body: string | null;
  beforeUrl?: string;
  afterUrl?: string;
  consentedAt: string;   // ISO; mobile asserts presence
  client: { displayInitial: string }; // never full name
};

type Category = {
  slug: string;
  title: string;
  count: number;
};

type MarketplaceHome = {
  featured: PublicCoachCard[];
  categories: Category[];
};
```

Endpoints:

```
GET /v1/marketplace/home                          → MarketplaceHome
GET /v1/marketplace/search?q=&tag=&loc=&lang=     → PublicCoachCard[]
GET /v1/public/coach/:slug                        → PublicCoachCard
GET /v1/public/coach/:slug/proof/:id              → PublicProofItem
POST /v1/public/coach/:slug/intake-request        → { ok: true; intakeId: string }
```

Backend wave: marketplace + slug index. Public-proof consent records live in the existing privacy ledger.

## 5. State and cache strategy

- React Query keys: `['marketplace','home']`, `['marketplace','search', { q, filters }]`, `['public','coach', slug]`, `['public','coach', slug, 'proof', id]`.
- `staleTime` per key: 5 min for home and category, 30 s for search (more interactive), 10 min for `PublicCoachCard` (rarely changes), 0 for proof items (always re-validate to honour revocation within a session).
- Public surfaces cache in AsyncStorage to enable a useful offline experience for already-visited coach cards (Wave 7 explicitly supports "I want to show this card to my friend offline").
- No optimistic updates in Wave 7 — all reads.
- The intake request is a single-shot mutation; backoff retry handled by the standard mutation hook.

## 6. Push and deep-link behaviour

- Wave 7 does not generate pushes. It *receives* deep links (slug → card) and converts a buyer's intake request into a backend-side notification to the coach.
- Universal Links must work pre-auth. The existing parser in `src/utils/deepLink.ts` is extended with a `marketplace` namespace per `docs/platform-readiness/11-deep-links-readiness.md`.
- The `?invite=<code>` parameter behaviour from `docs/expansion/16` is preserved: a buyer landing on `tgp://m/<slug>?invite=<code>` carries the invite through the intake flow.

## 7. Permissions and consent

- **Buyer side:** none. Marketplace browsing requires no native permission.
- **Coach side (when installing marketplace presence in Wave 6):** explicit `public_profile` consent recorded. Coach card photo upload uses the `Photos` permission via `PermissionPromptModal` (Wave 6).
- **Public proof consent (clients of the coach):** lives on the *client's* surface, not Wave 7's. The Wave 7 contract is to render only consented items; the consent capture is part of Wave 8 §"Public proof opt-in".
- **OWNER_DECISION-7.B — Geolocation in search.** Choices: (a) Manual location entry only, (b) Auto-fill with `Location` permission. **Recommendation:** (a) for v1. Auto-fill adds a heavy permission prompt for marginal UX gain; defer to v2.

## 8. Accessibility notes

- Coach cards are `accessibilityRole="button"` with the displayName + headline as the accessible label.
- Featured slot is a horizontally-scrolling list with `accessibilityRole="list"`; each item is `accessibilityElementsHidden={false}`.
- Search input is a labelled `accessibilityLabel="Search for a coach"`.
- Tags / categories are `accessibilityRole="link"` with target slug in the label.
- Public proof images carry `accessibilityLabel` derived from the consenting client's chosen caption (or `Photo from <coach displayName>` if no caption).
- Dynamic type up to `accessibilityLarge` reflows the card grid to a single column.

## 9. Analytics, privacy, security

| Event | Properties | Notes |
| ----- | ---------- | ----- |
| `marketplace_home_viewed` | `{ source: 'tab' | 'deeplink' | 'find_coach_row' }` | No PII. |
| `marketplace_search_submitted` | `{ q_length, filter_count }` | The query string itself is **never** sent — length and filter count only. |
| `marketplace_card_viewed` | `{ slug, source }` | Slug is public; no PII. |
| `marketplace_intake_requested` | `{ slug }` | Intake email is captured server-side; mobile does not log it. |
| `public_proof_viewed` | `{ slug, proof_id, kind }` | No PII. |

Privacy:

- The mobile client **never** logs the buyer's email or the intake request body. Server holds it.
- Public proof items render only `displayInitial` of the source client (never full name) regardless of what the API returns. If the API ever returns a full name, mobile coerces to initial.
- Deep links from marketplace pages do not carry tracking pixels or third-party identifiers.

Security:

- `PublicMarketplaceStack` does not have access to the JWT scope of any authenticated user even if mounted inside `AuthNavigator`. The `api.ts` client uses an unauthenticated axios instance for the `/v1/public/*` namespace.
- Intake requests are rate-limited server-side; mobile shows a `You've already asked to talk to <coach>. Check your email.` honest message on a duplicate within 24 h.

## 10. Test plan and acceptance criteria

### Unit

- `usePublicCoach` Zod-parses `PublicCoachCard`; rejects responses with full client names in `publicProof`.
- `useMarketplaceSearch` debounces input by 300 ms; cancels prior in-flight request.

### Integration

- Deep link `tgp://m/example-slug` from a cold start mounts `CoachCardPreview` without forcing sign-in.
- Sign-in from inside `PublicMarketplaceStack` lands the user back on the same `CoachCardPreview` after auth.
- Intake request honours rate-limit response (429 → surfaces honest message).

### Manual QA

- Browse without auth on iOS and Android.
- Switch network off mid-browse; verify offline cache renders.
- Revoke a public-proof consent server-side; verify the artefact disappears within one app session.

### Acceptance criteria

- [ ] `PublicMarketplaceStack` mounts pre-auth via deep link; sign-in returns user to original card.
- [ ] No buyer email or intake body is ever logged client-side.
- [ ] Public proof items render `displayInitial` only.
- [ ] Search analytics carry only query length and filter count, never the query string.
- [ ] Coach card respects `accepting=false` honest empty state.
- [ ] Universal Link parity — `https://app.trygrowthproject.com/m/<slug>` and `tgp://m/<slug>` route identically.
- [ ] No emoji, no celebration chrome, no "Featured 🔥" copy. Featured slot is labelled `Featured` with no decoration.

## 11. Phased implementation order, OWNER_DECISIONs, cross-repo deps

### Phased order

1. **Coach card preview (read-only, behind flag).** First runtime PR. Validates the deep-link path and the public API. No search, no home, no proof.
2. **Marketplace home + categories.** Second runtime PR. Adds `MarketplaceHome` and `CategoryDetail`.
3. **Search.** Third runtime PR. Adds `SearchResults` with debounced search.
4. **Public proof rendering.** Fourth runtime PR. Adds `PublicProofDetail` + the consent-revocation path.
5. **`Find a coach` row in client `MoreStack`.** Fifth runtime PR. Behind `features.marketplace_browse_for_clients`. Default off.
6. **Coach-side card editor.** Sixth runtime PR. Lives under Wave 6's `Install → Marketplace presence` detail.

### OWNER_DECISIONs

- **OWNER_DECISION-7.A — Ratings on cards.** Choices: (a) No ratings v1 (this brief's recommendation), (b) Ratings averaged from intake-completion clients, (c) Ratings averaged from any client. **Recommendation:** (a). Ratings are a moderation surface; they require an appeal process, weighting, and abuse handling. Defer to a Wave 11+ moderation pack.
- **OWNER_DECISION-7.B — Geolocation in search.** See §7.
- **OWNER_DECISION-7.C — Show "currently with X clients" stat.** Choices: (a) Hide (this brief's recommendation), (b) Show as honest stat ("Currently coaching ~30 clients"), (c) Show only if coach opts in. **Recommendation:** (a). Stat is volatile, easily misleading, and turns the marketplace into a comparison tool the doctrine resists.
- **OWNER_DECISION-7.D — Allow clients to see other coaches.** Choices: (a) Default off behind `features.marketplace_browse_for_clients` (this brief's recommendation), (b) Default on. **Recommendation:** (a). Default-on creates an in-app churn surface (current client browsing alternatives) without a clear product win. Default-off keeps the marketplace a buyer-prospect surface.

### Cross-repo dependencies

- **Backend marketplace + slug index** — hard for all Wave 7 surfaces.
- **Backend public-proof consent ledger** (extension of existing privacy primitives) — hard for `PublicProofDetail`.
- **Web marketplace SEO** — owns the indexable HTML for `https://app.trygrowthproject.com/m/<slug>`. Mobile's Universal Link consumption is downstream of web's SEO commitment. Soft dependency for v1; can ship without web SEO and rely on direct links.

### Finance dependencies

- None for Wave 7 itself. The intake → checkout path lives in Wave 9.
