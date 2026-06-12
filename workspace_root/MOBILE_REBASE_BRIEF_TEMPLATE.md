# REBASE BRIEF TEMPLATE — mobile PR <N>

REBASER (Opus 4.8). NO browser_task. NO github_mcp_direct. `api_credentials=["github"]`.

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR: #<N>
Current HEAD: `<SHA>`
Branch: `<BRANCH>`
Worktree: `/home/user/workspace/tgp/rebase-<N>`

Setup:
```bash
mkdir -p /home/user/workspace/tgp/rebase-<N>
cd /home/user/workspace/tgp/rebase-<N>
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/<N>/head:pr-<N>
git checkout pr-<N>
git log -1 --format=%H   # MUST equal <SHA>
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
git fetch origin main
git rebase origin/main
```

Expected conflict: ONLY `src/config/featureFlags.ts` (UNION resolution — keep both main's rows AND the PR's own row, preserving the existing section comment headers). If ANY other conflict appears, STOP and report blocked.

After UNION resolve:
```bash
git add src/config/featureFlags.ts
git rebase --continue
```

Verify (full):
1. `npm ci` (use cache: `--cache /home/user/workspace/.npm-cache-mobile`)
2. `npx tsc --noEmit` exit 0
3. `npm run lint` exit 0 (or matching baseline)
4. `npx jest --runInBand` exit 0 — if "Jest did not exit" but exit code is 0 (D-011 baseline), OK; if exit code != 0, BLOCK and report
5. R0 grep on diff vs origin/main: no swallowed catches, no TODO/FIXME/console.log/any-cast/pictograph/banned copy

Push + CI dispatch:
```bash
git push --force-with-lease origin pr-<N>:<BRANCH>
gh api -X POST /repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches -f ref=<BRANCH>
gh pr view <N> --repo BradleyGleavePortfolio/growth-project-mobile --json headRefOid,mergeable,mergeStateStatus
```

If rebase changes only featureFlags.ts: no new commit needed (rebase replays existing commits onto new main with the union baked in).

Output: `/home/user/workspace/MOBILE_REBASE_<N>_REPORT.md`
End with `REBASE COMPLETE: <new SHA>` or `REBASE BLOCKED: <reason>`.

Sonnet 4.6 FORBIDDEN.
