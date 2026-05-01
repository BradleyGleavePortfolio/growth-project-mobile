# Perplexity Computer — handoff log (`growth-project-mobile`)

This file is updated by every Computer session that does substantive
work in this repo. New sessions should read it top-to-bottom before
touching anything. The most recent session is at the top.

---

## Session 2026-05-01 (PDT) — Wave 4 mobile mirror

**Goal:** mirror the Wave 2 / Wave 3 backend specs into the mobile repo
so the `growth-project-mobile` runtime work is queueable in parallel
with the backend runtime work. Sibling to Wave 5 in
`tgp-finance-app`.

**Branch:** `docs/wave-4-mobile-mirror`. Off `main`. Docs-only,
draft, **NOT MERGED**.

### What was done

Created `docs/product/` with five files:

| File | Lines | Purpose |
|---|---:|---|
| `README.md` | 96 | Index, reading order, anti-scope, conventions |
| `role-experience-extension-org-mode.md` | 743 | Extends PR #97 with ORG mode — three role variants (client / sub-coach / head-coach), Org tab navigation contract, sub-coach roster + invite + drilldown screens, deep-link contract for `tgp://join-coach/<code>`, sub-coach lifecycle state machine, performance roll-up data contract, analytics, acceptance criteria |
| `progression-mobile-ux.md` | 495 | Mobile UX for the Wave 2 retention progression system — home tracker card, level-up modal, milestone wallet, Charter Members private channel, three new push topics, vocabulary discipline (no streak/badge/trophy/VIP/elite), analytics, acceptance criteria |
| `onboarding-mobile-flows.md` | 500 | Layered onboarding work — resume contract for existing 10-step + 4-step Lean paths, new 5-step coach onboarding flow, first-win modal, drop-off recovery via push and `<OnboardingBanner/>`, completion-rate acceptance criteria |
| `whop-ai-coach-copilot-mobile.md` | 577 | Coach AI copilot mobile UX — `<AIRecapCard/>` per client, `<OrgRecapCard/>` for head coaches, at-risk client panel + push, `AIProgramBuilder` 8-step screen, `<CheckInSummaryHeader/>`, disclaimer-strict-mode, voice-backstop, sub-coach vs head-coach matrix, all routed through the existing `sonar-pro` gateway |

