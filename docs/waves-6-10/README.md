# Waves 6–10 — mobile mirror (consolidated)

**Status:** Pre-build, docs-only draft.
**Last reviewed:** 2026-05-01.
**Scope:** Mobile UX contracts for the Wave 6–10 expansion of The Growth Project. Mirrors the corresponding backend wave specs in [`growth-project-backend`](https://github.com/BradleyGleavePortfolio/growth-project-backend).
**Anti-scope:** No `src/`, `app.json`, `eas.json`, `package.json`, or CI changes. No runtime implementation. No emoji, no streak/badge/trophy vocabulary, no "Coming Soon" — quiet-luxury doctrine governs.

---

## Why this pack exists

The packs that came before (PRs #92, #93, #94, #95, #96, #97, #98) were authored before the team agreed on a single Wave 1–10 taxonomy. They are individually correct but collectively read as parallel lanes. This pack does three things:

1. **Maps the existing draft PRs onto the Wave 1–10 scheme.** See [`00-wave-crosswalk.md`](./00-wave-crosswalk.md). This is the entry point.
2. **Specifies the mobile mirror for Waves 6–10** — five enterprise-quality wave specs that cover the territory the earlier packs did not: app-architecture / admin install UX (Wave 6), discovery marketplace UX (Wave 7), content rewards / affiliate UX (Wave 8), storefront builder + funnel analytics UX (Wave 9), and community / chat doctrine (Wave 10).
3. **Closes the explicit gaps the earlier packs left open** — client-safe permission prompts, member directory, voice notes, announcements, rooms / cohorts, sub-coach install consent, plus the three audit findings on `main` (`ClientDetailScreen` size, profile streak placeholder, Home `workoutDone` placeholder).

This pack is intentionally **the last pack of the docs-only phase**. After it merges, the next mobile PRs are runtime PRs gated on the corresponding backend wave landing behind feature flags.

## Files

| # | File | Wave | Primary surface |
| - | ---- | ---- | --------------- |
| 00 | [00-wave-crosswalk.md](./00-wave-crosswalk.md) | 1–10 | The single source of truth for which existing PR covers which wave. **Read first.** |
| 06 | [06-app-architecture-and-admin-install.md](./06-app-architecture-and-admin-install.md) | 6 | App architecture, admin install UX, sub-coach install consent, permission prompts. |
| 07 | [07-discovery-marketplace.md](./07-discovery-marketplace.md) | 7 | Coach marketplace, discovery feed, search, public proof surface. |
| 08 | [08-content-rewards-and-affiliate.md](./08-content-rewards-and-affiliate.md) | 8 | Content reward submission, affiliate / referral dashboards, attribution. |
| 09 | [09-storefront-builder-and-funnel-analytics.md](./09-storefront-builder-and-funnel-analytics.md) | 9 | Storefront builder preview / hand-off to web, funnel analytics dashboards. |
| 10 | [10-community-rooms-and-chat-doctrine.md](./10-community-rooms-and-chat-doctrine.md) | 10 | Rooms / cohorts, announcements, voice notes, member directory, chat doctrine. |
| 99 | [99-implementation-order-and-risks.md](./99-implementation-order-and-risks.md) | 1–10 | Phased implementation order, cross-repo dependencies, OWNER_DECISION register, audit risks. |

## Reading order

1. `00-wave-crosswalk.md` — wave taxonomy + which existing PR owns each wave.
2. The wave file you are about to implement.
3. `99-implementation-order-and-risks.md` for sequencing and cross-repo dependencies.
4. The sibling pack(s) referenced by your wave file.

## Conventions used in every wave file

Each wave file answers the same eleven questions, in this order:

1. **Persona contract** — what the owner / coach / sub-coach / client / ambassador / buyer-prospect each see and do.
2. **Navigation map** — which navigator the surface lives in; which routes are added; which existing routes are modified; deep-link contract.
3. **Screen contracts** — for each screen: purpose, props, server data, mutations, empty / loading / error / offline state.
4. **API contract dependencies** — backend endpoints consumed, with typed DTO sketches; which backend wave / PR owns each endpoint.
5. **State and cache strategy** — React Query keys, optimistic updates, rollback, AsyncStorage / SecureStore / SQLite usage, offline posture.
6. **Push and deep-link behaviour** — payloads, route resolution, foreground vs background handling, consent prompts.
7. **Permissions and consent** — every native permission requested, with the plain-language prompt copy and the doctrine-compliant fallback if denied.
8. **Accessibility notes** — screen-reader labels, dynamic-type behaviour, contrast, reduce-motion.
9. **Analytics, privacy, security** — events emitted, fields redacted, PII boundaries, public-proof consent.
10. **Test plan and acceptance criteria** — unit / integration / Detox surfaces, manual QA checklist, criteria a runtime PR can copy verbatim.
11. **Phased implementation order, OWNER_DECISIONs, cross-repo deps** — what ships v1 vs deferred; open product choices flagged with `OWNER_DECISION` and a recommended choice.

## Cross-cutting constraints (called out once)

These hold for every wave file. They are not repeated per file.

- **Expo / EAS identity is immutable.** `owner: the-growth-project`, `slug: tgp-health-and-wellness`, `expo.extra.eas.projectId: 3aeadee6-34c5-4231-85b9-aff9f7ea3c5a`, `bundleIdentifier / package: com.growthproject.app`, `scheme: tgp`. A future coach bundle would *add* a second EAS project, not rename the existing one.
- **Theme tokens (`src/theme/`) are the single source of truth.** No hardcoded hex; no new palette; coach density via tokenised spacing.
- **Quiet-luxury doctrine** — `docs/QUIET_LUXURY_DOCTRINE.md` governs every UI decision. No emoji in `src/`. No streak / badge / trophy vocabulary (PR #70). No celebratory chrome. No "Coming Soon" tiles. No fake activity feeds. Empty states must be honest.
- **Auth shape per `docs/HANDOFF.md` §4.** Supabase JWT, role on the user record, `RootNavigator` switches on `user.role`. New roles or sub-roles ride on the existing five-state machine; they do not introduce a sixth state.
- **`src/services/api.ts` is the single HTTP entry point.** New endpoints are added there with a Zod parse — never inline in a screen.
- **Tenant safety.** Coach-side responses are scoped by JWT. The mobile client never assumes "all" of anything. Ambassador / affiliate scopes are a strict subset of coach scopes.
- **Navigation shape.** Client app: 4 icons-only bottom tabs (`Home / Train / Log / Profile`) with a `MoreStack` hung off Profile. Coach app: 5 tabs (`Clients / Dashboard / Templates / Messages / Settings`). New surfaces extend, never replace, this shape — no sixth tab.
- **`new-website` is out of scope.** This repo does not contain it; this pack does not introduce it.
- **Mobile is a *consumer*, not an author, of the backend contract.** API shapes in this pack are mobile's *target* contract — the starting point for negotiation. The backend OpenAPI is authoritative once it lands.

## Persona contract (used by every wave)

The five personas referenced in every wave file:

| Persona | Definition | Default landing surface |
| ------- | ---------- | ----------------------- |
| **Owner** (`role=admin` on backend) | Operator of the platform. Has visibility across coaches. Web is the primary surface. Mobile companion is incident-response only (per [`docs/role-experience/03-admin-companion.md`](../role-experience/03-admin-companion.md)). | Optional admin companion app, behind `features.admin_mobile`. |
| **Coach** (`role=coach`, no parent coach) | Independent coach or head coach of a team. Owns clients, programs, content, offers, storefront. | Coach app — Dashboard tab. |
| **Sub-coach** (`role=coach`, has parent coach via Team Mode, backend PR #118) | Junior coach operating on behalf of a head coach. Scoped permissions; cannot edit billing or storefront unless granted. | Coach app — restricted Dashboard. See `docs/platform-readiness/04`. |
| **Client / Student** (`role=student`) | Paying member of a coach's program. The 4-tab client app is built around this persona. | Client app — Home tab. |
| **Ambassador / Affiliate** (entitlement on a `client` user, not a separate role) | Client who has opted into the referral / affiliate program. Sees an extra row in the `MoreStack`. | Client app — Profile / More / Affiliate. |
| **Buyer / Prospect** (no auth) | Visiting a coach's storefront via link before signing up. Mobile surface is the public storefront screens (Wave 7 / Wave 9). | Public storefront stack — pre-auth. |

Personas are not roles; they are operating modes. A user can be a client of coach A and an ambassador of coach B at the same time. Mobile renders the union of their entitlements; the JWT scopes the responses.

## Doctrine cross-check (every wave honours these)

- No fake gamification. No streak counters, no badge grids, no trophy reveals, no flame icons, no XP bars, no levels.
- No celebration animations. No confetti, no reveal modals, no achievement chrome.
- No emoji-bait copy. No "🔥 Crush your streak", no "🏆 You earned it", no "🎉 You're on a roll". The vocabulary is calm and honest.
- Public proof surfaces (testimonials, leaderboards, before/afters) are **opt-in, opt-out, and revocable**. Default is private. Revocation removes the artefact within one app session.
- Reactions, hearts, claps are not added by default. Wave 10 RFC explicitly chose **acknowledged** (a "seen" affordance) over reactions, with `OWNER_DECISION` to revisit only if community engagement data justifies it.

If a wave file appears to violate any of the above, the wave file is wrong and must be edited. The doctrine wins.

## Audit findings on `main` (acknowledged, deferred)

These are **runtime issues** flagged in the mobile audit. This pack does not fix them — that requires a runtime PR and is out of scope for a docs-only update. The wave files reference them where they affect ordering:

1. **`src/screens/coach/ClientDetailScreen.tsx` is 2,329 lines.** Wave 6 (app architecture) calls for splitting it into a `ClientDetailStack` of typed sub-screens (Overview / Programs / Check-ins / Messages / Notes / Files / Billing) before any further coach-side feature lands. See [`06-app-architecture-and-admin-install.md`](./06-app-architecture-and-admin-install.md) §"Coach app architecture refactor".
2. **`src/screens/client/ProfileScreen.tsx` line 131** — `<Text style={styles.streakLine}>Day 7 of 30.</Text>` is a static placeholder. The streak vocabulary was excised in PR #70; this string is doctrine-violating and must be removed by the runtime PR that implements client-side progression (Wave 4, mirror of backend PR `progression-mobile-ux.md`).
3. **`src/screens/client/HomeScreen.tsx` line 148** — `const workoutDone = false; // conservative default — no workout endpoint on home`. This placeholder must be replaced by a real workout-done query once the workout-history endpoint lands. Tracked under Wave 4 implementation order.
4. **`src/screens/client/MoreScreen.tsx` carries 18+ rows.** Wave 6 calls for grouping these rows into named sections (Plan / Track / Learn / Account) and demoting low-traffic items to a search-only surface, before adding any further `MoreStack` rows.
5. **Coach product depth is shallow** — the coach app's `Dashboard` is a thin KPI strip and an alerts feed. Waves 1, 2, and 6 collectively flesh it out (`docs/expansion/06`, `08`, `19`; this pack §`06`).

Each finding is referenced from the wave file that depends on it.

## What this pack is *not*

- Not a runtime PR. Implementation lives in follow-up PRs gated on backend.
- Not a re-spec of waves 1–5. Wave 1–5 content lives in PRs #92, #93, #94, #97, #98. This pack *cross-references* them; it does not duplicate them.
- Not a project plan. Sequencing is suggested, not contractual. The team's planning tool owns the order.
- Not a backend spec. API shapes are mobile's consumption contract. Backend OpenAPI is authoritative.
- Not a Figma replacement. UX details (spacing, copy, motion) live in Figma + `QUIET_LUXURY_DOCTRINE.md`.

## Operator handoff

When this pack merges:

- The expansion map (`docs/expansion-map/README.md`, PR #95) gains a Wave 1–10 status table. PR #95 is updated in the same operator session that merges this pack.
- The runtime backlog gains five wave-named milestones (Wave 6 through Wave 10). Each milestone is a sequence of feature flags listed in the wave file's "Phased implementation order".
- The audit-finding fixes (§"Audit findings on `main`" above) are scheduled as the *first* runtime PRs of the post-docs phase, ahead of any new Wave 6+ feature work.
