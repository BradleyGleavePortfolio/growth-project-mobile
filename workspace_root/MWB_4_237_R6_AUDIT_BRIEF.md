# #237 R6 Audit Brief — MWB-4 mobile autosave (CODE + UX)

## Target
- **Repo**: `BradleyGleavePortfolio/growth-project-mobile`
- **Branch**: `feature/mwb-4-mobile-autosave`
- **HEAD to audit**: `85760165dd9e99680924b0a59ef1adb09339d346`
- **Worktree**: `/home/user/workspace/tgp/audit-mwb-4-237-r6-{code,ux}`

## Setup
```bash
cd /tmp/tgp-agent-context-mobile
git fetch origin feature/mwb-4-mobile-autosave
git worktree add /home/user/workspace/tgp/audit-mwb-4-237-r6-code feature/mwb-4-mobile-autosave
# (parallel: ...r6-ux)
cd /home/user/workspace/tgp/audit-mwb-4-237-r6-code
npm ci
```
Use `api_credentials=["github"]`.

## R31 Independence
GPT-5.5 fresh-context audit. Do NOT read prior reports before recording your independent verdict.

## Context (history)
R5 audit found P1 row-ID adoption race (delete-before-adoption). R5 fixer landed `85760165` implementing **D-045 deletedKeysRef approach (Option A)**:
- New `deletedKeysRef: Set<string>` tracks rows deleted before their first server adoption.
- On delete: add clientId to ref.
- On any subsequent realtime/server event referencing that clientId: ignore.
- New `clientId` field on row.
- 10/10 adoption tests pass.

Also resolves **D-042**: set `hasPending=true` on value-change effect immediately (dirty signal before debounce).

## CODE audit checklist
1. HEAD `85760165` verified.
2. `npm ci` clean.
3. **R0 grep added lines including comments**: no console/TODO/FIXME/@ts-ignore/`as any`/Math.random/Date.now/eval/dangerouslySetInnerHTML.
4. **Bradley Law #36** — ZERO swallowed catches in changed files (including `.catch(() => undefined)` in tests).
5. **R66 full Jest** — `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand --silent` exit 0.
6. **R70 fail-fast** — `npx jest --runInBand src/screens/coach/workout-builder/__tests__/ src/lib/workout-builder/__tests__/` exit 0 <30s.
7. **Typecheck** — `npx tsc --noEmit` exit 0.
8. **R65 50-Failures sweep** all 8 categories on added lines.
9. **Specific D-045 verification**:
   - Verify `deletedKeysRef` Set is created at the right scope (per-screen or per-builder instance).
   - Verify delete handler adds clientId to ref BEFORE the optimistic UI removal.
   - Verify all server-event handlers (realtime, autosave reply, 409 rebase) check `deletedKeysRef.has(clientId)` and skip adoption.
   - Verify ref is cleared appropriately on unmount or session change (no unbounded growth).
   - Verify the new `clientId` field is generated client-side (uuid/nanoid) and persists through the optimistic→adopted lifecycle.
10. **Specific D-042 verification**:
    - Find the value-change effect.
    - Verify `setHasPending(true)` fires synchronously on value change, before the debounce timer.
    - Verify no race where a fast subsequent save can clear `hasPending` for a still-pending edit.
11. **Feature flag posture**: confirm `EXPO_PUBLIC_FF_MWB_AUTOSAVE` defaults to off and the production code path respects the flag.

## UX audit checklist
1. Autosave indicator visibility + state (saving, saved, conflict).
2. 409 rebase user-visible behavior — does the UI signal the rebase happened? Do users lose work?
3. Offline mirror UX — visible offline state, queued ops feedback.
4. Touch targets ≥44pt on new controls.
5. Reduce-motion respected on indicator animations.
6. Live-region announcements for save state transitions (especially "Saved" → polite, "Save failed, retrying" → polite, "Conflict resolved" → polite).
7. Color contrast ≥4.5:1 on indicator text.
8. Loading/empty/error states.

## Verdict format
```
CODE VERDICT: CLEAN | NOT CLEAN
UX VERDICT: CLEAN | NOT CLEAN
```

## Output
- `/home/user/workspace/MWB_4_237_R6_CODE_AUDIT_REPORT.md`
- `/home/user/workspace/MWB_4_237_R6_UX_AUDIT_REPORT.md`

## Findings priority
- P0/P1/P2 as above.
- Do NOT flag pre-existing tech debt.
- Do NOT block on backend / API contract issues that belong elsewhere.
