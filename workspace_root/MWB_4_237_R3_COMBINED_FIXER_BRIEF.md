# FIXER BRIEF — MWB-4 #237 R3 combined (P1 row-ID adoption + P2 stale-lock UX)

FIXER (Opus 4.8). NO browser_task. NO github_mcp_direct. `api_credentials=["github"]`.

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR #237 HEAD: `1c63aa2735e687cc9673ca2093081e59f463f02b`
Worktree: `/home/user/workspace/tgp/fixer-mwb-4-237-r3-combined`

Setup:
```bash
mkdir -p /home/user/workspace/tgp/fixer-mwb-4-237-r3-combined
cd /home/user/workspace/tgp/fixer-mwb-4-237-r3-combined
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/237/head:pr-237
git checkout pr-237
git log -1 --format=%H   # MUST equal 1c63aa2735e687cc9673ca2093081e59f463f02b
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```

## P1 — Row-ID adoption on autosave insert (data-integrity)
READ: `/home/user/workspace/MWB_4_237_R3_CODE_AUDIT_REPORT.md` P1 (full evidence).

Bug: New id-less exercise rows inserted via `upsert_exercise` succeed server-side, but autosave 200 response returns only `head_revision_index/lock_token/saved_at` — NOT the new row IDs. The screen has no `onSaved` handler → no refetch/invalidate → autosave hook advances diff baseline to id-less snapshot → subsequent edits create duplicates or silently drop deletes/reorders.

Fix direction (full):
1. After any successful autosave that inserted id-less rows, refetch/invalidate the plan AND adopt server IDs before allowing subsequent row-level autosaves to diff against id-less baseline.
2. At MINIMUM: pass `onSaved` handler to `useAutosave` from `CoachWorkoutBuilderScreen` that:
   - Detects "pending insert rows existed" (e.g. baseline had any `rowId === undefined`)
   - Triggers refetch/invalidation of the plan query
   - Defers diff baseline advance until refetch returns
3. Include `autosave.hasPending` AND the refetch result identity in the re-baseline `useEffect` dependency array (`CoachWorkoutBuilderScreen.tsx:241-244`, `:273-302`).
4. Add regression tests:
   - add → autosave 200 → edit same row → expect single `upsert_exercise` with `row_id` populated (not duplicate)
   - add → autosave 200 → delete same row → expect `remove_exercise` emitted (not silent skip)
   - add → autosave 200 → reorder → expect `row_ids` includes the now-adopted ID
5. STRONGER (optional, log decision): backend contract change returning `client_temp_id → row_id` map. If you go strong, ALSO log operator decision and ensure backend PR exists / contract is matched.

## P2 — Stale-lock bootstrap UX
READ: `/home/user/workspace/MWB_4_237_R3_UX_AUDIT_REPORT.md` P2.

Bug: All 409 conflicts route to `status='conflict'` + pill copy "Edited elsewhere — tap to refresh". But `autosave_lock_stale` (bootstrap stale-token) is by design and silent recovery should not surface as user-facing conflict copy.

Fix direction:
1. In `useAutosave.ts:442-476` 409 branch, check `err.conflict?.error`:
   - `autosave_lock_stale` AND no prior successful save → internal silent recovery (status='saving' or new status 'syncing'); skip `onConflict` callback
   - `autosave_conflict_retry` or `autosave_lock_stale` AFTER successful save → real conflict, current behavior preserved
2. If a new "syncing" status is added: AutosaveStatusPill maps it to neutral copy like "Syncing latest version…" with `accessibilityLiveRegion="polite"`, non-actionable.
3. Add regression test: first autosave attempt with placeholder token → 409 stale-lock → status NEVER goes to `conflict` user-facing; auto-retries to `saving`/`saved` cleanly.

## Constraints
- R0 hectacorn + 50-Failures all 8 + Bradley #36 + R69 zero schema diff
- NO swallowed catches (incl. tests)
- NO forceExit, NO --detectOpenHandles masks
- NO `as any` / `as unknown as` casts in runtime code
- R66 full `npx jest --runInBand` before push — must exit 0
- R70 fail-fast lane <30s before R66
- Tokens: no raw hex/rgba in components

## Verification
1. tsc --noEmit exit 0
2. lint exit 0
3. Targeted Jest on useAutosave.* + workoutAutosaveDiff.* + CoachWorkoutBuilderScreen.* + AutosaveStatusPill.* exit 0
4. Full `npx jest --runInBand` exit 0
5. R0 grep on diff

## Push
Title-only commit: `fix(mwb-4): #237 autosave row-ID adoption (P1) + stale-lock bootstrap UX (P2)`
Author: Dynasia G <dynasia@trygrowthproject.com>.
Push force-with-lease to PR-237 branch `feature/mwb-4-mobile-autosave`.
After push: `gh api -X POST /repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches -f ref=feature/mwb-4-mobile-autosave`.

Output: `/home/user/workspace/MWB_4_237_R3_COMBINED_FIXER_REPORT.md`
End with `FIX COMPLETE: <sha>` or `FIX BLOCKED: <reason>`.

Sonnet 4.6 FORBIDDEN.
