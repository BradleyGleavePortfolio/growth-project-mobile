# MWB-4 #237 R3 UX Audit Report

Auditor: independent UX auditor (fresh pass; not builder/fixer)  
Repo: BradleyGleavePortfolio/growth-project-mobile  
PR: #237  
HEAD audited: `1c63aa2735e687cc9673ca2093081e59f463f02b`  
Worktree: `/home/user/workspace/tgp/audit-mwb-4-237-r3-ux`

## Scope / Method

- Read the R3 brief, the R1 UX audit report, the adjacent v2-4 mobile fixer report, and the design doctrine excerpts on calm error states, progressive disclosure, and invisible interface complexity.
- Cloned/fetched PR #237 into the isolated audit worktree and verified HEAD equals `1c63aa2735e687cc9673ca2093081e59f463f02b`.
- Reviewed the PR diff against `origin/main`, focusing on `AutosaveStatusPill`, `useAutosave`, `CoachWorkoutBuilderScreen`, feature flags, tests, and token usage.
- Per instruction, did not use browser automation or `github_mcp_direct`; no product code was modified.
- Targeted test execution was not possible in this isolated worktree because `node_modules/.bin/jest` is absent. Static review and diff checks were completed instead. `git diff --check origin/main...HEAD` passed.

## Executive Summary

NOT CLEAN. R3 resolves the specific R1 UX blockers around saved-state settling, busy/live semantics, offline reassurance, semantic token usage in the pill, and conflict copy staleness. However, one UX correctness issue remains: the implementation surfaces every 409 as the user-facing `conflict` state, while the API/schema and screen comments explicitly identify `autosave_lock_stale` as the expected first-save bootstrap path. That normal bootstrap can briefly announce and display “Edited elsewhere — tap to refresh,” which is inaccurate, anxiety-producing, and contrary to the quiet/invisible autosave bar.

## R1 Finding Regression Check

| R1 item | R3 result | Evidence |
| --- | --- | --- |
| Interactive offline/conflict live region + busy state | PASS | Interactive `Pressable` now has `accessibilityLiveRegion="polite"`, `accessibilityState`, role, label, hint, and 48dp target (`AutosaveStatusPill.tsx:213-228`). Non-interactive states also expose live region and busy state (`AutosaveStatusPill.tsx:234-241`). |
| Saved confirmation must be brief | PASS | `AUTOSAVE_SAVED_SETTLE_MS = 2500`, and the hook clears `saved` back to `idle` if still saved (`useAutosave.ts:88-93`, `useAutosave.ts:305-324`). A test pins the settle behavior (`useAutosave.test.tsx:264-298`). |
| Conflict copy/status stale | PARTIAL | The pill copy changed from stale “refreshing” to action-oriented “Edited elsewhere — tap to refresh,” with a matching hint (`AutosaveStatusPill.tsx:168-180`). But the same copy is used for bootstrap stale-lock 409s, where “edited elsewhere” is not necessarily true. See finding below. |
| Offline copy local preservation | PASS | Offline label now says `Offline — saved on device, will sync` (`AutosaveStatusPill.tsx:155-167`). |
| Semantic tokens / raw hex in pill | PASS | Pill imports `spacing`, `typography`, `radius`, and `semantic`; status colors use `sc` or semantic token objects, not raw component hex (`AutosaveStatusPill.tsx:48`, `AutosaveStatusPill.tsx:133-184`). Added-line raw-hex scan showed only a commit hash false positive, not runtime component styling. |

## UX Dimension Review

