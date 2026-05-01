# Whop-style expansion pack — coach one-stop-shop

Pre-build documentation for the next slice of mobile work that turns The
Growth Project into a "one-stop-shop for coaches" — the same shape Whop has
for digital creators, adapted to the health-and-wellness coaching primitives
this app already ships (clients, programs, check-ins, messaging).

This pack is a sibling of:

- `docs/expansion/` (PR #92) — operator-readiness expansion (11 features)
- `docs/platform-readiness/` (PR #93) — cross-cutting platform pack
- `docs/expansion-wave-2/` (PR #94) — wave-2 coaching feature pack

It does not replace any of those packs. It assumes the constraints they
established and references them where a feature builds on top of an
already-documented surface.

## Scope

This pack covers **mobile UX specs only** for ten product surfaces that
together let a coach run a business inside the app — not just deliver
sessions, but acquire, convert, retain, monetise, and operate.

| # | File | Title | Primary surface |
| - | ---- | ----- | --------------- |
| 1 | [01-coach-storefront.md](./01-coach-storefront.md) | Coach Storefront — public browse & purchase | Client app |
| 2 | [02-offer-builder.md](./02-offer-builder.md) | Offer Builder — coach-side product authoring | Coach app |
| 3 | [03-checkout-deposits-subscriptions.md](./03-checkout-deposits-subscriptions.md) | Checkout, deposits, and subscriptions | Client app |
| 4 | [04-application-funnel.md](./04-application-funnel.md) | Application funnel — high-ticket gating | Client + coach |
| 5 | [05-affiliate-referral-dashboards.md](./05-affiliate-referral-dashboards.md) | Affiliate / referral dashboards | Client + coach |
| 6 | [06-coach-marketplace-discovery.md](./06-coach-marketplace-discovery.md) | Coach marketplace + discovery | Client app |
| 7 | [07-community-spaces.md](./07-community-spaces.md) | Community spaces (per-coach forums) | Client + coach |
| 8 | [08-events-calls-replays.md](./08-events-calls-replays.md) | Events, live calls, and replays | Client + coach |
| 9 | [09-rewards-bounties.md](./09-rewards-bounties.md) | Rewards and bounties (TGP-balance) | Client + coach |
| 10 | [10-ai-business-copilot.md](./10-ai-business-copilot.md) | AI Business Copilot (coach-side) | Coach app |
| — | [00-gap-map.md](./00-gap-map.md) | Gap map vs PRs #92, #93, #94 and backend #117–#123 | Cross-repo |

## How to use this pack

1. Read [00-gap-map.md](./00-gap-map.md) first. It tells you what is already
   documented elsewhere so you do not duplicate or contradict an existing
   brief. Several of the surfaces in this pack lean on primitives spec'd
   in PRs #92–#94 and backend PRs #117–#123 (referenced by topic, not
   exact ID, since cross-repo numbering can drift).
2. Pick one feature README. Read it end-to-end before opening any code.
3. Confirm the **API contract dependency** is satisfied. Every feature in
   this pack has a backend prerequisite. Mobile must never invent a
   contract; if the contract is not shipped or stubbed in staging, do not
   start the mobile work.
4. Confirm the **feature flag and entitlement** wiring is in place. Every
   feature ships behind a `features.*` flag (dark-launch) and an
   `entitlements.*` gate (which coach tier the feature is available to).
   The two are independent: the flag controls *availability*, the
   entitlement controls *eligibility*.
5. Build to the **MVP** described, not the maximalist version. Every README
   has an explicit "out of scope for v1" section. Respect it; the line
   was drawn deliberately.
6. Update the README as you ship, per `docs/QUIET_LUXURY_DOCTRINE.md` §8.

## Conventions used in every README

- **Status: Pre-build.** None of these features have started.
- **Last reviewed: 2026-05-01.** This is the date the brief was written,
  not a guarantee it is current. Re-validate against `app.json`,
  `src/services/api.ts`, and the backend OpenAPI before committing code.
- Each file answers the same six questions — **WHY, WHEN, WHERE, WHO,
  WHAT, HOW** — followed by screens/navigation, API contracts,
  Stripe/TGP-balance abstraction, loading/error/empty states,
  accessibility, analytics, feature flags + entitlements,
  privacy/moderation, rollout, tests, risks, dependencies, acceptance
  criteria, and operator handoff notes.

## Cross-cutting constraints (do not re-state per feature)

These already apply to every feature in `docs/expansion/`,
`docs/platform-readiness/`, and `docs/expansion-wave-2/`. They are not
repeated in each file in this pack:

- **Expo / EAS identity is fixed.** `owner: the-growth-project`,
  `projectId: 3aeadee6-34c5-4231-85b9-aff9f7ea3c5a`,
  `bundleIdentifier / package: com.growthproject.app`. Never edit these.
- **Theme is single source.** `src/theme/index.ts` — no hardcoded hex,
  no new palette. Bone/forest light theme only.
- **Doctrine: no placeholder chrome.** `docs/QUIET_LUXURY_DOCTRINE.md`
  forbids "coming soon" tiles, fake activity feeds, decorative metrics.
  Empty states must be honest.
- **Tenant safety.** Coach-side screens never request "all" of anything.
  The JWT scopes responses; the client must not assume otherwise.
- **Navigation shape.** Client app has 4 bottom tabs (Home / Log / Plan
  / Profile) with a More stack hung off Profile. Coach app has 5 tabs
  (Clients / Dashboard / Templates / Messages / Settings). New surfaces
  hang off the More stack or live as deep stacks under an existing
  tab; do not add a sixth tab.
- **Stripe abstraction.** Mobile never sees a raw Stripe object. The
  backend exposes a *payment session* abstraction (see
  [03-checkout-deposits-subscriptions.md](./03-checkout-deposits-subscriptions.md)
  §"Stripe / TGP-balance abstraction"); the same abstraction also
  handles TGP-balance redemption so the mobile client treats both
  payment rails identically.
- **Per-module READMEs are mandatory.** Any new screen directory or
  service module added by a feature in this pack ships its own README
  on the same PR.

## What this pack is NOT

- Not a design spec. UX details (spacing, copy, motion) live in Figma and
  `docs/QUIET_LUXURY_DOCTRINE.md`, not here.
- Not a backend spec. API shapes here are mobile's *consumption contract*
  — a checklist of what mobile needs from backend to ship the screen.
  Backend owners may push back on the contract; the spec here is the
  starting point for that negotiation, not the final word.
- Not a project plan. Estimates, sequencing, and ownership belong in the
  team's planning tool, not in the repo.
- Not permission to ship. Each feature still needs a real PR with tests,
  type-checks, and code review.

## Why "Whop-like" matters here

Whop's success with creators came from collapsing acquisition,
conversion, monetisation, retention, and operations into a single
container the creator can show one link to. Coaching has the same
shape: a coach today juggles Instagram (acquisition), DMs (sales),
Stripe (payments), Calendly (scheduling), Discord (community),
Notion (programs), and a handful of tracking apps. This pack is the
mobile half of consolidating those into TGP. The non-mobile half (web
storefront SEO, transactional email, marketplace SEO) is owned by the
web repo and is referenced where it matters.
