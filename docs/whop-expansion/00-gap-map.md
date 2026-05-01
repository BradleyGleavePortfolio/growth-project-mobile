# 00 — Gap map: this pack vs. existing draft PRs

**Status:** Pre-build
**Last reviewed:** 2026-05-01
**Purpose:** Tell an operator picking up any feature in this pack what is
*already documented* elsewhere, so they do not duplicate or contradict
existing briefs.

This pack (`docs/whop-expansion/`) is the third sibling to:

- **PR #92** — `docs/expansion/` — operator-readiness expansion (11
  features focused on check-ins, coach dashboard widgets, coach AI tone,
  intake templates, public coach profile, starter programs, revenue
  dashboard, team mode).
- **PR #93** — `docs/platform-readiness/` — cross-cutting platform pack
  (release/EAS readiness, feature flags, experiments, role-based nav,
  reusable expansion UI patterns, accessibility, loading/error/empty,
  crash + analytics, API contract compatibility, QA matrix, deep links).
- **PR #94** — `docs/expansion-wave-2/` — coaching feature pack
  (challenges, leaderboards, profile images/avatars, content boards,
  programs/regimens, per-client assignment, messaging surfaces v2,
  progress visibility, tier-gated L2/L3, "do we have this already").

Backend draft PRs referenced by topic (numbers can drift across repos):

- **Backend #117 — AI Program Builder.** LLM gateway and generation
  contract. Already referenced from `docs/expansion/10`, `11`, `18`.
  This pack reuses the same gateway for [10-ai-business-copilot](./10-ai-business-copilot.md).
- **Backend #118 — Team Mode.** Multi-coach roles, permissions, client
  assignment. Already referenced from `docs/expansion/20`. This pack
  inherits the role primitives for offer ownership and revenue split.
- **Backend #119 — Payments engine.** Stripe Connect, payment sessions,
  refunds, disputes. New dependency for this pack — referenced from
  [03-checkout-deposits-subscriptions](./03-checkout-deposits-subscriptions.md).
- **Backend #120 — TGP-balance ledger.** Internal credit system used for
  rewards, bounties, referral payouts, and partial checkout. New
  dependency — referenced from [09-rewards-bounties](./09-rewards-bounties.md)
  and [05-affiliate-referral-dashboards](./05-affiliate-referral-dashboards.md).
- **Backend #121 — Marketplace + slug index.** Public coach catalogue,
  search, slug uniqueness. Builds on the public-profile work doc'd in
  `docs/expansion/16`. Referenced from [01-coach-storefront](./01-coach-storefront.md)
  and [06-coach-marketplace-discovery](./06-coach-marketplace-discovery.md).
- **Backend #122 — Spaces / events service.** Forum threads, RSVP,
  recordings, replays. New dependency — referenced from
  [07-community-spaces](./07-community-spaces.md) and
  [08-events-calls-replays](./08-events-calls-replays.md).
- **Backend #123 — Application/funnel service.** Application form
  schema, status transitions, coach review queue. New dependency —
  referenced from [04-application-funnel](./04-application-funnel.md).

These IDs are starting points for cross-repo links. Re-validate the
exact PR number against the backend repo before committing code.

## Per-feature: what's reused, what's new, what could conflict

### 01 — Coach Storefront

- **Reuses:** `docs/expansion/16` public coach profile (slug, bio,
  photo, deep-link contract). The storefront extends the public
  profile with a list of offers; do not re-spec the profile.
- **Reuses:** `docs/expansion-wave-2/03` profile images & avatars.
- **New:** offer list, price formatting, "Continue with this coach"
  → checkout entry.
- **Conflict risk:** the public profile spec says `?invite=<code>`
  carries through to onboarding. The storefront uses the same slug
  path but routes to checkout for paid offers. The deep-link parser
  must distinguish slug-only vs slug-plus-offer. See HOW in 01.

### 02 — Offer Builder

- **Reuses:** `docs/expansion/18` clone starter programs (offer can
  bundle a program). The builder *references* a program, it does not
  duplicate the program-authoring UI.
- **Reuses:** `docs/expansion-wave-2/05` regimens/programs spec for
  the bundled-content half of an offer.
- **Reuses:** `docs/expansion/14` intake templates as the
  "application form" attached to a paid-funnel offer.
- **New:** offer schema (price, recurrence, deposit, included
  programs, included spaces, application form ref).
- **Conflict risk:** none material; this is a thin authoring surface
  on top of existing primitives.

