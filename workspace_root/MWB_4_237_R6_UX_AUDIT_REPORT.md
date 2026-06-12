# MWB-4 #237 R6 UX Audit Report

Scope: UX audit only for `BradleyGleavePortfolio/growth-project-mobile`, branch target `feature/mwb-4-mobile-autosave`, audited at HEAD `85760165dd9e99680924b0a59ef1adb09339d346` in `/home/user/workspace/tgp/audit-mwb-4-237-r6-ux`.

R31 independence: I read the R6 audit brief and audited the target worktree fresh. I did not read prior audit reports.

## Verdict

No UX blockers found in the MWB-4 autosave UX surface. D-048/pre-existing product debt is out of scope, and backend/API contract rollout issues were not treated as blocking per brief.

## Checklist results

| Item | Result | Evidence |
| --- | --- | --- |
| Autosave indicator visibility + states | PASS | `AutosaveStatusPill` renders the required states: `saving` (`Saving…`), `saved` (`Saved · …`), `syncing` (`Syncing latest version…`), `offline` (`Offline — saved on device, will sync`), and `conflict` (`Edited elsewhere — tap to refresh`) while hiding `idle` for zero residue (`src/components/workout/AutosaveStatusPill.tsx:142-207`). The screen mounts it only when autosave is enabled and the plan is editable (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:777-789`). |
| 409 rebase user-visible behavior / no silent work loss | PASS | The hook preserves local ops across 409 by adopting the fresh token/index, re-diffing against the latest local working copy, re-mirroring, and re-sending (`src/hooks/useAutosave.ts:522-579`). Real conflicts surface as `conflict` and call the screen conflict refetch path (`src/hooks/useAutosave.ts:538-549`; `src/screens/coach/CoachWorkoutBuilderScreen.tsx:386-404`), while first-save bootstrap stale-lock recovery is neutral `syncing` rather than a false conflict (`src/hooks/useAutosave.ts:529-549`). |
| Offline mirror UX + queued ops feedback | PASS | Before network send, every batch is written to the mirror first (`src/hooks/useAutosave.ts:730-733`), network/server failures keep the batch queued and set `status='offline'` (`src/hooks/useAutosave.ts:581-596`), mirrored batches replay on mount (`src/hooks/useAutosave.ts:854-878`), and reconnect/backoff retries are automatic (`src/hooks/useAutosave.ts:835-852`, `src/hooks/useAutosave.ts:660-682`). The pill copy explicitly says the edit is saved on-device and will sync (`src/components/workout/AutosaveStatusPill.tsx:178-190`). |
| Touch targets ≥44pt on new controls | PASS | The only new interactive control is the offline/conflict autosave pill; when interactive it uses a `Pressable` with `minHeight: 48` and `hitSlop={8}` (`src/components/workout/AutosaveStatusPill.tsx:241-253`, `src/components/workout/AutosaveStatusPill.tsx:285-292`). Non-interactive saving/saved states are text chrome, not controls. |
| Reduce-motion respected | PASS | The saving pulse is suppressed when `useReduceMotion()` returns true; the effect sets opacity back to static `1` and skips the animation loop (`src/components/workout/AutosaveStatusPill.tsx:117-140`). The shared hook reads `AccessibilityInfo.isReduceMotionEnabled()` and subscribes to runtime changes (`src/screens/client/wearables/components/useReduceMotion.ts:20-53`). |
| Live-region announcements | PASS | The pill sets `accessibilityLiveRegion="polite"` on both text and button variants (`src/components/workout/AutosaveStatusPill.tsx:241-266`). Polite is the right level here because all autosave states preserve work via mirror/queue and should not interrupt typing; `saved`, offline queued/retry, syncing, and conflict labels are announced without an assertive interruption. No assertive state is needed because the UI never represents immediate destructive loss. |
| Color contrast ≥4.5:1 | PASS | Static contrast calculation on the exact status colors: success text `#1C3023` on `#E0EBE4` = 11.48:1, warning/offline/conflict text `#8A6A2A` on `#F8F2E5` = 4.51:1, info/syncing text `#1E4971` on `#E8F4FD` = 8.36:1, saving light `#6B675F` on `#FFFDF8` = 5.54:1, saving dark `#A09B94` on `#1C1A18` = 6.29:1. |
| Loading / empty / error states | PASS | Autosave loading/progress is represented by `saving` and `syncing`; empty/no-edit state is `idle` with no pill residue; recoverable error/offline state is visible and actionable via the offline pill; real conflict state is visible and actionable via the conflict pill (`src/components/workout/AutosaveStatusPill.tsx:142-207`). Existing row empty copy remains present (`src/screens/coach/CoachWorkoutBuilderScreen.tsx:850-853`). |

## Notes

- The warning/offline/conflict contrast passes AA at 4.51:1 but has little margin; future palette adjustments should preserve or increase that ratio.
- Backend dark/404/gone behavior was not treated as a blocker per the brief; the current UX keeps the edit mirrored and surfaces a calm offline/queued state rather than throwing a raw API error.

UX VERDICT: CLEAN
