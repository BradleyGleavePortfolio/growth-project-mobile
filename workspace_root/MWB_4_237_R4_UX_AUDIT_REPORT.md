# MWB-4 #237 R4 UX Audit Report

Auditor: independent UX auditor (fresh pass; not builder/fixer)  
Repo: BradleyGleavePortfolio/growth-project-mobile  
PR: #237  
HEAD audited: `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f`  
Worktree: `/home/user/workspace/tgp/audit-mwb-4-237-r4-ux`

## Scope / Method

- Cloned/fetched PR #237 into the isolated audit worktree and verified HEAD equals `50f0bf22cbc5d23adff7150f2c8306ddeb26ab5f`.
- Read the R3 UX audit report and the R3 combined fixer report, focusing on the prior P2: first-autosave stale-lock bootstrap surfaced as “Edited elsewhere.”
- Reviewed the PR diff against `origin/main`, focusing on `AutosaveStatusPill`, `useAutosave`, `CoachWorkoutBuilderScreen`, `workoutAutosaveApi`, feature flags, and autosave tests.
- Per instruction, did not use browser automation or `github_mcp_direct`; no product code was modified.
- `git diff --check origin/main...HEAD` passed.
- Targeted Jest execution could not run in this isolated worktree because `node_modules` is absent and Jest reports `Preset jest-expo not found`. Static review and diff checks were completed.

## Executive Summary

CLEAN. The R3 P2 is closed: bootstrap `autosave_lock_stale` is no longer surfaced as a user-facing conflict, and the new `syncing` state is neutral, non-actionable functional chrome. The autosave pill remains calm, compact, semantically tokenized, and accessible with polite announcements and reduced-motion support.

## R3 P2 Closure Verification

| Required check | Result | Evidence |
| --- | --- | --- |
| `AutosaveStatusPill` maps new `syncing` status to neutral copy with `semantic.info` color | PASS | `syncing` returns `Syncing latest version…`, `sync-outline`, `semantic.info.fg/bg/border`, and `interactive: false` (`AutosaveStatusPill.tsx:155-168`). |
| `syncing` is polite, busy, and non-actionable | PASS | Non-interactive statuses render as `View` with `accessibilityRole="text"`, `accessibilityLiveRegion="polite"`, and `accessibilityState.busy` true for `saving` or `syncing` (`AutosaveStatusPill.tsx:236-268`). |
| `useAutosave` distinguishes stale-lock bootstrap from real conflict | PASS | The 409 branch computes `isBootstrapStaleLock = err.conflict?.error === 'autosave_lock_stale' && !hasSavedRef.current`, skips `onConflict` for that case, and sets status to `syncing`; otherwise it fires `onConflict` and sets `conflict` (`useAutosave.ts:491-503`). |
| Bootstrap stale-lock recovery keeps the user edit pending and retries | PASS | After adopting the conflict head/token, the hook rebases the batch, writes the mirror again, keeps pending true, and immediately pumps the retry (`useAutosave.ts:513-528`). |
| Real conflict remains actionable | PASS | `autosave_conflict_retry`, or stale-lock after a successful save, still routes to `onConflict` and `conflict`; the screen’s `onAutosaveConflict` refetches (`useAutosave.ts:488-503`, `CoachWorkoutBuilderScreen.tsx:258-274`). |
| Regression test: first autosave placeholder token → 409 stale-lock → no user-facing conflict | PASS (static) | The new test sets a first `autosave_lock_stale` rejection, then a 200, asserts `onConflict` is not called, and asserts captured statuses do not contain `conflict` (`useAutosave.test.tsx:362-421`). |
| API schema supports cause distinction | PASS | `AutosaveConflictSchema` enumerates `autosave_conflict_retry` and `autosave_lock_stale` (`workoutAutosaveApi.ts:214-220`). |

## Full UX Dimension Review

| Dimension | Result | Notes |
| --- | --- | --- |
| Quiet-luxury | PASS | The pill hides in `idle`, uses concise chip chrome, settles `saved` back to `idle` after 2500ms, and treats bootstrap recovery as neutral progress instead of alarm (`AutosaveStatusPill.tsx:142-168`, `useAutosave.ts:335-347`). |
| FACE + VOICE / Roman | PASS | Autosave is functional save-state chrome, not a Roman empty/error state. The component explicitly keeps status labels local as chrome and does not introduce Roman avatar/copy (`AutosaveStatusPill.tsx:40-44`). |
| A11y: live region | PASS | All rendered pill branches expose `accessibilityLiveRegion="polite"`; interactive offline/conflict branches also include role, label, hint, and state (`AutosaveStatusPill.tsx:241-268`). |
| A11y: busy/progress semantics | PASS | `saving` and `syncing` set `busy: true`; settled/offline/conflict do not (`AutosaveStatusPill.tsx:236-239`). |
| A11y: actionability clarity | PASS | `syncing` is non-interactive; offline/conflict are interactive only when `onPress` exists, with state-specific hints (`AutosaveStatusPill.tsx:87-100`, `AutosaveStatusPill.tsx:241-268`). |
| A11y: touch target | PASS | Tappable offline/conflict states get a 48dp minimum target plus hitSlop (`AutosaveStatusPill.tsx:285-292`, `AutosaveStatusPill.tsx:241-253`). |
| Reduced motion | PASS | The saving pulse is disabled when OS reduced-motion is on; the dot returns to static opacity (`AutosaveStatusPill.tsx:117-140`). |
| Tokens / raw colors | PASS | Runtime autosave UI uses theme semantic colors and token imports; raw color scan found only comments/test metadata, not new runtime component styling (`AutosaveStatusPill.tsx:57`, `AutosaveStatusPill.tsx:147-200`). |
| Copy quality / banned copy | PASS | User-facing autosave copy is neutral and operational: `Syncing latest version…`, `Offline — saved on device, will sync`, `Edited elsewhere — tap to refresh`. No stale “refreshing,” panic/error/loss language, or Roman-voice copy appears in the autosave UI (`AutosaveStatusPill.tsx:147-203`). |
| Feature-flag UX | PASS | `mwbAutosave` defaults false, and flag-off mode renders no autosave pill / no autosave work per integration test (`featureFlags.ts:142-158`, `coachWorkoutBuilderAutosave.test.tsx:207-222`). |

## Notes / Non-blocking Observations

- The `syncing` status may be short-lived because the hook immediately pumps the rebased retry; that is acceptable for the UX bar because the user-facing invariant is that bootstrap stale-lock never enters `conflict` and never calls `onConflict`.
- Local targeted tests were blocked by missing dependencies in this isolated worktree; the fixer report records the targeted and full-suite Jest runs passing at this HEAD, and static review agrees with the claimed behavior.

## Merge Bar Assessment

No P0/P1/P2 UX blockers found in R4. The stale-lock bootstrap issue from R3 is closed, and the autosave status surface meets the requested quiet-luxury, FACE+VOICE, accessibility, token, reduced-motion, and copy requirements.

VERDICT: CLEAN