### 03 — Checkout, deposits, subscriptions

- **Reuses:** `docs/platform-readiness/07` loading/error/empty
  states pattern, applied to a payment surface.
- **Reuses:** `docs/platform-readiness/09` API contract compatibility
  rules (mobile must not parse Stripe objects directly).
- **New:** payment session abstraction, web-fallback flow for unsupported
  payment methods, TGP-balance partial-pay.
- **Conflict risk:** if backend #119 ships before this brief is read,
  re-check the payment-session field shape — this brief is mobile's
  *target* contract, not the negotiated final.

### 04 — Application funnel

- **Reuses:** `docs/expansion/14` intake templates (application form
  schema). The funnel is the *runtime* on top of the templates.
- **Reuses:** `docs/expansion/16` public coach profile + slug.
- **New:** application status state machine, coach review queue UI,
  applicant inbox.
- **Conflict risk:** intake-templates were originally scoped for
  free-coach onboarding. The funnel reuses the schema but adds a
  paid/approve/reject path. Confirm the schema can carry both modes
  before extending it.

### 05 — Affiliate / referral dashboards

- **Reuses:** `docs/expansion/19` coach revenue dashboard for the
  layout pattern. Referral earnings live on the same dashboard
  shape, different data.
- **Reuses:** `docs/expansion-wave-2/02` leaderboards UI for the
  affiliate leaderboard surface.
- **New:** referral link generator, payout ledger view (TGP-balance),
  affiliate-tier display.
- **Conflict risk:** none material.

### 06 — Coach marketplace discovery

- **Reuses:** `docs/expansion/16` public coach profile (every card
  in the marketplace is a profile preview).
- **Reuses:** `docs/expansion-wave-2/03` profile images & avatars.
- **New:** discovery feed, search/filter, featured coach slot, rating
  surface (if shipped — likely v2).
- **Conflict risk:** the public profile brief explicitly defers
  reviews/testimonials. If marketplace ships ratings, that defers
  has to be lifted in `docs/expansion/16`. Coordinate.

### 07 — Community spaces

- **Reuses:** `docs/expansion-wave-2/07` coach-client messaging v2
  primitives (thread/list/composer).
- **Reuses:** `docs/expansion-wave-2/08` progress visibility patterns
  for member presence.
- **New:** space schema, post/comment/reaction surface, moderation
  queue, member roster.
- **Conflict risk:** messaging v2 is 1:1; spaces are 1:many. Do not
  re-implement composer; extract the existing one before touching it.

### 08 — Events, live calls, replays

- **Reuses:** `docs/expansion-wave-2/01` challenges (events are a
  scheduled cousin of challenges — RSVP and reminder primitives can
  be shared).
- **Reuses:** `docs/expansion-wave-2/05` regimens/programs for the
  "replay belongs to a program" linkage.
- **New:** event schema, RSVP, calendar bridge, recording playback,
  replay library.
- **Conflict risk:** native calendar permissions are platform-specific
  and require an `app.json` Info.plist update. Coordinate with
  `docs/platform-readiness/01`.

### 09 — Rewards and bounties

- **Reuses:** `docs/expansion-wave-2/01` challenges (a bounty is a
  challenge with a TGP-balance prize).
- **Reuses:** `docs/expansion-wave-2/02` leaderboards.
- **New:** TGP-balance display surfaces, redemption screens, bounty
  authoring (small extension of challenge authoring).
- **Conflict risk:** the doctrine forbids streak/badge/trophy
  vocabulary (PR #70). Reward UI must use the approved language —
  see HOW in 09.

### 10 — AI Business Copilot

- **Reuses:** `docs/expansion/10` "generate weekly recap" — the
  copilot is the same LLM gateway exposed as a generic surface.
- **Reuses:** `docs/expansion/11` editable AI voice/tone — the copilot
  honours the same setting.
- **New:** copilot home tile, conversation surface, action shortcuts
  ("draft a check-in nudge", "summarise this client's last 4 weeks",
  "suggest an offer price").
- **Conflict risk:** the copilot must not be confused with the
  client-facing AI guide (`AIGuideScreen`). They are distinct
  surfaces with distinct prompts and distinct entitlements.

## What this gap map does not cover

- It does not list every screen file that already exists in `src/`.
  Use `git grep` and `src/screens/coach/README.md` for that.
- It does not list backend OpenAPI endpoints. The backend repo's
  spec is authoritative.
- It does not pre-decide sequencing. Sequencing is a planning-tool
  decision, not a docs decision.
