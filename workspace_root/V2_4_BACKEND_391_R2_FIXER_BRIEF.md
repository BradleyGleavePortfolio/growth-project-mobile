# FIXER BRIEF — v2-4 backend #391 R2 fixer (2 P2)

FIXER (Opus 4.8 ONLY — Sonnet 4.6 FORBIDDEN). NOT builder. NOT auditor. Fix 2 P2 findings from R1 audit. Read `/home/user/workspace/V2_4_BACKEND_391_R1_AUDIT_REPORT.md`. Read `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md`.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-backend`
- PR: #391, HEAD `8ca1137344c87e17b4266dc45b13b4a5d108bec9`
- Backend main: `97560d31` (post-#389 merge — REBASE onto current main first!)
- Author: `Dynasia G <dynasia@trygrowthproject.com>` (title-only commits, NO trailers)

## Worktree (isolated)
```bash
mkdir -p /home/user/workspace/tgp/fixer-v2-4-backend-r2
cd /home/user/workspace/tgp/fixer-v2-4-backend-r2
git clone https://github.com/BradleyGleavePortfolio/growth-project-backend.git .
git fetch origin
git fetch origin pull/391/head:pr-391
git checkout pr-391
git rebase origin/main   # rebase onto post-#389 main
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Findings to fix

### P2 — Unbounded cache Map (memory leak risk)
- File: `src/community/ai-triage/triage-cache.service.ts:31,57-74`
- `store: Map<string, CacheEntry>` keyed by coach id. Set() appends/replaces; expired entries deleted only when same coach calls get(). No max-size eviction; no TTL sweep.
- **Fix**: Add a max-size cap (e.g. `MAX_CACHE_ENTRIES = 1000`) with LRU eviction (re-insert on access to move to tail; evict head when over cap). Also add an opportunistic TTL purge: on every `set()`, sweep through and delete any expired entries from OTHER coaches (cap inspection cost — only check first N entries, or use a separate TTL queue). Add tests:
  1. Inserts beyond MAX_CACHE_ENTRIES evict oldest.
  2. Expired entries for OTHER coaches are eventually collected.
  3. Access updates LRU position.

### P2 — N+1 cohort name lookup
- File: `src/community/ai-triage/ai-triage.service.ts:314-325`
- `resolveCohortNames()` runs `Promise.all(unique.map(id => findCohort(id)))` — up to 100 queries per cache miss.
- **Fix**: Add a batch method `findCohortsByIds(ids: string[]): Promise<Array<{id, name}>>` to `CommunityAccessService` (or the appropriate repo) using a single `findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })`. Replace the `Promise.all(map)` with one batch call. Add a test that proves the SQL is issued exactly once.

## Mandatory checks (R0 hectacorn)

1. **R0 grep battery on added lines (incl. comments)**:
   ```bash
   git diff origin/main...HEAD -- '*.ts' | grep -E '^\+' | \
     grep -vE '^\+\+\+' | \
     grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}' || echo "CLEAN"
   ```
2. **R69 (Prisma)**: ZERO Prisma schema diff (`git diff origin/main...HEAD -- '**/*.prisma'` must be empty).
3. **Bradley Law #36**: ZERO swallowed catches.
4. **Build**: `npx nest build` — must succeed.
5. **Targeted tests**: `npx jest --runInBand --testPathPatterns "ai-triage|module-graph|openapi|roles-enforced"` — must pass.
6. **Full test suite**: `npx jest --runInBand` — must pass.

## Push + finish
```bash
git add -A
# Make ONE commit for the cache fix and ONE for N+1, OR amend into existing if rebasing. Acceptable: single squash commit.
git commit -m "fix(ai-triage): bounded LRU cache with TTL sweep + batch cohort name lookup (P2)"
git push origin HEAD:feature/community-v2-ai-triage --force-with-lease
```
Then report:
```
FIX COMPLETE: <new SHA>
Report at /home/user/workspace/V2_4_BACKEND_391_R2_FIXER_REPORT.md
```

Report must include: changed files, R0 grep result (CLEAN), Prisma schema diff (empty), full test suite result, before/after for cache and cohort N+1.

## Quality gate
Both P2 findings closed. No regression. CI green after push.
