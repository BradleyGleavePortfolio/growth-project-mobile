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

## Wave 1–10 status table (single page)

The settled wave taxonomy (per [`docs/waves-6-10/00-wave-crosswalk.md`](../waves-6-10/00-wave-crosswalk.md), PR **#99**). This table is the single-page status view for an operator picking up the repo cold. Sections below give per-PR detail.

| Wave | Theme | Canonical mobile pack | Status | Backend dependency | Key OWNER decisions |
| ---- | ----- | --------------------- | ------ | ------------------ | ------------------- |
| **1** | Operator readiness — coach widgets, check-ins, intake, public profile, revenue dashboard, team mode, AI tone | `docs/expansion/` (PR **#92**) | PREPARED (docs draft) | Backend operator-readiness pack; PR **#117** for AI items, PR **#118** for team mode | Tier-gated L2/L3 (Wave 2 brief 09) gates several items |
| **2** | Coaching feature pack — challenges, leaderboards, content boards, programs, assignments, messaging v2, progress visibility | `docs/expansion-wave-2/` (PR **#94**) | PREPARED (docs draft) | Backend coaching wave 2; reuses Wave 1 / 3 primitives | Avatars, public-vs-private leaderboards |
| **3** | Platform readiness — release/EAS, feature flags, experiments, role-based nav, accessibility, error / empty / loading patterns, analytics, deep links, QA matrix | `docs/platform-readiness/` (PR **#93**) | PREPARED (docs draft) | Backend PRs **#117** / **#118** / **#119** for API contract compatibility | OTA channel split |
| **4** | Mobile mirror of backend Wave 2 — progression UX, onboarding flows, AI coach copilot, ORG mode extension | `docs/product/` (PR **#98**) | PREPARED (docs draft) | Backend Wave 2 (`progression-mobile-ux.md`, `onboarding-client-coach.md`, `sub-coach-hierarchy.md`); AI gateway already live | None outstanding |
| **5** | Role-experience contract — client / coach / admin app split; dedicated coach bundle (future); role switching | `docs/role-experience/` (PR **#97**) | PREPARED (docs draft) | Backend Wave 2 (sub-coach hierarchy) | Coach bundle split (deferred to Wave 11+) |
| **6** | App architecture, admin install UX, sub-coach install consent, permission prompts, navigation refactor | `docs/waves-6-10/06-...` (PR **#99**) | PREPARED (docs draft) | Backend Wave 3 admin lifecycle + PR **#118** Team Mode | 6.A bundle split, 6.B admin companion day-one, 6.C Install location, 6.D biometric for sub-coach approval |
| **7** | Discovery marketplace — coach catalogue, search, public proof | `docs/waves-6-10/07-...` (PR **#99**); reuses `docs/whop-expansion/06-...` (PR **#96**) | PREPARED (docs draft) | Backend marketplace + slug index (PR **#121**) | 7.A ratings, 7.B geolocation, 7.C client-count stat, 7.D client browse default |
| **8** | Content rewards / affiliate — submission, review, balance, redemption, attribution, payouts | `docs/waves-6-10/08-...` (PR **#99**); reuses `docs/whop-expansion/05-...`, `09-...` (PR **#96**) | PREPARED (docs draft) | Backend TGP-balance ledger (PR **#120**) + payments engine (PR **#119**) | 8.A coach-vs-platform rewards, 8.B leaderboard, 8.C fiat-vs-points, 8.D show payouts, 8.E consent renewal |
| **9** | Storefront builder + funnel analytics — buyer flow, application, checkout, coach analytics | `docs/waves-6-10/09-...` (PR **#99**); reuses `docs/whop-expansion/01-...`, `02-...`, `03-...`, `04-...` (PR **#96**) | PREPARED (docs draft) | Backend storefront + funnel + applications (PRs **#121** / **#123**) + payments engine (**#119**) | 9.A mobile authoring, 9.B refunds, 9.C schema versioning, 9.D draft persistence, 9.E checkout amount override |
| **10** | Community / chat doctrine — rooms, cohorts, announcements, voice notes, member directory, AI business copilot | `docs/waves-6-10/10-...` (PR **#99**); reuses `docs/whop-expansion/07-...`, `08-...`, `10-...` (PR **#96**) | PREPARED (docs draft) | Backend spaces / events service (PR **#122**) + AI gateway (PR **#117**) | 10.A reactions vs acknowledgements, 10.B voice pre-download, 10.C directory default, 10.D mentions, 10.E client-to-client DMs, 10.F transcripts, 10.G sub-coach posting, 10.H cohort archive |

> Status discipline (waves edition). The wave taxonomy is taxonomy; the per-PR status is state. A wave's status is the *worst* status of the PRs that compose it: if any of its canonical PRs is still draft, the wave is `PREPARED`. The wave promotes to `IN PROGRESS` when at least one runtime PR is open against it; it promotes to `DONE` when every Phase entry in [`docs/waves-6-10/99-implementation-order-and-risks.md`](../waves-6-10/99-implementation-order-and-risks.md) has merged.

### Phase A (audit-finding fixes — runtime PRs scheduled before any Wave 6+ feature)

Documented in [`docs/waves-6-10/99-implementation-order-and-risks.md`](../waves-6-10/99-implementation-order-and-risks.md) Phase A. None has a runtime PR yet; all are `FUTURE` until opened. They are mirrored here so an operator does not start a Wave 6+ feature ahead of them:

1. Split `src/screens/coach/ClientDetailScreen.tsx` (currently 2,329 lines) into `ClientDetailStack/`. (Wave 6.)
2. Regroup `src/screens/client/MoreScreen.tsx` (currently 18-row flat list) into Plan / Track / Learn / Account sections. (Wave 6.)
3. Remove the static streak placeholder at `src/screens/client/ProfileScreen.tsx:131`. (Wave 4 / 6.)
4. Replace the `workoutDone = false` placeholder at `src/screens/client/HomeScreen.tsx:148` with a real query against the Wave 4 endpoint. (Wave 4 / 6.)
5. Introduce `PermissionPromptModal` and migrate every existing permission entry point onto it. (Wave 6.)

### Cross-repo dependency table (compact)

| Backend PR / wave | Blocks mobile waves |
| ----------------- | ------------------- |
| Backend **#117** AI Program Builder / LLM gateway | 1 (briefs 10/11/18), 4 (AI copilot), 10 (transcripts + business copilot) |
| Backend **#118** Team Mode | 1 (brief 20), 5 (ORG mode), 6 (sub-coach install), 8 (sub-coach review scope), 10 (sub-coach posting scope) |
| Backend **#119** Payments engine | 8 (payouts), 9 (checkout / subscriptions / refunds) |
| Backend **#120** TGP-balance ledger | 8 (balance, redemption, affiliate payouts) |
| Backend **#121** Marketplace + slug index | 7 (every surface), 8 (affiliate link slug), 9 (storefront slug) |
| Backend **#122** Spaces / events service | 10 (every surface) |
| Backend **#123** Application / funnel service | 9 (applications + funnel analytics) |
| Backend Wave 2 (progression) | 4 (progression mobile UX) |
| Backend Wave 2 (sub-coach hierarchy) | 5 (ORG mode) |
| Backend Wave 3 (admin lifecycle) | 6 (Install consent endpoints, admin companion) |

PR numbers are starting points and may drift; mobile re-validates at runtime PR open.

### Finance dependency table (compact)

| Mobile surface | Finance dependency | Posture |
| -------------- | ------------------ | ------- |
| Wave 8 affiliate payouts | Stripe Connect (or equivalent) onboarded per coach via web | Honest message on mobile when not set up |
| Wave 8 balance redemption | TGP-balance ledger backed by fiat reserve | Owner-side; mobile is read-only consumer |
| Wave 9 checkout | Payments engine + tax calculation | Single-currency offers; native pay first; web fallback for unsupported methods |
| Wave 9 refunds | Payments engine | Web-only authoring; mobile read-only |
| Wave 10 AI transcripts | Metered LLM cost; coach plan tier gates | Honest empty if not entitled |

### OWNER_DECISION register (consolidated)

24 decisions across Waves 6–10, each with a recommendation. Centralised in [`docs/waves-6-10/99-implementation-order-and-risks.md`](../waves-6-10/99-implementation-order-and-risks.md) §"OWNER_DECISION register". Wave 1–5 surfaces do not carry open OWNER_DECISIONs as of this revision.

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

These seven packs are written ahead of build. They are intentionally docs-only and are **not merged**. Each carries its own README and per-feature briefs. The packs are complementary; brief 10 of `expansion-wave-2` ([`docs/expansion-wave-2/10-do-we-have-this-already.md`](../expansion-wave-2/10-do-we-have-this-already.md), once #94 lands) calls out the adjacencies vs the original three packs, and [`docs/waves-6-10/00-wave-crosswalk.md`](../waves-6-10/00-wave-crosswalk.md) (PR #99) is the single source of truth for how all seven packs map onto Waves 1–10.

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

### PR #96 — Whop-style coach one-stop-shop pack (`docs/whop-expansion/`, draft)

Ten one-stop-shop briefs, source material for Waves 7–10. Re-mapped onto the Wave 1–10 taxonomy in PR #99 [`docs/waves-6-10/00-wave-crosswalk.md`](../waves-6-10/00-wave-crosswalk.md). Read the wave file in PR #99 alongside the matching #96 brief; this pack supplies the depth, the wave file supplies the wave-level mobile contract.

- `01-coach-storefront.md` — Wave 9.
- `02-offer-builder.md` — Wave 9.
- `03-checkout-deposits-subscriptions.md` — Wave 9.
- `04-application-funnel.md` — Wave 9.
- `05-affiliate-referral-dashboards.md` — Wave 8.
- `06-coach-marketplace-discovery.md` — Wave 7.
- `07-community-spaces.md` — Wave 10.
- `08-events-calls-replays.md` — Wave 10.
- `09-rewards-bounties.md` — Wave 8.
- `10-ai-business-copilot.md` — Wave 10.

### PR #97 — role-experience contract (`docs/role-experience/`, draft)

Wave 5. Defines the client / coach / admin role split, the dedicated coach bundle as future state, and the admin mobile companion as opt-in only.

- `01-client-app.md`
- `02-coach-app.md`
- `03-admin-companion.md`

### PR #98 — Wave 4 mobile mirror (`docs/product/`, draft)

Wave 4. Mobile mirror for backend Wave 2 product work.

- `role-experience-extension-org-mode.md` — extends #97 to add ORG mode for head coaches managing sub-coaches.
- `progression-mobile-ux.md` — retention progression UX. Hard dependency on backend `progression-mobile-ux.md`.
- `onboarding-mobile-flows.md` — client + coach onboarding on mobile.
- `whop-ai-coach-copilot-mobile.md` — coach AI copilot UX (weekly recap, at-risk-client alert, program builder).

### PR #99 — Waves 6–10 consolidated mobile mirror (`docs/waves-6-10/`, draft)

Waves 6–10. Fills the architectural and consent gaps the earlier packs did not cover; provides the Wave 1–10 crosswalk; centralises the OWNER_DECISION register.

- `README.md` — pack overview, persona contract.
- `00-wave-crosswalk.md` — Wave 1–10 taxonomy crosswalk. **Single source of truth for which existing PR covers which wave.**
- `06-app-architecture-and-admin-install.md` — Wave 6: architecture refactor + Install surface + permissions.
- `07-discovery-marketplace.md` — Wave 7.
- `08-content-rewards-and-affiliate.md` — Wave 8.
- `09-storefront-builder-and-funnel-analytics.md` — Wave 9.
- `10-community-rooms-and-chat-doctrine.md` — Wave 10.
- `99-implementation-order-and-risks.md` — phased implementation (Phase A audit fixes through Phase H community), centralised OWNER_DECISION register, cross-repo + finance dependency maps, risk register.

### Backend dependencies (cross-repo, draft / unmerged)

The mobile briefs above reference these backend PRs as hard dependencies. They live in the API repo, not this one. None is merged at the time this map was written.

| Backend PR | Mobile briefs that depend on it |
| --- | --- |
| **#117 — AI Program Builder / LLM gateway** | Wave 1 (`expansion/10`, `11`, `18`), Wave 3 (`platform-readiness/03`, `09`), Wave 4 (`product/whop-ai-coach-copilot-mobile.md`), Wave 10 (`waves-6-10/10-...` AI business copilot + voice transcripts). |
| **#118 — Team Mode** | Wave 1 (`expansion/20`), Wave 3 (`platform-readiness/04`, `09`), Wave 5 (`role-experience/02`), Wave 4 (`product/role-experience-extension-org-mode.md`), Wave 6 (`waves-6-10/06-...` sub-coach install), Wave 8 (`waves-6-10/08-...` sub-coach review scope), Wave 10 (`waves-6-10/10-...` sub-coach posting scope). |
| **#119 — Payments engine** | Wave 3 (`platform-readiness/09`), Wave 8 (`waves-6-10/08-...` payouts), Wave 9 (`waves-6-10/09-...` checkout / subscriptions / refunds). |
| **#120 — TGP-balance ledger** | Wave 8 (`waves-6-10/08-...` balance, redemption, affiliate payouts). |
| **#121 — Marketplace + slug index** | Wave 7 (`waves-6-10/07-...`), Wave 8 (affiliate link slug attribution), Wave 9 (`waves-6-10/09-...` storefront slug binding). |
| **#122 — Spaces / events service** | Wave 10 (`waves-6-10/10-...` rooms, cohorts, announcements, voice notes, member directory). |
| **#123 — Application / funnel service** | Wave 9 (`waves-6-10/09-...` applications, funnel analytics, applicants queue). |
| **Backend Wave 2 — progression** | Wave 4 (`product/progression-mobile-ux.md`); Phase A audit-fix item 4 (`HomeScreen.workoutDone` real query). |
| **Backend Wave 2 — sub-coach hierarchy** | Wave 5 (`role-experience/02-coach-app.md` ORG mode), Wave 4 (`product/role-experience-extension-org-mode.md`). |
| **Backend Wave 3 — admin lifecycle** | Wave 6 (`waves-6-10/06-...` Install consent endpoints, optional admin companion). |

A mobile feature does not start until the backend PR it depends on is at least merged behind a feature flag. The flag is then gated by `useFlag()` per `platform-readiness/02-feature-flag-consumption.md`.

## CURRENT WAVE (in progress)

The current wave moves the app from "coaching tool with logging" to a one-stop-shop for coaches and their clients — close in spirit to platforms like [Whop](https://whop.com), but built on top of the existing nutrition / training / coach surface. The mobile pack is being written; backend PRs **#120**–**#123** carry the server-side work for the items below.

> Status. The wave-spanning briefs landed as PR **#96** (Whop-style one-stop-shop, ten briefs) and PR **#99** (Waves 6–10 consolidated mobile mirror, eight briefs). Both are draft and unmerged. The Wave 1–10 status table above is the single-page view; the per-pack PREPARED entries are the depth.

Strategic context (one-stop-shop for coaches):

- A coach should be able to operate their entire business inside the app: storefront, offers, checkout, subscriptions, applications, affiliates, marketplace presence, community, events / calls / replays, rewards / bounties, and an AI business copilot.
- Inspiration is drawn from the operator UX of platforms like Whop ([whop.com](https://whop.com), [whop.com/whops](https://whop.com/whops)). The intent is *not* to clone the marketplace mechanics; it is to compress the toolchain a coach currently runs across Stripe + Calendly + Discord + Notion + email into a single coherent surface.
- The doctrine still wins. No marketplace chrome, no hype copy, no celebration animations, no "Coming Soon" — every surface either ships against a real backend or stays hidden.
- All surfaces below extend the existing 4-tab client + 5-tab coach navigation. None add a new top-level tab.

Items in flight, grouped by wave. Each is briefed in PR #96 (`docs/whop-expansion/`) and / or PR #99 (`docs/waves-6-10/`). The wave file (PR #99) is the canonical mobile contract; the #96 brief supplies the depth.

**Wave 6 — App architecture, install consent, permission prompts** (`docs/waves-6-10/06-app-architecture-and-admin-install.md`):

- `ClientDetailScreen` → `ClientDetailStack` refactor (audit-finding fix, Phase A).
- `MoreScreen` regrouping (audit-finding fix, Phase A).
- `PermissionPromptModal` primitive (Phase A).
- `Install` surface for optional modules (storefront, marketplace, community, affiliate, copilot).
- Sub-coach install request / approve flow (depends on Team Mode, backend PR #118).
- Optional admin mobile companion (per Wave 5 #97 `03-admin-companion.md`).

**Wave 7 — Discovery marketplace** (`docs/waves-6-10/07-...`, builds on `whop-expansion/06-...`):

- Pre-auth `PublicMarketplaceStack` with home / categories / search / coach card / public proof.
- Coach-side card editor (under Wave 6 `Install → Marketplace presence`).

**Wave 8 — Content rewards + affiliate** (`docs/waves-6-10/08-...`, builds on `whop-expansion/05-...` and `09-...`):

- Coach `RewardsReviewQueue` and review mutations.
- Client `SubmitReward` with offline media queue.
- `Balance` row + redemption surface.
- Affiliate enrolment, `AffiliateHome`, `ReferralLinks`, `AttributionLedger`, `PayoutHistory`.
- Public-proof opt-in surface (cross-cuts to Wave 7).

**Wave 9 — Storefront builder + funnel analytics** (`docs/waves-6-10/09-...`, builds on `whop-expansion/01–04`):

- Buyer flow: `StorefrontDetail` → `OfferDetail` → `ApplicationForm` → `CheckoutSession` (PaymentSheet + web fallback) → `PostCheckoutWelcome` (bridges to Wave 4 onboarding).
- Coach `ApplicantsQueue` + `ApplicantDetail` + approve/reject mutations.
- `FunnelAnalyticsCard`, `StorefrontPreviewCard`, read-only `StorefrontSummary` (mobile is read-only on storefront authoring per OWNER_DECISION-9.A).

**Wave 10 — Community / chat doctrine** (`docs/waves-6-10/10-...`, builds on `whop-expansion/07`, `08`, `10`):

- Rooms / cohorts / DMs split (DMs unchanged).
- Posts + replies + acknowledgements (no per-user list, no reactions, no mentions v1).
- Announcements (one-way coach broadcast).
- Voice notes with optional AI transcripts.
- `MemberDirectory` (opt-in, default off).
- Coach moderation surface.
- AI business copilot (coach-only).

Backend pre-work for the current wave is tracked in PRs **#117**–**#123** (cross-repo). Mobile briefs land first; mobile code lands behind feature flags after the corresponding backend PR is at least merged behind its own flag, per `platform-readiness/02`. The phased order (Phase A through Phase H) is in [`docs/waves-6-10/99-implementation-order-and-risks.md`](../waves-6-10/99-implementation-order-and-risks.md).

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
