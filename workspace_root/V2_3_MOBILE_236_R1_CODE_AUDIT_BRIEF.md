# AUDITOR BRIEF — v2-3 mobile #236 R1 code audit

Independent CODE AUDITOR (GPT-5.5, fresh — NOT builder/fixer). Read `/tmp/tgp-agent-context/specs/AUDITOR_BRIEF_COMMON.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`, `/tmp/tgp-agent-context/rules/R65_50_FAILURES_SWEEP.md`. NO code modifications.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #236 — `feature/community-v2-events-mobile`
- HEAD: `a79880745e7e2e33d933c4a09701f7b3559488b8` (post tier-1 fix + rebase onto current main)
- CI: SUCCESS
- Mergeable: CLEAN

## Surface
Community v2 events mobile slice. Pairs with backend PR #389 (now merged) which delivered the events API/RLS.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-v2-3-mobile-r1-code
cd /home/user/workspace/tgp/audit-v2-3-mobile-r1-code
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/236/head:pr-236
git checkout pr-236
git log -1 --format=%H   # MUST equal a79880745e7e2e33d933c4a09701f7b3559488b8
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Gates to run
1. `npx tsc --noEmit` — must be 0 errors
2. `npm run lint` — must be 0 errors
3. `npx jest --runInBand` — full pass (D-011 pre-existing leak is carved out)
4. **R0 grep battery on added lines**:
   ```bash
   git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | \
     grep -vE '^\+\+\+' | \
     grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}'
   ```
5. **Bradley Law #36**: no swallowed catches.
6. **R69**: ZERO Prisma schema diff (mobile PR).
7. **FACE+VOICE**: if any Roman voice copy appears, must have RomanAvatar in same component tree.

## 50-Failures sweep
All 8 categories per added lines. Especially:
- Category 1 (Security): tenant scope on events — coach can only see events for their cohorts; client can only see events for cohorts they belong to
- Category 3 (Performance): no unpaginated event lists, no N+1 queries on event-cohort relationships
- Category 4 (Concurrency/State): React-Query cache keys correct, no stale-while-revalidate races on attendance toggle
- Category 8 (Infra): feature flag `EXPO_PUBLIC_FF_COMMUNITY_EVENTS` default OFF

## Hectacorn quality bar
- Quiet-luxury invariants on added lines (no pictograph emoji, raw hex outside tokens.ts, fontWeight ≤ 600, 48dp tap targets, reduced-motion safe, semantic tokens only)
- a11y on all interactive elements (label, role, hint, state where appropriate)
- Error states are calm; loading states are reduced-motion safe; empty states have clear next-step copy

## Verdict format
`VERDICT: CLEAN | NOT CLEAN`. Enumerate findings P0/P1/P2 with file:line evidence.

Report at `/home/user/workspace/V2_3_MOBILE_236_R1_CODE_AUDIT_REPORT.md`.
