# Mobile product specs — Wave 4 mirror

This directory holds the **mobile-side** product specs for the Wave 2 / Wave
3 backend work happening in [`growth-project-backend`](https://github.com/BradleyGleavePortfolio/growth-project-backend)
and the admin-console work in `tgp-admin-web` (planned). Specs in this
directory describe what the **Expo / React Native client** has to render to
realise those backend behaviours end-to-end.

These docs are docs-only. They do not change `src/`, `app.json`, `eas.json`,
`package.json`, or CI. Implementation of each spec is a separate runtime PR
sequenced after the corresponding backend spec lands.

---

## Files

| File | Purpose | Status |
|---|---|---|
| [`role-experience-extension-org-mode.md`](./role-experience-extension-org-mode.md) | Extends [PR #97](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/97) (`docs/role-experience/`) to add ORG mode — head-coach managing sub-coaches. Three role variants, org-tab navigation contract, sub-coach roster, invite flow, performance roll-up. | Draft |
| [`progression-mobile-ux.md`](./progression-mobile-ux.md) | Mobile UX for the Wave 2 retention progression system: level-up surface, milestone wallet, drip-unlock notifications, Charter Members private channel, native push contracts. | Draft |
| [`onboarding-mobile-flows.md`](./onboarding-mobile-flows.md) | Client and coach onboarding flows on mobile, layered onto the existing 10-step + 4-step Lean paths. Drop-off recovery, first-win modal, completion-rate acceptance criteria. | Draft |
| [`whop-ai-coach-copilot-mobile.md`](./whop-ai-coach-copilot-mobile.md) | Coach AI copilot UX: weekly recap, at-risk-client alert, program-builder entry point, check-in summary. Routed through the existing `sonar-pro` backend gateway. | Draft |

---

## Reading order

1. `role-experience-extension-org-mode.md` — establishes the role contract
   that the rest of the wave assumes.
2. `progression-mobile-ux.md` — the client-facing retention surface.
3. `onboarding-mobile-flows.md` — what a new client and a new coach see in
   the first ten minutes.
4. `whop-ai-coach-copilot-mobile.md` — how the AI surfaces sit on the coach
   shell after ORG mode is in place.

---

## Cross-repo dependencies

These specs reference backend work that lives in `growth-project-backend`
under `docs/product/` (Wave 2) and `docs/admin/` (Wave 3). Each individual
spec calls out its hard dependencies in its own header. The summary:

| Mobile spec | Backend spec | Backend status |
|---|---|---|
| `role-experience-extension-org-mode.md` | `docs/product/sub-coach-hierarchy.md` (Wave 2) | Hard dependency. Mobile cannot ship without it. See PERP_HANDOFF.md note. |
| `progression-mobile-ux.md` | `docs/product/retention-progression.md` (Wave 2) | Hard dependency. Push contract must match. |
| `onboarding-mobile-flows.md` | `docs/product/onboarding-client-coach.md` (Wave 2) | Soft — mobile owns presentation; backend owns persistence + push. |
| `whop-ai-coach-copilot-mobile.md` | `docs/product/positioning-whop-ai-for-coaches.md` (Wave 2), AI gateway in `backend/src/ai/` (live) | Hard on positioning doc; gateway already exists. |

For the admin console mirror (sub-coach surfaces in OWNER admin), see
`tgp-admin-web` and the `docs/admin/control-room-spec.md` §11 gap inventory
in the backend repo.

---

## Anti-scope

- No runtime source under `src/`.
- No `app.json` / `eas.json` / `package.json` / CI changes.
- No invented endpoints. Where a backend endpoint is referenced, it is one
  of: (a) already shipped on `main`, (b) explicitly spec'd in a Wave 2
  backend doc, or (c) listed as a hard dependency with a TODO sentinel and
  a justification in the repo-root `PERP_HANDOFF.md`.
- No new auth model. The five-state machine in
  [`src/navigation/RootNavigator.tsx`](../../src/navigation/RootNavigator.tsx)
  is the only auth contract; ORG mode adds variants of the existing
  `coach` state, not a new top-level state.
- No emoji. No "Coming Soon." No streak/badge/trophy vocabulary. The
  jest doctrine test in `src/__tests__/quietLuxuryDoctrine.test.ts` will
  fail any runtime PR that breaks these rules; specs in this directory
  observe the same vocabulary discipline.

---

## Conventions used in these specs

- **Wireframes** are ASCII boxes drawn at the column widths a phone screen
  would actually permit. They are illustrative, not pixel-perfect — the
  components they reference are tokens-driven primitives from
  [`src/theme/tokens.ts`](../../src/theme/tokens.ts) and the named
  primitives spec'd in [PR #93](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/93)
  brief 05.
- **Navigation contracts** are typed against the existing `ParamList`
  exports in [`src/navigation/ClientNavigator.tsx`](../../src/navigation/ClientNavigator.tsx)
  and `CoachNavigator.tsx`. New routes are described as additions to the
  existing param lists, not replacements.
- **Deep link contracts** observe the existing parser in
  [`src/utils/deepLink.ts`](../../src/utils/deepLink.ts) — `tgp://` custom
  scheme and `https://app.trygrowthproject.com/...` Universal Links. New
  paths are additive; the `tgp://join/<code>` contract that PR #71 is
  trying to land is not modified.
- **State machines** are written as transition tables, not prose. Each
  transition lists trigger, guard, side effect, and persisted-storage key.
- **Acceptance criteria** are listed at the end of each spec as a
  bullet list a runtime PR can copy verbatim into its PR description.
