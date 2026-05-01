# 99 — Implementation order, OWNER_DECISIONs, and risks (Waves 1–10)

**Status:** Pre-build, docs-only.
**Last reviewed:** 2026-05-01.
**Purpose:** A single sheet a runtime engineer can use to sequence post-docs work without re-reading every wave file.

---

## Suggested implementation order (post-docs phase)

The order is consistent with the doctrine ("the floor before the feature") and with the cross-repo dependency graph ("backend behind a flag before mobile starts").

### Phase A — Floor (audit-finding fixes; runtime PRs; no new features)

| # | Surface | PR shape | Wave | Why first |
| - | ------- | -------- | ---- | --------- |
| 1 | `ClientDetailScreen` → `ClientDetailStack` refactor | runtime, ~600-line ceiling per sub-file | 6 | 2,329-line file blocks every Wave 6+ coach feature. |
| 2 | `MoreScreen` regrouping (Plan / Track / Learn / Account) | runtime, presentational | 6 | 18+-row flat list confuses every new `MoreStack` row Waves 7–10 add. |
| 3 | Profile streak placeholder removal | runtime, single-line fix | 4 / 6 | Doctrine-violating placeholder on `main`. |
| 4 | `HomeScreen.workoutDone` placeholder → real query | runtime, single-line fix gated on Wave 4 endpoint | 4 / 6 | Honest empty / loading state requires the real query. |
| 5 | `PermissionPromptModal` primitive + migration of existing permission requests | runtime, no behavioural change | 6 | Required by every wave 7–10 file that consumes a permission. |

### Phase B — Wave 4 mirror (depends on backend Wave 2)

| # | Surface | PR shape | Wave | Cross-repo |
| - | ------- | -------- | ---- | ---------- |
| 6 | Progression mobile UX | runtime, gated on backend `progression-mobile-ux.md` | 4 | Backend Wave 2 |
| 7 | Onboarding mobile flows v2 | runtime, gated on backend `onboarding-client-coach.md` | 4 | Backend Wave 2 |
| 8 | AI coach copilot mobile (client-side AI guide upgrades) | runtime, gated on AI gateway | 4 | Existing |
| 9 | Role-experience extension for ORG mode | runtime, gated on backend `sub-coach-hierarchy.md` | 4 / 5 | Backend Wave 2 / Team Mode |

### Phase C — Wave 1 / 2 / 3 (existing draft packs, runtime build)

Runtime PRs for individual briefs in `docs/expansion/`, `docs/expansion-wave-2/`, and `docs/platform-readiness/`. Order within each pack is the order listed in that pack's README. Most depend on backend PRs #117 / #118 / #119; mobile cannot start until each backend PR is merged behind a flag.

### Phase D — Wave 6 (install / consent floor)

| # | Surface | Flag |
| - | ------- | ---- |
| 10 | `Install` surface (`InstallList`, `InstallDetail`) — coach-only | `features.coach_install_surface` |
| 11 | Sub-coach request / approve flow | `features.coach_install_surface` + `features.team_mode` |
| 12 | (Optional) Admin companion shell | `features.admin_mobile` (default off) |

### Phase E — Wave 7 (marketplace)

| # | Surface | Flag |
| - | ------- | ---- |
| 13 | `CoachCardPreview` (read-only) | `features.marketplace_browse` |
| 14 | `MarketplaceHome` + `CategoryDetail` | same |
| 15 | `SearchResults` | same |
| 16 | `PublicProofDetail` | `features.public_proof` |
| 17 | `Find a coach` row (client) | `features.marketplace_browse_for_clients` (default off) |
| 18 | Coach-side card editor (lives under Wave 6 install) | `features.marketplace_authoring` |

### Phase F — Wave 8 (rewards + affiliate)

| # | Surface | Flag |
| - | ------- | ---- |
| 19 | `RewardsReviewQueue` (read-only) | `features.rewards_review` |
| 20 | Approve / reject mutations | same |
| 21 | `SubmitReward` (client) | `features.rewards_submit` |
| 22 | `Balance` + redemption | `features.balance` |
| 23 | Affiliate enrolment + `AffiliateHome` | `features.affiliate` |
| 24 | `ReferralLinks` + `AttributionLedger` | same |
| 25 | `PayoutHistory` | `features.payouts` |
| 26 | Public-proof opt-in surface | `features.public_proof` |

### Phase G — Wave 9 (storefront + funnel)

| # | Surface | Flag |
| - | ------- | ---- |
| 27 | `StorefrontDetail` + `OfferDetail` (buyer, read-only) | `features.storefront_buyer` |
| 28 | `ApplicationForm` | `features.applications` |
| 29 | Coach `ApplicantsQueue` (read-only) | `features.applicants` |
| 30 | Approve / reject mutations | same |
| 31 | `CheckoutSession` (PaymentSheet) | `features.checkout` |
| 32 | `CheckoutSession` web fallback | same |
| 33 | `FunnelAnalyticsCard` | `features.funnel_analytics` |
| 34 | `StorefrontPreviewCard` + `StorefrontSummary` (coach, read-only) | `features.storefront_preview` |

