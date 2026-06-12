# FIXER BRIEF — v3-1 mobile #235 rebase fixer R1

FIXER (Opus 4.8 ONLY — Sonnet 4.6 FORBIDDEN). Author: `Dynasia G <dynasia@trygrowthproject.com>`. Title-only commits, no trailers.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #235 — `feature/community-v3-challenges-mobile`
- HEAD: `32bef8c85d` (post doctrine fixer)
- Mobile main: latest (post #236 rebase landing — currently `~79c0a9be` or its descendants)
- Status: `mergeable=CONFLICTING, mergeStateStatus=DIRTY`

Per D-010: #236 was rebased first; now #235 can rebase onto the same updated main. Same conflict surface (`.env.example` + `featureFlags.ts`) — resolve as UNION.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/fixer-v3-1-mobile-rebase
cd /home/user/workspace/tgp/fixer-v3-1-mobile-rebase
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin
git fetch origin pull/235/head:pr-235
git checkout pr-235
git log -1 --format='%H'   # MUST equal 32bef8c85d (or its latest descendant if doctrine fixer pushed more)
git config user.email "dynasia@trygrowthproject.com"
git config user.name  "Dynasia G"
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Rebase
```bash
git fetch origin main
git rebase origin/main
```
For EACH conflict:
- `.env.example` → keep BOTH sides' flag rows (no deletions). Likely conflicts with `EXPO_PUBLIC_FF_COMMUNITY_EVENTS` (now on main from #236) AND `EXPO_PUBLIC_FF_COMMUNITY_ACKS` (already there).
- `src/config/featureFlags.ts` → keep BOTH sides' flag declarations. `communityChallenges` flag is yours; the others (`communityAcks`, `communityEvents`) are now on main.
- ANY OTHER file → resolve as UNION. If conflict is opposing-logic, STOP and write BLOCKED report.

## Verify (R66 + R70)
```bash
npx tsc --noEmit           # 0 errors
npm run lint               # 0 errors
npx jest --runInBand       # full pass (modulo D-011 pre-existing leak)
```

### D-011 carve-out
Pre-existing React-Query leak suites — not your regression:
- `src/hooks/useWearablePreference.test.tsx`
- `src/screens/client/wearables/__tests__/cards.test.tsx`
- `src/__tests__/coachLtvDashboard.test.tsx`
- `src/components/coach/ai-budget/__tests__/AIBudgetMount.test.tsx`
- `src/screens/day-one/__tests__/day1OnboardingScreens.test.tsx`

## R0 grep battery on added lines
```bash
git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | \
  grep -vE '^\+\+\+' | \
  grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}' || echo "CLEAN"
```
Must be CLEAN.

## Push
```bash
git push origin HEAD:feature/community-v3-challenges-mobile --force-with-lease
```
If CI doesn't auto-trigger within 60s, dispatch:
```bash
gh api -X POST repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches \
  -f ref=feature/community-v3-challenges-mobile
```

Report `FIX COMPLETE: <new SHA>` at `/home/user/workspace/V3_1_MOBILE_235_REBASE_FIXER_REPORT.md`. Include full jest result, R0 grep CLEAN, post-push CI run URL.

## Quality gate
PR is `MERGEABLE/CLEAN`. CI green. No regression.
