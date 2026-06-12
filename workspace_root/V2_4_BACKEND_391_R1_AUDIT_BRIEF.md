# AUDITOR BRIEF — v2-4 backend #391 R1 code audit

Independent AUDITOR (GPT-5.5, fresh, NOT builder/fixer). Read `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`, `/tmp/tgp-agent-context/rules/R65_50_FAILURES_SWEEP.md`, `/tmp/tgp-agent-context/specs/AUDITOR_BRIEF_COMMON.md`.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-backend`
- PR: #391 — `feature/community-v2-ai-triage` (AI inbox triage backend, pairs with mobile #239)
- HEAD: `8ca1137344c87e17b4266dc45b13b4a5d108bec9` (post tier-1 DI fixer)
- The tier-1 fixer wrapped `TriageCacheService` provider in a `useFactory: () => new TriageCacheService()` to dodge the `Function`-type DI failure on its zero-arg constructor.
- CI: 4/4 GREEN at this HEAD.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-v2-4-backend-r1
cd /home/user/workspace/tgp/audit-v2-4-backend-r1
git clone https://github.com/BradleyGleavePortfolio/growth-project-backend.git .
git fetch origin pull/391/head:pr-391
git checkout pr-391
git log -1 --format='%H'   # MUST equal 8ca1137344c87e17b4266dc45b13b4a5d108bec9
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Severity + merge bar
Standard P0/P1/P2/P3 — CLEAN of P0+P1+P2 to merge.

## 50-Failures sweep (all 8 categories) on added lines
Particular focus areas for this PR:
- **#2 RLS/tenant-scope** — `GET /community/ai-triage` MUST be scoped to the requesting coach. Trace the auth guard + repository query for coach_id filtering.
- **#5 IDOR** — no path/query parameter accepts another coach's ID directly.
- **#8 input validation** — endpoint should have no body; if any future params arrive, they must DTO-validate. Confirm.
- **#12 idempotency** — read-only endpoint, but verify the cache TTL implementation (`TRIAGE_CACHE_TTL_MS`) doesn't accidentally serve another coach's cached payload.
- **#16 races / #28 race conditions** — the cache `useFactory` change: verify singletons are correct (Nest's default-scope `Injectable` is singleton, so the factory-built `TriageCacheService` is one instance per app — correct for in-memory cache).
- **#36 Bradley Law** — ZERO swallowed errors on added lines.
- **#42 test flake** — confirm targeted tests don't introduce timers without cleanup.

## Verify the DI fix specifically
1. Confirm `ai-triage.module.ts` provider entry is `{ provide: TriageCacheService, useFactory: () => new TriageCacheService() }`.
2. Confirm `TriageCacheService` class still has `constructor(private now: () => number = () => Date.now())` (zero-required-arg constructor).
3. Confirm consumers (`AiTriageService` and any cache caller) inject `TriageCacheService` by class token only — NOT a `'CLOCK_FN'` string token.
4. Confirm tests can still construct `new TriageCacheService(fakeNow)` directly for time-control — verify a triage test uses this pattern.
5. Module-graph + openapi-spec + roles-enforced tests should all pass; verify the actual test files exist and assert the right things.

## Cache safety — sensitive checks
- The triage payload contains coach-private message summaries. Confirm the cache key includes the coach ID (NOT just a global `'triage'` key).
- Confirm the cache value is bounded — no unbounded growth (memory leak). Either map-with-eviction, or single-key-per-coach with TTL-based gc.
- Confirm cache TTL is bounded (5 min per `TRIAGE_CACHE_TTL_MS`).

## Counterpart contract (mobile #239 consumes this)
Confirm the response schema EXACTLY matches what the mobile Zod schema expects (mobile PR #239 cited explicit file:line — verify each):
- 5 categories: `urgent`, `win_to_celebrate`, `form_check`, `general`, `no_action_needed` in `triage-output.schema.ts`
- 2 source kinds: `message`, `post`
- `TriageItemSchema` with uuid, kind, category, summary 1..280
- `TriageResponseSchema` with `generated_at` ISO datetime, `is_empty` bool, `buckets` length 5, `source_item_ids` uuid[]
- Endpoint at `GET /community/ai-triage`

If contract drift → P0.

## R0 grep battery + R69 schema check
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' | grep -E '^\+' \
  | grep -nE 'as any|as unknown as|@ts-ignore|@ts-expect-error|TODO|FIXME|Coming soon|catch *\(([^)]*)\) *\{ *\}|\.catch\(\(\) *=> *(undefined|null)\)' \
  && echo "GREP DIRTY" || echo "GREP CLEAN"
git diff origin/main...HEAD -- 'prisma/schema.prisma' && echo "SCHEMA TOUCHED" || echo "SCHEMA CLEAN"
```

## Re-run gates yourself
```bash
npx tsc --noEmit
npx eslint src/
nest build
npx jest --runInBand --testPathPattern "ai-triage|module-graph|openapi|roles-enforced"
```

## Output
Write `/home/user/workspace/V2_4_BACKEND_391_R1_AUDIT_REPORT.md` in standard format. End with literal `VERDICT: CLEAN | NOT CLEAN`. Do NOT modify code.