### Phase H — Wave 10 (community)

| # | Surface | Flag |
| - | ------- | ---- |
| 35 | Rooms + posts (read-only) | `features.community` |
| 36 | `PostComposer` + `acknowledgePost` | same |
| 37 | Replies | same |
| 38 | Announcements | same |
| 39 | Voice notes | `features.community_voice` |
| 40 | `MemberDirectory` (opt-in) | `features.community_directory` |
| 41 | Cohorts (auto-archive) | `features.community_cohorts` |
| 42 | Moderation surface | `features.community_moderation` |
| 43 | AI business copilot (coach-only) | `features.copilot` |

Each phase is gated on Phase A complete. Phases B and C can run in parallel; they do not contend for the same files. Phases D / E / F can run in parallel after Wave 6 step 1 of D ships. Phase G depends on E. Phase H is last.

---

## OWNER_DECISION register

Centralised here so an owner can resolve them in one sitting. Each carries a recommendation; the decision is the owner's.

### Wave 6

- **6.A — Coach bundle split.** Recommendation: stay single-bundle through Waves 6–10. Re-evaluate at Wave 11+ planning. *(Reduces operational cost; matches Wave 5 #97 contract.)*
- **6.B — Admin mobile companion day one?** Recommendation: no, build only on owner request. *(Web is primary; #97 `03` is explicit.)*
- **6.C — Where does `Install` live?** Recommendation: Settings stack. *(Matches existing billing/trust placement; avoids sixth tab.)*
- **6.D — Sub-coach approval requires biometric?** Recommendation: yes, with passcode fallback. *(Reduces wrong-tap risk on a public-impacting consent.)*

### Wave 7

- **7.A — Ratings on cards.** Recommendation: no ratings v1. *(Moderation surface; defer to a Wave 11+ moderation pack.)*
- **7.B — Geolocation in search.** Recommendation: manual only v1. *(Permission cost > UX gain.)*
- **7.C — "Currently coaching ~30 clients" stat.** Recommendation: hide. *(Volatile; turns marketplace into comparison tool.)*
- **7.D — Allow clients to see other coaches.** Recommendation: default off. *(Avoids in-app churn surface.)*

### Wave 8

- **8.A — Coach- vs platform-driven rewards.** Recommendation: coach-driven only. *(Platform defaults pull toward gamification.)*
- **8.B — Affiliate leaderboard.** Recommendation: none. *(Doctrine consistency with Wave 10.)*
- **8.C — Display balance in fiat or points.** Recommendation: fiat. *(Points = gamification language.)*
- **8.D — Show payout amounts.** Recommendation: yes. *(Hiding implies shame; doctrine resists.)*
- **8.E — Auto-renewal of consent.** Recommendation: never; per-use opt-in for public proof. *(Each public-proof use is its own consent.)*

### Wave 9

- **9.A — Mobile storefront authoring.** Recommendation: read-only on mobile, edit on web. *(High-stakes, low-frequency action; web is the canonical authoring environment.)*
- **9.B — Mobile refunds.** Recommendation: web only. *(Reversible-state changes need audit.)*
- **9.C — Application schema versioning.** Recommendation: server returns canonical for current offer version; no mobile cache. *(Compliance footgun otherwise.)*
- **9.D — Save application as draft.** Recommendation: AsyncStorage local only. *(Server-side draft creates moderation / privacy expectations.)*
- **9.E — Coach overrides checkout amount on application.** Recommendation: no. *(Pricing belongs on the offer; coupons are the path.)*

### Wave 10

- **10.A — Reactions vs acknowledgements.** Recommendation: acknowledgements only, anonymised count. *(Doctrinally calmest affordance with engagement signal.)*
- **10.B — Pre-download voice notes.** Recommendation: on-demand only. *(Data-spend the user did not ask for.)*
- **10.C — Member directory default.** Recommendation: default opt-out. *(Privacy-by-default.)*
- **10.D — Mentions in posts.** Recommendation: defer to v2. *(Moderation surface.)*
- **10.E — Client-to-client DMs.** Recommendation: never. *(Different product.)*
- **10.F — Voice note transcript via AI.** Recommendation: coach-consented opt-in per note. *(Accessibility-critical but metered.)*
- **10.G — Sub-coach posting authority.** Recommendation: post in assigned rooms; cannot create / archive / broadcast. *(Matches Team Mode scope shape.)*
- **10.H — Auto-archive of cohorts.** Recommendation: 14 days after program end; read-only. *(Closes the loop without losing history.)*

---

## Cross-repo dependency map (mobile ↔ backend)

| Backend wave / PR | Mobile surfaces that block on it |
| ----------------- | -------------------------------- |
| Backend PR #117 — AI Program Builder / LLM gateway | Wave 1 (`expansion/10`, `11`, `18`), Wave 4 AI copilot mobile, Wave 10 AI business copilot, Wave 10 voice transcripts. |
| Backend PR #118 — Team Mode | Wave 1 (`expansion/20`), Wave 5 (#97 ORG mode), Wave 6 sub-coach install request flow, Wave 8 sub-coach `rewards_review` scope, Wave 10 sub-coach `community` scope. |
| Backend PR #119 — Payments engine | Wave 8 payouts, Wave 9 checkout / subscriptions / refunds. |
| Backend PR #120 — TGP-balance ledger | Wave 8 balance, redemption, affiliate payouts. |
| Backend PR #121 — Marketplace + slug index | Wave 7 marketplace (every surface), Wave 9 storefront slug-binding, Wave 8 affiliate link slug. |
| Backend PR #122 — Spaces / events service | Wave 10 (every surface). |
| Backend PR #123 — Application / funnel service | Wave 9 applications + funnel analytics. |
| Backend Wave 2 (progression) | Wave 4 progression mobile. |
| Backend Wave 2 (sub-coach hierarchy) | Wave 5 ORG mode. |
| Backend Wave 3 (admin lifecycle) | Wave 6 install consent endpoints, Wave 6 admin companion. |

PR numbers are starting points — they may drift across repos. Mobile re-validates at runtime PR open.

---

## Finance dependency map

| Surface | Finance-side dependency |
| ------- | ----------------------- |
| Wave 8 affiliate payouts | Stripe Connect (or equivalent) onboarded per coach via web. Mobile honest-message only. |
| Wave 8 balance redemption | TGP-balance ledger backed by fiat reserve. Owner-side concern. |
| Wave 9 checkout | Payments engine (PR #119) + tax calculation. Each offer single-currency. |
| Wave 9 refunds | Web-only authoring. Mobile reflects state read-only. |
| Wave 10 AI transcripts | Metered LLM cost; coach plan tier gates. Honest empty if not entitled. |

---

## Risk register

The wave files name risks per surface; this table is the cross-cut.

| Risk | Mitigation in wave files | Severity |
| ---- | ------------------------ | -------- |
| Doctrine drift toward gamification | Wave 8 §11 OWNER_DECISIONs A/B/C; Wave 10 §11 OWNER_DECISIONs A/D/E. Acceptance criteria check for emoji / badge / streak / trophy / level / XP / flame / celebrate. | High |
| Privacy regression on public proof | Wave 7 §3 / §9; Wave 8 §7 (per-use opt-in). Buyer / referred-client name → `displayInitial` only across all surfaces. | High |
| Mobile authoring of storefronts spirals | Wave 9 OWNER_DECISION-9.A pins read-only on mobile. | Medium |
| Permission prompt fatigue | Wave 6 introduces `PermissionPromptModal` with re-prompt cooldown; recovery modal links to OS settings. | Medium |
| Deep-link parser breakage | All new routes are additive per `docs/platform-readiness/11`. Acceptance criteria includes regression on `tgp://join/<code>`. | Medium |
| Coach app architecture debt blocking features | Phase A item 1 splits `ClientDetailScreen` before any Wave 6+ coach surface lands. | High |
| Sub-coach scope creep | Wave 6 §"Sub-coach install consent" + Team Mode (PR #118) primitives. Sub-coach is a strict subset; never additive. | Medium |
| AI gateway cost explosion (transcripts) | Wave 10 OWNER_DECISION-10.F — opt-in per note. Plan-tier gating. | Medium |
| Member directory opt-in regression on schema bump | Wave 10 `optInVersion` re-prompt on bump. | Low |
| Notification volume | Per-room / per-coach / per-kind mute primitives in Wave 10 §6. | Low |

---

## Audit findings on `main` (acknowledged)

Mirrored from `docs/waves-6-10/README.md` for a single-page view:

1. **`src/screens/coach/ClientDetailScreen.tsx` is 2,329 lines.** Phase A item 1 splits it.
2. **`src/screens/client/ProfileScreen.tsx:131` static streak placeholder** — `<Text style={styles.streakLine}>Day 7 of 30.</Text>`. Phase A item 3 removes it.
3. **`src/screens/client/HomeScreen.tsx:148` `workoutDone = false` placeholder.** Phase A item 4 replaces it with the real query (Wave 4 endpoint).
4. **`src/screens/client/MoreScreen.tsx` flat 18-row list.** Phase A item 2 regroups it.
5. **Coach product depth.** Wave 1 (Phase C), Wave 6 (Phase D refactor), and Wave 9 (Phase G coach surfaces) collectively address it.

These are the *only* runtime fixes called for by the docs-only Waves 6–10 PR. Everything else stays gated behind feature flags.