Total: 2,411 lines across 5 files. All within the 300–800 lines/spec
quality bar (README excepted; it's an index).

### Cross-repo dependencies

Each spec calls out its hard dependencies in its own header. Summary:

| Mobile spec | Hard dependency | Status |
|---|---|---|
| `role-experience-extension-org-mode.md` | `growth-project-backend/docs/product/sub-coach-hierarchy.md` (Wave 2) | **NOT YET ON BACKEND `main`.** Treated as a hard dependency. Runtime PR pauses until it lands. |
| `progression-mobile-ux.md` | `growth-project-backend/docs/product/retention-progression.md` (Wave 2) | **NOT YET ON BACKEND `main`.** Treated as a hard dependency. |
| `onboarding-mobile-flows.md` | `growth-project-backend/docs/product/onboarding-client-coach.md` (Wave 2) | Soft — mobile owns presentation, backend owns persistence + push. Existing endpoints partially cover it. |
| `whop-ai-coach-copilot-mobile.md` | `growth-project-backend/docs/product/positioning-whop-ai-for-coaches.md` (Wave 2), AI gateway already on `main` | Hard on positioning doc; gateway is shipped. |

The admin-console mirror of sub-coach hierarchy is owned by
`growth-project-backend/docs/admin/control-room-spec.md` and is being
spec'd in Wave 3. Out of scope for this PR.

### Cross-repo siblings

- **Wave 5 (in flight)** — `tgp-finance-app`, branch
  `docs/wave-5-finance-subcoach-billing`. Spec'd `docs/billing/sub-coach-billing-split-spec.md`
  (the two billing flows for sub-coach orgs) and
  `docs/billing/finance-org-roll-ups.md` (org MRR/ARR roll-up).
- **Wave 2 (backend, in flight)** — sub-coach hierarchy, retention
  progression, client/coach onboarding, Whop-AI positioning. Lives in
  `growth-project-backend/docs/product/`. Mobile is the consumer.
- **Wave 3 (backend, in flight)** — admin data-feed RFC. Lives in
  `growth-project-backend/docs/admin/`. Mobile is **not** a consumer
  (the admin console is `tgp-admin-web`); mobile only references it
  for taxonomy.

### Placeholders documented in this session

Per the strict rule, every placeholder is recorded with a justification
so a future Computer can either ratify it or ask the user to fill it in.

| Placeholder | Where | Reason |
|---|---|---|
| `useFlag('coach_copilot_v1')`, `useFlag('coach_onboarding_v1')`, `useFlag('onboarding_v2')`, `useFlag('progression_v1')`, `useFlag('org_mode_v1')` | All four specs | The `useFlag()` hook is owned by [PR #93](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/93) brief 02. It does not yet exist in `src/`. Each spec assumes it. The runtime PR has the hook as a prerequisite. |
| `useEntitlement('coach_copilot')`, `useEntitlement('charter_member')`, `useEntitlement('org_mode')` | Multiple specs | The entitlement hook is owned by [PR #94](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/94) brief 09. Same situation as above. |
| `<AsyncBoundary/>` | All four specs | Owned by [PR #93](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/93) brief 07. Loading/error/empty contract. Not yet in `src/`. |
| `<ProgressBar/>`, `<MetricRow/>`, `<RollUpCard/>`, `<MetricCard/>`, `<SubCoachRow/>`, `<SectionHeader/>`, `<TextLink/>`, `<DestructiveButton/>`, `<SettingsRow/>`, `<SettingsSection/>`, `<OnboardingBanner/>` | Across specs | Named primitives owned by PR #93 brief 05. Some are already shipped in lower-case form (`SettingsRow`, `SettingsSection`); others are reserved-name-only and ship with the PR-93 runtime work. |
| `parseInviteUrl()` discriminated-union refactor | `role-experience-extension-org-mode.md` §6 | The current parser only knows `tgp://join/<code>`. The runtime PR adds the `tgp://join-coach/<code>` shape. Spec'd as additive — existing call sites unchanged. |
| `CreateCoachAccount` route in `AuthNavigator` | `role-experience-extension-org-mode.md` §6 | New screen, sibling to `CreateAccount`. Reserved-name-only; the runtime PR creates it. |
| `LevelUpAck`, `Progression`, `FirstWinAck` routes on `MoreStackParamList` | progression + onboarding specs | Reserved-name-only. The runtime PR registers them. |
| Push topics `progression.milestone.unlocked`, `progression.level.up`, `progression.charter.granted`, `coach.copilot.at_risk_daily`, `coach.copilot.at_risk_critical`, `onboarding.client.dropoff`, `onboarding.coach.dropoff`, `onboarding.client.first_invite_ready`, `onboarding.client.first_check_in_due` | progression + onboarding + copilot specs | Owned by the backend Wave 2 spec corpus. The mobile-side handler routing in `src/utils/notifications.ts` is the runtime change. |
| Disclaimer corpus for the AI copilot | `whop-ai-coach-copilot-mobile.md` §6 | Owned by the backend Wave 2 positioning spec. Mobile renders verbatim. The strict-mode rule (refuse to render if disclaimer missing) is the safety backstop. |
| Body strings for push notifications | onboarding + copilot specs | Owned server-side. Mobile does not hardcode. The runtime PR pauses on bodies until the backend spec ratifies them. |

None of these placeholders are blockers for **this** PR (it is
docs-only). They are recorded so the runtime PRs that follow each spec
can ratify them in order.

### Hard-dependency note (the only true blocker)

The Wave 2 backend specs `sub-coach-hierarchy.md`, `retention-progression.md`,
and `positioning-whop-ai-for-coaches.md` must be on `growth-project-backend`'s
`main` branch (or at least merged-pending-deploy) before any **runtime**
PR derived from this Wave 4 docs PR can ship. This Wave 4 docs PR is
mergeable independently — it is a forward-looking spec. The runtime PRs
are not.

If the user merges this Wave 4 docs PR before Wave 2 backend lands, the
spec sits as a queued contract. If the user merges it after, the spec
maps directly onto the backend shape and the runtime PRs can begin in
sequence.

### What the next Computer should know

- The user is **Bradley Gleave** (`@BradleyGleavePortfolio`).
- The mobile app is **shipped-and-shippable** today (28 client screens,
  8 coach screens, 5 auth screens, full onboarding paths). The doctrine
  test in `src/__tests__/quietLuxuryDoctrine.test.ts` enforces a
  vocabulary baseline — this PR observes that baseline strictly.
- The legacy `student` value of `user_data.role` is being normalised to
  `client` per [PR #97](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/97).
  All Wave 4 specs use `client`. A runtime PR that reads `user_data.role`
  must accept both during the transition.
- The five-state auth machine in `src/navigation/RootNavigator.tsx` is
  the only auth contract. Wave 4 does not introduce a new top-level
  state — ORG mode is a variant of the existing `coach` state.
- The 4-tab client navigator (Home / Train / Log / Profile) is the
  current shape. `docs/HANDOFF.md` §1 still says "Five bottom tabs" —
  that is doc drift from before the 4-tab consolidation. **Wave 4 does
  not fix it**; that is a separate housekeeping PR.
- All eleven push topics this Wave 4 introduces are not yet registered
  in `src/utils/notifications.ts`. The runtime PR that lands the first
  user-facing surface (probably progression) registers all of them at
  once — registration is centralised, so doing it once is cleaner than
  doing it three times.
- The hard-dependency situation means **Wave 4 docs are mergeable now**,
  **Wave 4 runtime PRs are not** until Wave 2 backend lands.
- **Strict rules from the user:**
  - Build to enterprise depth/quality.
  - Never use placeholder content without noting why/where in this
    file.
  - Optimize for user experience.
  - Stay draft, stay unmerged, never touch live apps without
    explicit approval.
  - No emoji. No `Coming Soon`. No `any` types. No `ts-ignore`. No
    invented data. No streak/badge/trophy/VIP/elite vocab.
  - Money is `Decimal(14,2)` end-to-end. AI calls use `sonar-pro`,
    never `sonar`.

### What is intentionally **not** in this PR

- No `src/`, `app.json`, `eas.json`, `package.json`, CI changes.
- No Apple Sign-In / biometric work — that is owned by
  [PR #73](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/73).
- No fix to PR #71's release-readiness gap (assetlinks.json fingerprint,
  AASA Team ID). That is the prerequisite for runtime PRs derived from
  this docs PR.
- No update to `docs/HANDOFF.md` §1's stale "Five bottom tabs" line.
  Separate housekeeping PR.
- No expansion of the existing `src/__tests__/quietLuxuryDoctrine.test.ts`
  forbidden-vocab list to add Wave 4 terms (claimed/redeemed/VIP/elite).
  That is a 5-line addition the runtime PR includes.
- No `scripts/validate-app-config.js` change to verify
  `tgp://join-coach/<code>` paths. Same — owned by the runtime PR.

### Next steps after this session

1. The user reviews this PR and the corresponding Wave 5 PR in
   `tgp-finance-app`.
2. The user (or a future Computer) ratifies Wave 2 backend spec PRs
   (`sub-coach-hierarchy.md`, `retention-progression.md`,
   `positioning-whop-ai-for-coaches.md`) on `growth-project-backend`.
3. Once Wave 2 backend is on `main`, the runtime PR sequence begins:
   - First, the platform substrate (PR #93 brief 02 + 05 + 07 + 08 —
     `useFlag`, named primitives, `AsyncBoundary`, telemetry registry).
     Owns the placeholders flagged above.
   - Then the entitlement contract (PR #94 brief 09).
   - Then ORG mode (this PR's `role-experience-extension-org-mode.md`).
   - Then progression (`progression-mobile-ux.md`).
   - Then onboarding v2 (`onboarding-mobile-flows.md`).
   - Then coach copilot (`whop-ai-coach-copilot-mobile.md`).
4. Each runtime PR ships behind its feature flag in **off** state.
   Bradley toggles flags individually after backend verification.

---
