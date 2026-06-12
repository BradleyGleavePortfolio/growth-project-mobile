# AUDITOR BRIEF — v3-1 mobile #235 R2 code audit

Independent CODE AUDITOR (GPT-5.5, fresh — NOT builder/fixer). Read `/tmp/tgp-agent-context/specs/AUDITOR_BRIEF_COMMON.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`, `/tmp/tgp-agent-context/rules/R65_50_FAILURES_SWEEP.md`. NO code modifications.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #235 — `feature/community-v3-challenges-mobile`
- HEAD: `7a4b7aeddecee8f48887ddd92bb3c6262404b114` (post-doctrine fixer + post-rebase)
- CI: SUCCESS
- Mergeable: CLEAN
- Pairs with backend PR #390 (already merged) which delivered v3-1 challenges API

## Surface
Community v3-1 challenges mobile slice: challenge list, challenge detail, join/leave, leaderboard, completion notifications.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-v3-1-mobile-r2-code
cd /home/user/workspace/tgp/audit-v3-1-mobile-r2-code
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/235/head:pr-235
git checkout pr-235
git log -1 --format=%H   # MUST equal 7a4b7aeddecee8f48887ddd92bb3c6262404b114
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Decision context (D-009)
Per D-009, the v3-1 doctrine fixer chose Path B: extend `ALLOWLIST_LEADERBOARD_REFERENCE` for leaderboard tokenization. fontWeight downgrade was still required (no allowlist for that rule). Verify these are in place.

## Gates to run
1. `npx tsc --noEmit` — must be 0 errors
2. `npm run lint` — must be 0 errors
3. `npx jest --runInBand` — full pass (D-011 carve-out)
4. **R0 grep battery on added lines**:
   ```bash
   git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | \
     grep -vE '^\+\+\+' | \
     grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}'
   ```
5. **Bradley Law #36**: no swallowed catches, no `.catch(() => undefined)`.
6. **R69**: ZERO Prisma schema diff (mobile PR).
7. **FACE+VOICE**: any Roman copy must have RomanAvatar in same component tree.

## 50-Failures sweep all 8 categories
Especially:
- Category 1 (Security): tenant scope on challenges — coach can only see their cohorts' challenges; client can only join challenges in their cohorts
- Category 3 (Performance): no unpaginated lists; React-Query keys include all variables; no N+1 on leaderboard rendering
- Category 4 (Concurrency/State): join/leave optimistic updates have proper rollback
- Category 8 (Infra): feature flag `EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES` default OFF

## Verdict format
`VERDICT: CLEAN | NOT CLEAN`. Enumerate P0/P1/P2 with file:line evidence.

Report at `/home/user/workspace/V3_1_MOBILE_235_R2_CODE_AUDIT_REPORT.md`.

## Note for auditor
The PR HEAD includes a tracked `node_modules` symlink from author pollution (per rebase fixer note). This is harmless to CI (which runs `npm ci`) but flag as P3 if you encounter it during audit. NOT a P0/P1/P2 blocker.
