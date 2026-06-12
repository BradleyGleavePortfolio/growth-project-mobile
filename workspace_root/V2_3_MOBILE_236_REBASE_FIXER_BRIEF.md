# FIXER BRIEF — v2-3 mobile #236 rebase fixer R1

You are a FIXER (Opus 4.8, NOT builder/auditor — R31). Author: `Dynasia G <dynasia@trygrowthproject.com>`. Title-only commits, no trailers.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #236 — `feature/community-v2-events-mobile`
- HEAD: `a295cdf4d2995ae8cb6ed69d42d934975ae99327` (post tier-1 TS2352 fix)
- Mobile main: `79c0a9be`
- Status: `mergeable=CONFLICTING, mergeStateStatus=DIRTY` — needs rebase onto current main.
- Tier-1 fixer noted CI did not auto-trigger for this SHA (proxy webhook gap). Rebasing + force-push will trigger CI naturally.

## Likely conflict surface
Based on Roman P1 fixer's resolution pattern (and the same parallel-conflict zone identified in `/tmp/tgp-agent-context/COMMUNITY_PARALLELIZATION_PLAN.md`):
- `.env.example` — additive flag rows (keep ALL flags from both sides)
- `src/config/featureFlags.ts` — additive flag declarations (keep both)
- Possibly `src/community/messages/*` or `CoachCommunityInboxScreen.tsx` (per parallelization plan v2-1+v2-2 conflict zone)

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/fixer-v2-3-mobile-rebase
cd /home/user/workspace/tgp/fixer-v2-3-mobile-rebase
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin
git fetch origin pull/236/head:pr-236
git checkout pr-236
git log -1 --format='%H'   # MUST equal a295cdf4d2995ae8cb6ed69d42d934975ae99327
git config user.email "dynasia@trygrowthproject.com"
git config user.name  "Dynasia G"
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Rebase
```bash
git fetch origin main
git rebase origin/main
```
For EACH conflict:
- `.env.example` → keep BOTH sides' flag rows (no deletions).
- `src/config/featureFlags.ts` → keep BOTH sides' flag declarations.
- ANY OTHER file → resolve as the UNION of both sides (no deletion of either side's logic). If the conflict is in a file where union doesn't make sense (e.g. opposing logic), STOP and write a "BLOCKED" report — escalate.

## Verify (R66 full suite + R70 fail-fast)
```bash
npx tsc --noEmit                                    # 0 errors
npm run lint                                        # 0 errors
npx jest --runInBand src/hooks/__tests__/useReducedMotion.test.tsx  # the tier-1 fix must still pass
npx jest --runInBand                                # full suite, all green
```

## R0 grep battery (added lines incl comments)
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E '^\+' \
  | grep -nE 'as any|@ts-ignore|@ts-expect-error|TODO|FIXME|Coming soon|catch *\(([^)]*)\) *\{ *\}|\.catch\(\(\) *=> *(undefined|null)\)' \
  && echo "GREP DIRTY" || echo "GREP CLEAN"
```
(`as unknown as typeof X` from the tier-1 fix is acceptable — it's paired with a specific target type.)

## Push
```bash
git push origin HEAD:feature/community-v2-events-mobile --force-with-lease
sleep 60
gh pr view 236 --repo BradleyGleavePortfolio/growth-project-mobile --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup
```

If CI does not register a new run within 60s, fire one explicitly:
```bash
gh api repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows --jq '.workflows[] | {id, name, path}'
# pick the CI workflow file path, then:
gh api -X POST repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/<id>/dispatches \
  -f ref=feature/community-v2-events-mobile
```

## Output
Write `/home/user/workspace/V2_3_MOBILE_236_REBASE_FIXER_REPORT.md`:
```
Rebase: origin/main (79c0a9be) ← pr-236 (a295cdf)
Conflicts resolved:
  - <file>: union
Local gates: tsc/lint/jest all green
Pushed: <sha>
CI: <state>
R0 grep: CLEAN
FIX COMPLETE: <sha>
```
End literally with `FIX COMPLETE: <sha>`.
