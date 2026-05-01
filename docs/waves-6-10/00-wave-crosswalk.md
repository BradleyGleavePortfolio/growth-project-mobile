# 00 — Wave 1–10 crosswalk (mobile)

**Status:** Pre-build, docs-only.
**Last reviewed:** 2026-05-01.
**Purpose:** Resolve the parallel-lane problem. Until this file lands, Waves 1–10 were tracked as a list of draft PRs (`#92`, `#93`, `#94`, `#95`, `#96`, `#97`, `#98`) that did not share a wave taxonomy. Picking up cold required reading all seven READMEs to figure out where a feature lived. This file is the single source of truth for "which wave is which, and where does it live".

## The taxonomy (settled)

| Wave | Theme | Mobile pack(s) | Backend lane |
| ---- | ----- | -------------- | ------------ |
| **Wave 1** | Operator readiness — coach widgets, check-ins, intake, public profile, revenue dashboard, team mode, AI tone | `docs/expansion/` (PR #92) | Backend operator-readiness pack |
| **Wave 2** | Coaching feature pack — challenges, leaderboards, content boards, programs, assignments, messaging v2, progress visibility, tier-gated L2/L3 | `docs/expansion-wave-2/` (PR #94) | Backend coaching wave 2 |
| **Wave 3** | Platform readiness — release/EAS, feature flags, experiments, role-based nav, reusable patterns, accessibility, loading/error/empty, crash + analytics, API contract compatibility, QA matrix, deep links | `docs/platform-readiness/` (PR #93) | Backend platform pack |
| **Wave 4** | Mobile mirror of backend Wave 2 — progression UX, onboarding flows, AI coach copilot UX, role-experience extension for org mode | `docs/product/` (PR #98) | Backend Wave 2 (`docs/product/`) |
| **Wave 5** | Role-experience contract — client / coach / admin app split, dedicated coach bundle (future), role switching | `docs/role-experience/` (PR #97) | Backend Wave 2 (sub-coach hierarchy) |
| **Wave 6** | App architecture, admin install UX, sub-coach install consent, permission prompts, navigation refactor | `docs/waves-6-10/06-...` (this pack) | Backend Wave 3 (admin lifecycle) |
| **Wave 7** | Discovery marketplace — coach catalogue, search, filters, public proof surface | `docs/waves-6-10/07-...` (this pack) + `docs/whop-expansion/06-...` (PR #96, reused) | Backend marketplace + slug index |
| **Wave 8** | Content rewards / affiliate — content reward submission, affiliate / referral dashboards, attribution, payouts | `docs/waves-6-10/08-...` (this pack) + `docs/whop-expansion/05-...`, `09-...` (PR #96, reused) | Backend TGP-balance ledger + payments engine |
| **Wave 9** | Storefront builder + funnel analytics — preview / hand-off, builder editor (web-primary), funnel analytics dashboards | `docs/waves-6-10/09-...` (this pack) + `docs/whop-expansion/01-...`, `02-...`, `04-...` (PR #96, reused) | Backend storefront + funnel + applications |
| **Wave 10** | Community / chat doctrine — rooms / cohorts, announcements, voice notes, member directory, chat doctrine, AI business copilot | `docs/waves-6-10/10-...` (this pack) + `docs/whop-expansion/07-...`, `08-...`, `10-...` (PR #96, reused) | Backend spaces / events service + AI gateway |

## The settled rule for cross-references

A feature has *one* canonical brief and zero or more references. The crosswalk above names the canonical brief. Any other mention is a reference and must link to the canonical.

If two briefs disagree, the **canonical wins** and the reference is edited in a follow-up PR. Doctrine still wins over both.

## Per-existing-PR placement

| PR | Title | Wave | Role in the wave |
| -- | ----- | ---- | ---------------- |
| #92 | `docs(expansion)` operator-readiness | **Wave 1** | Canonical. Ten coach-side surfaces + team-mode mobile spec. |
| #93 | `docs(platform-readiness)` | **Wave 3** | Canonical. Cross-cutting platform pack. Referenced from Waves 1, 2, 4, 5, 6, 7, 8, 9, 10. |
| #94 | `docs(expansion-wave-2)` coaching feature pack | **Wave 2** | Canonical. Ten feature briefs + gap analysis. |
| #95 | `docs(expansion-map)` living index | **Index** | Cross-wave. Updated in lockstep with this pack to gain Wave 1–10 status table. |
| #96 | `docs(whop-expansion-mobile)` | **Waves 7, 8, 9, 10 (partial)** | Reused, not canonical. The ten one-stop-shop briefs in #96 are the *source material* for Waves 7–10 mobile mirrors. The wave files in this pack name them as references and add the gaps they did not cover. |
| #97 | `docs(role-experience-spec)` | **Wave 5** | Canonical. Client / coach / admin role split. |
| #98 | `docs(wave-4-mobile-mirror)` | **Wave 4** | Canonical. Mobile mirror for backend Wave 2 (progression, onboarding, AI copilot, ORG mode). |
| **(this pack)** | `docs(waves-6-10-mobile-mirror)` | **Waves 6, 7, 8, 9, 10** | Canonical. Five wave specs + crosswalk + implementation order. |

## How #96 maps onto Waves 7–10

PR #96 was authored as a Whop-style one-stop-shop pack. The ten briefs in it are good and stay; this pack does not rewrite them. It groups them under the Wave 7–10 taxonomy and adds the gaps the user's framing called for:

| #96 brief | Lives under | What this pack adds |
| --------- | ----------- | ------------------- |
| `01-coach-storefront.md` | **Wave 9** (storefront builder) | Mobile-side builder *preview*, hand-off contract to web editor, sub-coach gating, OWNER_DECISION on whether mobile authors storefronts at all. |
| `02-offer-builder.md` | **Wave 9** | Mobile-side builder *preview* + read-only mode for sub-coaches. |
| `03-checkout-deposits-subscriptions.md` | **Wave 9** | (Already complete in #96. Wave 9 file references it; does not re-spec.) |
| `04-application-funnel.md` | **Wave 9** (funnel analytics) | Funnel-analytics dashboard contract — applicants → approved → enrolled, drop-off cards. |
| `05-affiliate-referral-dashboards.md` | **Wave 8** | Ambassador / affiliate persona contract; consent-based public attribution; payout ledger. |
| `06-coach-marketplace-discovery.md` | **Wave 7** | Filter / search contract, featured-coach slot, public proof surface, OWNER_DECISION on ratings. |
| `07-community-spaces.md` | **Wave 10** | Rooms vs cohorts vs DMs split; announcements; voice notes; member directory; chat doctrine. |
| `08-events-calls-replays.md` | **Wave 10** | Reused as-is. Wave 10 references it; does not re-spec. |
| `09-rewards-bounties.md` | **Wave 8** | Content reward *submission* surface (the audit gap), TGP-balance redemption screens. |
| `10-ai-business-copilot.md` | **Wave 10** (operator copilot) | Reused as-is. Wave 10 references it; does not re-spec. |

## How #98 (Wave 4) and #97 (Wave 5) interact with Wave 6

Wave 6 (app architecture, admin install UX, permission prompts) is the operator backbone for Waves 7–10. Specifically:

- Wave 6 §"Sub-coach install consent" depends on the role primitives in Wave 5 (#97 `02-coach-app.md`) and on backend Team Mode (PR #118).
- Wave 6 §"Coach app architecture refactor" depends on the audit finding for `ClientDetailScreen.tsx` (2,329 lines).
- Wave 6 §"Permission prompts" depends on the platform-readiness rules in Wave 3 (#93 `06-accessibility-readiness.md`, `08-crash-and-analytics-readiness.md`).
- Wave 6 §"Admin install UX" depends on Wave 5 (#97 `03-admin-companion.md`) — which decided admin web is primary, mobile is incident-response only.

## How to read this crosswalk

1. If you are starting a runtime PR, find the wave it falls under in the table above.
2. Open the canonical brief for that wave.
3. Read this pack's wave file (if Wave 6–10) for the consolidated mobile contract.
4. Read the platform-readiness brief that the wave file cites.
5. Confirm the backend dependency the wave file lists is at least merged behind a flag.

## Doctrine cross-check

The wave taxonomy does not change the doctrine. Every wave honours `docs/QUIET_LUXURY_DOCTRINE.md`. If a wave file appears to violate it, the wave file is edited; the doctrine is not.

## Update discipline

This file is updated whenever a new wave is opened or a wave is renamed. It is *not* updated when a wave's status changes — that lives in `docs/expansion-map/README.md` (PR #95). The crosswalk is taxonomy; the map is state.
