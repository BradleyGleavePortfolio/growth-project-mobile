# Expansion map (living)

This file is the living index of where the mobile app is heading. It is rebuilt by editing this README in the same PR that changes the underlying state — never as a separate "tracking" doc.

It exists because the per-feature briefs (PR #92), the platform-readiness pack (PR #93), and the coaching feature pack (PR #94) are large and read in isolation. An operator picking the repo up cold needs one page that answers:

1. What has shipped (DONE).
2. What is documented and queued but not yet built (PREPARED).
3. What is currently being built (CURRENT WAVE).
4. What is on the horizon (FUTURE).

The single source of truth for shipped surfaces remains the root [`README.md`](../../README.md), [`docs/HANDOFF.md`](../HANDOFF.md), and the per-module READMEs under `src/`. This file points at them; it does not replace them.

> Status discipline. Every line item below carries one of: `DONE` (merged to `main`), `PREPARED` (a docs-only PR is open and not merged), `IN PROGRESS` (a draft code PR exists), or `FUTURE` (no PR yet). Do not promote an item until the underlying PR moves.

## Cross-cutting constraints (do not regress)

These are unchanged by anything below. They are the contract any expansion PR is written against.

- Expo managed workflow, SDK ~55, React Native 0.83, Hermes, TypeScript strict.
- EAS identity is immutable: `owner: the-growth-project`, `slug: tgp-health-and-wellness`, `expo.extra.eas.projectId: 3aeadee6-34c5-4231-85b9-aff9f7ea3c5a`, `bundleIdentifier / package: com.growthproject.app`, `scheme: tgp`.
- Theme tokens live in `src/theme/tokens.ts`. Hard-coded colour, type, spacing, radius, or shadow values are rejected at review.
- The quiet-luxury doctrine ([`docs/QUIET_LUXURY_DOCTRINE.md`](../QUIET_LUXURY_DOCTRINE.md)) governs every UI decision. No "Coming Soon", no celebration chrome, no hype copy, no emoji in `src/`. Streak, badge, and trophy vocabulary stays excised (PR #70).
- Client navigation: 4 icons-only bottom tabs (`Home` / `Train` / `Log` / `Profile`) with a `MoreStack` hung off Profile. Coach navigation: 5-tab dashboard. New surfaces extend, never replace, this shape.
- `src/services/api.ts` is the single HTTP entry point. New endpoints are added there with a Zod (or equivalent) parse — never inline in a screen.
- `new-website` is not part of this repo and is out of scope for every item below.

## DONE (merged to `main`)

The shipped surface is described in detail in the root [`README.md`](../../README.md). The most recent operator-facing additions, in roughly reverse chronological order:

| PR | Title | Surface |
| --- | --- | --- |
| #86 | `chore(deps)`: pin SDK-bound dev-dep majors in Dependabot config | CI hygiene. |
| #85 | `fix(onboarding)`: send `carbs_target` instead of `carb_target` | Onboarding wire-format fix. |
| #84 | `feat(coach)`: Help centre entry point + configurable `HELP_BASE_URL` | Coach Help row. |
| #83 | Profile completion: edit screen, home nudge, gating helper | Client profile completion gate. |
| #82 | `chore(eas)`: set Expo owner to `the-growth-project` | EAS identity. |
| #75 | `feat(sentry)`: source-map upload + release identifier | Crash readability in production. |
| #74 | `refactor(theme)`: migrate 45 screens off static `Colors` to `useTheme().colors` | Theme single-source. |
| #70 | `doctrine(vocab)`: excise streak / badge / trophy from icons, types, components, seed data | Vocabulary excision. |
| #68 | `docs`: README parity with shipped surface + every-PR docs rule | Doctrine §8 enforcement. |
| #67 | sale-readiness: AI reachable, lean-onboarding metrics, polished auth, membership surface | Pre-sale client polish. |
| #66 | `feat(coach)`: sale-readiness — billing, account deletion, activity feed, invite share, signup polish | Pre-sale coach polish. |
| #65 | release: doc/code tab fix, expo-notifications plugin, fail-loud publish gate | Release plumbing. |

Anything older lives in `git log --oneline main`. The shipped feature list (calorie / macro tracking, meal plans, recipe library, progress tracking, intermittent fasting, AI guide, coach dashboard, weekly reports) is enumerated in the root [`README.md`](../../README.md#features); per-screen detail in `src/screens/client/README.md` and `src/screens/coach/README.md`.

## PREPARED (docs-only, open, **unmerged**)

These three packs are written ahead of build. They are intentionally docs-only and are **not merged**. Each carries its own README and per-feature briefs. The packs are complementary; brief 10 of `expansion-wave-2` ([`docs/expansion-wave-2/10-do-we-have-this-already.md`](../expansion-wave-2/10-do-we-have-this-already.md), once #94 lands) calls out the adjacencies explicitly.

### PR #92 — operator-readiness expansion pack (`docs/expansion/`, draft)

Eleven mobile-owned (or mobile-facing) features on the 20-step roadmap. Each brief answers WHY / WHEN / WHERE / WHO / WHAT / HOW plus screens, API contract dependency, feature flags, testing, risks, dependencies, acceptance criteria.

- `05-weekly-checkins-client.md` — client-side weekly check-in surface.
- `06-coach-checkins-widget.md` — coach dashboard widget for latest check-ins.
- `08-coach-attention-panel.md` — clients-needing-attention list on the coach dashboard.
- `10-coach-generate-recap.md` — "generate weekly recap" button. Depends on backend PR **#117** (AI Program Builder / LLM gateway).
- `11-coach-ai-voice-tone.md` — editable AI voice / tone controls. Depends on backend PR **#117**.
- `12-ready-to-scale-checklist.md` — coach readiness checklist UI.
- `14-intake-templates.md` — intake templates inside invite / onboarding.
- `16-public-coach-profile.md` — public coach profile + deep-link contract.
- `18-clone-starter-programs.md` — clone-from-template flow. Depends on backend PR **#117**.
- `19-coach-revenue-dashboard.md` — coach revenue dashboard.
- `20-team-mode-mobile.md` — team mode (roles, permissions, junior coach UX). Depends on backend PR **#118** (Team Mode).

### PR #93 — platform-readiness pack (`docs/platform-readiness/`, draft)

Cross-cutting platform capabilities the next wave needs. Companion to #92.

- `01-mobile-release-and-eas-readiness.md`
- `02-feature-flag-consumption.md` — single `useFlag()` contract over PostHog.
- `03-experiment-and-update-channels.md` — A/B + (optional) OTA channel model.
- `04-role-based-navigation-architecture.md` — junior / head coach without rewriting `RootNavigator`. Depends on backend PR **#118**.
- `05-reusable-expansion-ui-patterns.md`
- `06-accessibility-readiness.md`
- `07-loading-error-empty-states.md` — `AsyncBoundary` contract for query-backed screens.
- `08-crash-and-analytics-readiness.md` — Sentry tags + PostHog event registry + redaction policy.
- `09-api-contract-compatibility.md` — version headers, capability flags, Zod parsing. Depends on backend PR **#117** / **#118** / **#119**.
- `10-mobile-qa-matrix.md`
- `11-deep-links-readiness.md` — adding routes without breaking `tgp://join/<code>`.

### PR #94 — coaching feature wave (`docs/expansion-wave-2/`, draft)

Coach-facing wave 2 features. Built on top of #92 and #93 contracts.

- `01-coach-fitness-challenges.md`
- `02-leaderboards-public-private.md`
- `03-profile-images-and-avatars.md`
- `04-coach-content-boards.md`
- `05-coach-regimens-programs.md`
- `06-per-client-assignment.md` — unifying `Assignment` across programs / content / challenges.
- `07-coach-client-messaging-surfaces.md`
- `08-progress-visibility.md`
- `09-tier-gated-l2-l3.md` — `useEntitlement()` contract + `UpgradePromptRow`.
- `10-do-we-have-this-already.md` — gap analysis vs #92 / #93 / shipped surface; read this first.

### Backend dependencies (cross-repo, draft / unmerged)

The mobile briefs above reference these backend PRs as hard dependencies. They live in the API repo, not this one. None is merged at the time this map was written.

| Backend PR | Mobile briefs that depend on it |
| --- | --- |
| **#117 — AI Program Builder / LLM gateway** | `expansion/10`, `expansion/11`, `expansion/18`, `platform-readiness/03`, `platform-readiness/09`. |
| **#118 — Team Mode** | `expansion/20`, `platform-readiness/04`, `platform-readiness/09`. |
| **#119 — third backend pre-work PR** | `platform-readiness/09`. |
| **#120 — backend pre-work, in scope for current wave** | (placeholder; mobile briefs that consume it land in CURRENT WAVE below.) |
| **#121 — backend pre-work, in scope for current wave** | (placeholder.) |
| **#122 — backend pre-work, in scope for current wave** | (placeholder.) |
| **#123 — backend pre-work, in scope for current wave** | (placeholder.) |

A mobile feature does not start until the backend PR it depends on is at least merged behind a feature flag. The flag is then gated by `useFlag()` per `platform-readiness/02-feature-flag-consumption.md`.

## CURRENT WAVE (in progress)

The current wave moves the app from "coaching tool with logging" to a one-stop-shop for coaches and their clients — close in spirit to platforms like [Whop](https://whop.com), but built on top of the existing nutrition / training / coach surface. The mobile pack is being written; backend PRs **#120**–**#123** carry the server-side work for the items below.

> Status. Briefs are being drafted. PR numbers may not exist yet. When a brief lands as its own draft PR, it should be linked from this section in the same PR that opens it.

Strategic context (one-stop-shop for coaches):

- A coach should be able to operate their entire business inside the app: storefront, offers, checkout, subscriptions, applications, affiliates, marketplace presence, community, events / calls / replays, rewards / bounties, and an AI business copilot.
- Inspiration is drawn from the operator UX of platforms like Whop ([whop.com](https://whop.com), [whop.com/whops](https://whop.com/whops)). The intent is *not* to clone the marketplace mechanics; it is to compress the toolchain a coach currently runs across Stripe + Calendly + Discord + Notion + email into a single coherent surface.
- The doctrine still wins. No marketplace chrome, no hype copy, no celebration animations, no "Coming Soon" — every surface either ships against a real backend or stays hidden.
- All surfaces below extend the existing 4-tab client + 5-tab coach navigation. None add a new top-level tab.

Items in flight, in alphabetical order. Each will become its own brief under `docs/expansion-wave-3/` (or equivalent) with the same WHY / WHEN / WHERE / WHO / WHAT / HOW shape as #92 / #93 / #94.

- **AI business copilot** — coach-facing assistant that answers "where is my business this week" by reading the same projections coach reports use. Shares LLM gateway with backend PR #117. Surfaces: a row in the coach `MoreStack`, a card on the coach dashboard.
- **Affiliates** — referral link generation, payout tracking, attribution windows. Coach-side first; client-side share affordances follow.
- **Applications** — gated intake where prospective clients apply before checkout. Builds on `expansion/14-intake-templates.md`.
- **Checkout, deposits, and subscriptions** — in-app purchase / external checkout brokerage, plan tiers, deposits for high-touch coaching, Stripe-style subscription state mirrored in the client.
- **Communities** — coach-owned community surface (threads, pinned posts, broadcasts). Reuses the messaging primitives in `expansion-wave-2/07-coach-client-messaging-surfaces.md`.
- **Events, calls, and replays** — scheduled live calls, replays, calendar sync. Replaces ad-hoc Calendly links.
- **Marketplace presence** — public-facing coach storefront discoverable from a directory. Builds on `expansion/16-public-coach-profile.md`.
- **Offers** — coach-authored packaged offers (program + community + calls + content board). Builds on `expansion-wave-2/05-coach-regimens-programs.md` and `expansion-wave-2/04-coach-content-boards.md`.
- **Rewards and bounties** — non-trophy, non-celebration redemption surface for client actions (referrals, attendance). Doctrine §3 still applies — no celebration chrome.
- **Storefronts** — the public-facing surface that ties offers, applications, and checkout together. Server-side state lives in backend PR #121 (placeholder).

Backend pre-work for the current wave is tracked in PRs **#120**–**#123** (cross-repo). Mobile briefs land first; mobile code lands behind feature flags after the corresponding backend PR is at least merged behind its own flag, per `platform-readiness/02`.

## FUTURE PLANS

The items below are tracked but not yet briefed. They are listed so an operator does not propose them as new ideas without checking. None has a PR.

- **Internationalisation** — copy externalisation, locale-aware number / date / nutrition formatting, RTL audit. Currently every shipped string is English-only.
- **Offline-first sync for logging surfaces** — local-first writes with conflict resolution against the API. Today the SQLite layer is mostly read-cache + per-device data; meal plans and weight syncs are online-only.
- **Native widgets** — iOS WidgetKit and Android `AppWidgetProvider` surfaces for today's macros / fasting timer. The `Widgets` route in `MoreStack` is currently a settings-only surface.
- **Wearable integrations** — Apple Health / Google Fit / Garmin / Whoop ingestion for weight, steps, HRV, sleep. Today nutrition logs are manual.
- **Coach team economics** — junior-coach payouts, head-coach overrides, multi-coach revenue splits. Sits on top of `expansion/20-team-mode-mobile.md`.
- **Public review / testimonial surfaces** — moderated client testimonials surfaced on storefronts. Privacy contract still to be written.
- **Live group classes** — many-to-many synchronous video. Distinct from one-to-one calls in the current wave.
- **Programmatic content licensing** — paid distribution of a coach's programs to other coaches. Sits on top of `expansion-wave-2/05` and the marketplace work in the current wave.

Each future item gets its own brief before it gets its own code PR. The brief comes first; this is enforced by doctrine §8 ("every PR updates the corresponding README") and enforced again by the PR template.

## Mobile operator guidance

If you are picking this repo up cold:

1. Read the root [`README.md`](../../README.md) — shipped surface, environment variables, navigation shape.
2. Read [`docs/HANDOFF.md`](../HANDOFF.md) — the single reference for env vars, the `app.json` shape, the auth state machine, the AI context contract, the deep-link parser, the design tokens, the Play Internal Testing checklist, and open verification gaps.
3. Read [`docs/QUIET_LUXURY_DOCTRINE.md`](../QUIET_LUXURY_DOCTRINE.md). It is short and it is binding.
4. Read this map for everything that is not yet on `main`.

If you are picking up a feature listed under PREPARED or CURRENT WAVE:

1. Find the corresponding brief PR (#92 / #93 / #94 / current-wave PR) and read the per-feature file.
2. Confirm the backend PR it depends on (where listed) is merged behind a flag.
3. Open a draft code PR. Wire the surface behind a `useFlag()` gate per `platform-readiness/02`. Add screens under the existing navigation shape — no new top-level tab.
4. Update this map in the same PR that lands the code: move the line from `PREPARED` / `CURRENT WAVE` to `DONE` and link the merged PR.

If a brief contradicts the doctrine, the doctrine wins and the brief gets edited. If a brief contradicts the shipped surface, the brief gets edited. If a brief contradicts a backend contract, the brief gets edited. The map is downstream of all three.

## What this file is not

- Not a roadmap commitment. Sequencing belongs in the team's planning tool. PR numbers and statuses are facts; ordering between sections is a hint.
- Not a backend specification. Backend dependencies are cited by PR number; the contracts live in the API repo.
- Not a marketing document. Hype copy ("a Whop-style platform that revolutionises coaching") is not the register of this file. The register is the same as `docs/HANDOFF.md`: plain, concrete, citable.
- Not a substitute for the per-feature briefs. Anyone implementing a listed item still has to read the brief.

## How to update this file

This file changes in lockstep with state. Concretely:

- A docs-only pack opens as a draft PR → add it to PREPARED with status `draft`.
- A docs-only pack merges → leave it under PREPARED but change the status, or move per-item briefs into CURRENT WAVE as their own PRs are opened.
- A code PR for a briefed item opens → move the brief from PREPARED to CURRENT WAVE with status `IN PROGRESS` and the code PR number.
- A code PR merges → move the line into the DONE table with the PR number and a one-line surface summary.
- A planned item is dropped → remove it from FUTURE; do not leave a "removed" entry. The git history is the record.

This file should never carry stale entries. If you are reading it and it is wrong, fix it in your next PR.