| Dimension | Result | Notes |
| --- | --- | --- |
| Quiet-luxury | PARTIAL | The pill is compact, neutral, low-weight, and settles after save. The remaining issue is false/high-friction conflict language during a normal bootstrap lock refresh. |
| FACE + VOICE / RomanAvatar tree colocation | PASS / N/A | This surface is functional save-state chrome, not a Roman empty/error state. No Roman copy or avatar was introduced in the PR surface. |
| A11y: busy/progress/live | PASS for pill | `saving` maps to `busy: true`; all rendered pill branches are live-region polite; interactive branches retain button role, hint, label, and hit area. |
| A11y: 44pt touch | PASS for new interactive pill | Tappable offline/conflict pill has `minHeight: 48` and `hitSlop={8}` (`AutosaveStatusPill.tsx:216-228`, `AutosaveStatusPill.tsx:263-268`). |
| A11y: labels | PASS for new autosave surface | The pill uses state-specific accessibility labels and hints (`AutosaveStatusPill.tsx:188-224`). |
| Empty/loading/error states | PARTIAL | Offline is tasteful and reassuring; saved/saving are calm. The conflict branch overstates a normal stale-lock bootstrap as “edited elsewhere.” |
| Reduced motion | PASS | Saving pulse exits to a static icon when `useReduceMotion()` is true (`AutosaveStatusPill.tsx:97-131`). |
| Tokens / raw colors | PASS for changed runtime UI | New runtime UI uses semantic tokens and max `fontWeight: '600'` (`AutosaveStatusPill.tsx:48`, `AutosaveStatusPill.tsx:247-272`). |

## Findings

### P2 — Normal stale-lock bootstrap can be surfaced as “Edited elsewhere,” creating a false conflict state

Evidence:
- The screen explicitly documents that the first autosave attempt starts with a placeholder token and “by design” 409s with `autosave_lock_stale`, then fast-forwards and retries (`CoachWorkoutBuilderScreen.tsx:72-85`).
- The API conflict schema distinguishes `autosave_lock_stale` from `autosave_conflict_retry` (`workoutAutosaveApi.ts:209-221`).
- The hook branches only on `err.kind === 'conflict'`; it calls `onConflict`, sets `status='conflict'`, and rebases/retries for all 409 conflict bodies without checking `err.conflict?.error` (`useAutosave.ts:442-476`).
- The visible conflict state then labels that condition as `Edited elsewhere — tap to refresh` and announces it via the live-region pill (`AutosaveStatusPill.tsx:168-180`, `AutosaveStatusPill.tsx:216-224`).

Impact:
- A coach making a routine first edit in an autosave session can briefly see or hear that the plan was “edited elsewhere” even when no other editor/device is involved.
- Because the pill is a live region, this false conflict can be announced to screen-reader users at the exact autosave anxiety moment.
- This leaks implementation complexity into the UI, conflicting with the doctrine’s “hide the work” bar: stale-lock/bootstrap mechanics should resolve quietly unless the user actually needs to intervene.

Required bar:
- Treat `autosave_lock_stale` bootstrap/stale-token recovery as a quiet internal refresh/retry state, not as user-facing “edited elsewhere” conflict copy.
- Reserve “Edited elsewhere” (or any external-edit language) for a true `autosave_conflict_retry` / unrecoverable external-edit condition where user action is actually needed.
- If a stale-lock recovery must be visible, use neutral progress copy such as “Syncing latest version…” and keep it non-actionable unless retry is blocked.

## Positive Notes

- Feature flag defaults remain production-safe: `mwbAutosave` defaults false and `.env.example` sets `EXPO_PUBLIC_FF_MWB_AUTOSAVE=false` (`featureFlags.ts:142-158`, `.env.example:102-106`).
- The flag-off invariant is covered by tests: no pill and no autosave calls when the flag is off (`coachWorkoutBuilderAutosave.test.tsx:207-222`).
- Offline copy now explicitly reassures local preservation and avoids destructive red/error language (`AutosaveStatusPill.tsx:155-167`).
- The saved confirmation is brief and has a regression test (`useAutosave.ts:305-324`, `useAutosave.test.tsx:264-298`).
- Reduced-motion handling is real: the animated pulse is suppressed under OS reduced-motion (`AutosaveStatusPill.tsx:108-131`).
- New pill styling uses semantic tokens and a maximum local weight of 600 (`AutosaveStatusPill.tsx:48`, `AutosaveStatusPill.tsx:247-272`).

## Merge Bar Assessment

The R1 issues are mostly resolved, but the remaining false-conflict UX issue is a P2 because it undermines trust in the autosave status at a routine moment and creates an inaccurate live-region announcement. Standard P0+P1+P2 CLEAN is therefore not met.

VERDICT: NOT CLEAN
