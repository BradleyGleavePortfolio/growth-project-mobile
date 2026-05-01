# 10 — Do we have this already?

> Honest gap analysis. For each Wave-2 topic: what's already shipped on `main`, what PR #92 / #93 covers, what's still missing — and therefore what Wave 2 is actually for. Read this first.

The premise of Wave 2 is that PRs #92 and #93 already exist as draft docs-only PRs against `main`. Wave 2 must not re-specify what they specify, and must not contradict them. Where overlap is unavoidable, this file calls it out.

## Reference packs

| Pack | What it covers | Style |
| --- | --- | --- |
| `docs/expansion/` (PR #92, draft) | 11 next-feature briefs (check-ins, AI recap, intake templates, public coach profile, revenue dashboard, team mode, etc.) | Per-feature, WHY-WHEN-WHERE-WHO-WHAT-HOW |
| `docs/platform-readiness/` (PR #93, draft) | 11 cross-cutting platform briefs (release/EAS, feature flags, role-based nav, accessibility, AsyncBoundary, analytics, deep links, QA matrix) | Per-capability, same shape |
| `docs/expansion-wave-2/` (this PR, draft) | 9 coaching-product briefs (challenges, leaderboards, avatars, content boards, programs, assignments, messaging v2, progress visibility, entitlements) + this gap analysis | Same shape |

## Topic-by-topic gap analysis

### 1. Coach-created fitness challenges

| Question | Answer |
| --- | --- |
| Already on `main`? | **No.** No `Challenge` object, no `ChallengesScreen`, no `challengesApi`. |
| Covered in PR #92? | Indirectly — `docs/expansion/06-coach-checkins-widget.md` and `docs/expansion/12-ready-to-scale-checklist.md` reference cohort structure but not challenges. No file in #92 specifies a `Challenge` object. |
| Covered in PR #93? | No — #93 is platform-only. |
| Wave 2 brief | [`01-coach-fitness-challenges.md`](./01-coach-fitness-challenges.md). Adds the `Challenge` object, editor, list, detail, opt-in, opt-out, manual scoring path. |
| Risk of duplication | Low. |

### 2. Public + private leaderboards

| Question | Answer |
| --- | --- |
| Already on `main`? | **No.** Per merged PR #70, *streak/badge/trophy vocabulary is excised from icons, types, components, seed data*. There is no leaderboard surface today, by design. |
| Covered in PR #92? | No. |
| Covered in PR #93? | No, but `docs/platform-readiness/02-feature-flag-consumption.md` and `docs/platform-readiness/05-reusable-expansion-ui-patterns.md` give us the flag and primitive contracts. |
| Wave 2 brief | [`02-leaderboards-public-private.md`](./02-leaderboards-public-private.md). The brief explicitly bans trophy/badge chrome and re-enforces PR #70's vocabulary policy on this new surface. |
| Risk of duplication | Low — new surface; shared policy with PR #70. |

### 3. Profile image / avatar flows

| Question | Answer |
| --- | --- |
| Already on `main`? | **Partial.** `Avatar` component renders initials from name only — no remote image path, no upload, no moderation, no caching. No `expo-image-picker` flow wired for profile images. |
| Covered in PR #92? | Indirectly — `docs/expansion/16-public-coach-profile.md` requires a coach avatar but does not specify upload UX or moderation. |
| Covered in PR #93? | Indirectly — `docs/platform-readiness/05-reusable-expansion-ui-patterns.md` lists `Avatar` as a primitive but does not specify the remote-image variant. |
| Wave 2 brief | [`03-profile-images-and-avatars.md`](./03-profile-images-and-avatars.md). Specifies the picker → presign → moderation → cache pipeline; both client + coach; rejection paths; reset. Explicitly satisfies the avatar requirement implied by PR #92 #16. |
| Risk of duplication | Low — wave 2 specifies what #92 #16 assumed. |

### 4. Coach content boards (PDF / newsletter / video / link)

| Question | Answer |
| --- | --- |
| Already on `main`? | **No.** `coachApi.postGuidelines` exists for plain-text guidelines (`CoachGuidelinesScreen.tsx`), which is *content-adjacent* but text-only and single-block. No PDF / video / link object. |
| Covered in PR #92? | Partly — `docs/expansion/14-intake-templates.md` covers intake templates (a different shape) and `docs/expansion/16-public-coach-profile.md` covers a public profile. Neither covers a per-coach content board. |
| Covered in PR #93? | Indirectly — `docs/platform-readiness/05-reusable-expansion-ui-patterns.md` lists `EditorialList` and `ReaderScreen` primitives, which the content board reuses. |
| Wave 2 brief | [`04-coach-content-boards.md`](./04-coach-content-boards.md). New object, new screens, both authoring + reading. PDF / video / link / newsletter; visibility model; report flow. |
| Risk of duplication | Low. Brief 04 explicitly disambiguates from PR #92 #14 (intake) and #16 (public profile). |

### 5. Coach-created regimens / programs

| Question | Answer |
| --- | --- |
| Already on `main`? | **Partial.** `src/screens/coach/ProgramTemplatesScreen.tsx` exists and is the authoring surface for *templates*. The schema in `main` is minimal; the editor is light. No phases, no AMRAP/EMOM, no programmatic preview. |
| Covered in PR #92? | Adjacent — `docs/expansion/18-clone-starter-programs.md` specifies the AI-clone path. It assumes a target editor; it does not specify it. |
| Covered in PR #93? | No. |
| Wave 2 brief | [`05-coach-regimens-programs.md`](./05-coach-regimens-programs.md). Specifies the editor that PR #92 #18 *clones into*, with full data model, validation, drag-to-reorder, preview. |
| Risk of duplication | Medium **conceptually**, low in **content** — Wave 2 is the editor; #92 #18 is the LLM hand-off. They are complements. |

### 6. Per-client assignment

| Question | Answer |
| --- | --- |
| Already on `main`? | **No.** Meal plan assignment is implicit (`mealPlansApi.list`), but there is no first-class `Assignment` object across programs/content/challenges. |
| Covered in PR #92? | Indirectly — `docs/expansion/12-ready-to-scale-checklist.md` lists assignment as a thing to track but doesn't specify the object. |
| Covered in PR #93? | No. |
| Wave 2 brief | [`06-per-client-assignment.md`](./06-per-client-assignment.md). Specifies the `Assignment` object, editor, conflict resolution, status state machine, override schema. |
| Risk of duplication | Low. Wave 2 is the prerequisite primitive that briefs 01 / 04 / 05 all consume. |

### 7. Coach ⇄ client messaging surfaces

| Question | Answer |
| --- | --- |
| Already on `main`? | **Yes — text-only 1:1.** `MessagesScreen.tsx` (client + coach), realtime via `subscribeToMessages` + 60 s safety poll. No attachments, no voice, no broadcast, no pinning, no read receipts beyond a basic mark-read endpoint. |
| Covered in PR #92? | No. |
| Covered in PR #93? | Indirectly — `docs/platform-readiness/02-feature-flag-consumption.md` is reused for staged rollout. |
| Wave 2 brief | [`07-coach-client-messaging-surfaces.md`](./07-coach-client-messaging-surfaces.md). Adds attachments (image / PDF / voice), broadcast (1:N), pinned messages, read receipts. Explicitly extends — does not replace — the existing surface. |
| Risk of duplication | Low. |

### 8. Progress visibility

| Question | Answer |
| --- | --- |
| Already on `main`? | **Partial.** `ProgressScreen`, `ReportScreen` (client side); `ClientDetailScreen` with `getClientTimeline`/`getClientCheckIns`/`getClientSummary` (coach side). No unified `Progress` object; no client-controlled redaction layer; no cross-client overview. |
| Covered in PR #92? | Adjacent — `docs/expansion/05-weekly-checkins-client.md`, `docs/expansion/06-coach-checkins-widget.md`, `docs/expansion/08-coach-attention-panel.md`, `docs/expansion/10-coach-generate-recap.md` all *consume* progress signals. None defines the shared `Progress` projection or the redaction model. |
| Covered in PR #93? | No. |
| Wave 2 brief | [`08-progress-visibility.md`](./08-progress-visibility.md). Specifies the unified projection, the redaction layer, cross-client overview, audit log expectation. |
| Risk of duplication | **Medium overlap** with #92 #05/#06/#08/#10 — Wave 2 is the *contract* those briefs read from. They specify *what to render*; this specifies *what to fetch and what is redacted before rendering*. |

### 9. Tier-gated L2 / L3 experiences

| Question | Answer |
| --- | --- |
| Already on `main`? | **No.** Tier checks are scattered as direct `user.tier === 'L2'` style references. No shared hook, no Trust Center plan row, no entitlement broadcast. |
| Covered in PR #92? | Indirectly — `docs/expansion/19-coach-revenue-dashboard.md` mentions plan tiers but specifies a *coach revenue surface*, not entitlement gating. |
| Covered in PR #93? | Adjacent — `docs/platform-readiness/02-feature-flag-consumption.md` defines `useFlag()` for experimentation. Entitlements are intentionally a separate concern. |
| Wave 2 brief | [`09-tier-gated-l2-l3.md`](./09-tier-gated-l2-l3.md). Defines `useEntitlement()`, `Capability` set, default-deny, Trust Center "Plan & access" row, doctrine-clean upgrade prompt shape. |
| Risk of duplication | Low — explicitly orthogonal to `useFlag()`. Brief calls out the difference. |

## What Wave 2 deliberately does NOT cover

- **Re-spec of PR #92 features.** Each brief in Wave 2 only references #92 briefs where it *consumes* them; it does not re-write them.
- **Re-spec of PR #93 platform briefs.** Wave 2 briefs assume the platform briefs have shipped (or will ship before the Wave-2 implementation PRs). Where a Wave-2 brief needs a primitive (`AsyncBoundary`, `Avatar`, `EditorialList`), it links to PR #93's spec.
- **Backend / server briefs.** Wave 2 specifies *mobile expectations*. Backend PRs #117 / #118 / #119 referenced in PR #92 / #93 cover the backend side; Wave 2 does not duplicate them.
- **`new-website`.** This repo has no `new-website` directory. No file in this PR references or modifies it. Confirmed by the validation step in this PR.
- **Implementation.** Every brief is unimplemented until its own follow-up PR ships with code, tests, and CI.

## Order of consumption (suggested reading)

1. This file (`10-do-we-have-this-already.md`).
2. [`README.md`](./README.md) — index + cross-cutting constraints.
3. The brief whose feature you are about to implement.
4. The PR #92 / #93 briefs cross-referenced from your brief.
5. The relevant `src/` files cited in the brief, to verify the references are still accurate.

## Order of implementation (suggested sequence)

This is **not a committed roadmap**. Sequencing is the team's planning-tool job. But for an operator who wants the lowest-risk landing order:

1. **Brief 09 — entitlements**, behind its top-level flag, with the hook returning `{ allowed: true }` for everyone (no behavioural change). Establishes the gate primitive.
2. **Brief 06 — assignments**. The unifying primitive that briefs 01/04/05 consume.
3. **Brief 05 — programs**. The largest assignment subject; useful even before challenges/content land.
4. **Brief 04 — content boards**. Lowest-risk content surface; reuses PDF/markdown patterns.
5. **Brief 01 — challenges**. Builds on assignments + entitlements.
6. **Brief 03 — avatars**. Independent; can land anywhere; coach-first phasing reduces risk.
7. **Brief 07 — messaging v2**. Extends shipped surface; phased per-attachment-kind.
8. **Brief 02 — leaderboards**. Depends on challenges; gated by entitlements; privacy-sensitive.
9. **Brief 08 — progress visibility**. Cross-cutting projection + redaction; lands once briefs 01/04/05/06 are stable so the projection covers their data.

## Conformance check

| Check | Status |
| --- | --- |
| No `src/` files modified | ✅ confirmed by `git diff --stat origin/main...HEAD` |
| No `app.json` / `eas.json` / `package.json` / CI files modified | ✅ |
| No `new-website` directory exists in this repo | ✅ confirmed by filesystem search |
| All inter-brief links use relative paths | ✅ |
| All briefs answer WHY/WHEN/WHERE/WHO/WHAT/HOW | ✅ |
| All briefs include screens, API, media, a11y, states, privacy, flags, analytics, rollout, tests, risks, dependencies, acceptance, operator handoff | ✅ |
| No duplication of PR #92 or #93 content | ✅ — adjacencies called out per topic above |
| Doctrine compliance (no Coming Soon, no trophy chrome, no hype, no emoji in `src/` references) | ✅ — briefs are docs only; doctrine applies to the eventual implementation PRs which each brief enforces in copy |
