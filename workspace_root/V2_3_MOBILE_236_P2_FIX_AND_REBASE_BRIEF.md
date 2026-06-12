# FIXER+REBASE BRIEF — v2-3 mobile #236 P2 cache-key + rebase onto main

FIXER (Opus 4.8). Surgical. NO browser_task. NO github_mcp_direct. `api_credentials=["github"]`.

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR: #236
Current HEAD: `e668a8e079710f78e47499a2463f9fe128e12f01`
Branch: `feature/community-v2-events-mobile`
Worktree: `/home/user/workspace/tgp/fixer-v2-3-mobile-236-p2-rebase`

Setup:
```bash
mkdir -p /home/user/workspace/tgp/fixer-v2-3-mobile-236-p2-rebase
cd /home/user/workspace/tgp/fixer-v2-3-mobile-236-p2-rebase
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/236/head:pr-236
git checkout pr-236
git log -1 --format=%H   # MUST equal e668a8e079710f78e47499a2463f9fe128e12f01
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
```

## Step 1 — Close P2 (cache-key omission on `before`)

Read: `/home/user/workspace/V2_3_MOBILE_236_R2_CODE_AUDIT_REPORT.md` (P2-1)

Fix: pick ONE of these (preferred = option A, narrow the type):
- **Option A**: Narrow `useCommunityEventsList(opts: Omit<ListEventsOptions, 'before'>)` so single-query hook cannot pass `before`. Update callers if any. Keep `useCommunityEventsInfiniteList()` accepting full options (its key already cursorless by design).
- **Option B**: Add separate single-page key that includes `before`, keep infinite-query key cursorless.

Verify with: `npx tsc --noEmit` exit 0, ESLint exit 0, targeted Jest on useCommunityEvents.* and CoachCommunityEventsScreen.* exit 0.

`npm ci` first.

## Step 2 — Rebase onto `origin/main`

```bash
git fetch origin main
git rebase origin/main
```

Expected conflict: `src/config/featureFlags.ts` (UNION needed — keep both v2-4 AI triage row AND v2-3 events row). Resolve via UNION ONLY. If any other conflict appears, STOP and report blocked.

```bash
git add src/config/featureFlags.ts
git rebase --continue
```

## Step 3 — Full verification on rebased branch

1. `npx tsc --noEmit` exit 0
2. `npm run lint` exit 0 (or matching baseline)
3. `npx jest --runInBand` exit 0
4. R0 grep on diff vs origin/main — clean

## Step 4 — Push + CI dispatch

```bash
git push --force-with-lease origin pr-236:feature/community-v2-events-mobile
# Trigger workflow_dispatch:
gh api -X POST /repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches -f ref=feature/community-v2-events-mobile
```

## Step 5 — Verify
```bash
gh pr view 236 --repo BradleyGleavePortfolio/growth-project-mobile --json headRefOid,mergeable,mergeStateStatus
```

Should show MERGEABLE/CLEAN. Capture new HEAD SHA.

Commit title: `fix(community): #236 v2-3 events cache-key + rebase onto main`
Author: Dynasia G <dynasia@trygrowthproject.com>, title-only commit, no trailers.

Output report: `/home/user/workspace/V2_3_MOBILE_236_P2_FIX_AND_REBASE_REPORT.md`
End with `FIX COMPLETE: <sha>` or `FIX BLOCKED: <reason>`.

Sonnet 4.6 FORBIDDEN.
