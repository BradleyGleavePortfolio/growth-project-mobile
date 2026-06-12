# FIXER BRIEF — V2-4 BACKEND (PR #391) — TIER-1 CI-RED FIX (DI WIRING)

## Role and stakes

You are an Opus 4.8 **tier-1 fixer**. PR #391 (`feature/community-v2-ai-triage`, backend) is the v2-4 AI inbox triage read-only generation slice. CI is RED at HEAD `23414c81` with **10 test failures** that all share a single root cause: a Nest DI error in `AiTriageModule`. The PR has NOT been audited yet — your job is **CI-green at HEAD only**. Do NOT introduce new features, refactor unrelated code, or "improve" anything outside the DI fix. **R31 separation of duties** in force.

## Required reading (no skim)

1. `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md` — canonical fixer template.
2. `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md` — for the regression sweep.
3. Read the failing tests themselves before fixing:
   - `test/roles-enforced.spec.ts`
   - `test/module-graph.spec.ts`
   - `test/openapi-spec.spec.ts`

## Setup

- Tooling: `bash` + `gh` with `api_credentials=["github"]`. **NEVER use browser tools.**
- Clone fresh to `/home/user/workspace/tgp/fixer-v2-4-backend`. Don't reuse stale worktrees.
- Verify HEAD at start: `gh pr view 391 --repo BradleyGleavePortfolio/growth-project-backend --json headRefOid` should show `23414c81...`.
- Backend main has MOVED to `5e5d3b1127a3` (after v3-1 #390 merged). Rebase before final push.

## The failure (from CI run 27389930034)

**All 10 failures share one root cause** — Nest can't compile the AppModule graph because `AiTriageModule` doesn't provide `TriageCacheService`'s dependency:

```
Nest can't resolve dependencies of the TriageCacheService (?). Please make sure that the argument Function at index [0] is available in the AiTriageModule module.
```

The failures cascade through:
- `test/roles-enforced.spec.ts` — needs the full AppModule to enumerate routes.
- `test/module-graph.spec.ts` — directly tests `Test.createTestingModule({ imports: [AppModule] }).compile()`.
- `test/openapi-spec.spec.ts` — generates OpenAPI from the compiled app.

## The fix

1. Read `src/community/ai-triage/triage-cache.service.ts` (or wherever `TriageCacheService` lives — discover via `grep -rn "TriageCacheService" src/`). Find its constructor.
2. Identify the unsatisfied constructor parameter at index 0. Common causes:
   - A `@Inject(SOME_TOKEN)` whose provider isn't registered in `AiTriageModule.providers`.
   - A dependency from another module that needs `imports: [OtherModule]` and `OtherModule` must `exports: [Dep]`.
   - A circular dependency requiring `forwardRef(() => OtherModule)`.
   - A bare class constructor that needs the class added to `providers` of the module.
3. Apply the **minimal** wiring fix. Prefer adding the missing entry to `providers` or `imports` over restructuring the module.
4. Verify by running `test/module-graph.spec.ts` alone — it must compile without `UndefinedModuleException` or unresolved-dep errors.

## Gates (RUN ALL — R66/R70)

1. **Typecheck**: `npx tsc --noEmit` — 0 errors.
2. **Lint**: `npx eslint src/ test/` — 0 errors.
3. **Fail-fast lane** (R70): `npx jest --runInBand --testPathPatterns "module-graph|roles-enforced|openapi-spec"` < 60s — all green.
4. **Targeted suite**: `npx jest --runInBand --testPathPatterns "ai-triage|community"` — green.
5. **Full suite** (R66): `npx jest --runInBand` — all green.
6. **R69 schema invariant**: `git diff origin/main -- prisma/schema.prisma` must be EMPTY.

If a gate fails, fix it. Do NOT silence or skip tests.

## R65 50-Failures sweep on the diff

Run on `git diff origin/main..HEAD`:

- **#14–20 architecture** — the fix is itself architectural (DI wiring). Verify you didn't introduce a circular dep (`npx madge --circular src/`), a global mutable singleton, or a god-module pattern.
- **#36 silent failure (Bradley Law)**: ZERO `.catch(() => undefined)`, `catch(e) {}`, `catch(e) { console.log` in new lines.
- **R0 grep battery on added lines**: `as any`, `as unknown as`, `@ts-ignore`, TODO/FIXME, "Coming soon", empty `.catch`, sonnet — ZERO.

## Push and PR body

- Commit titles only, author `Dynasia G <dynasia@trygrowthproject.com>`, no trailers.
- Rebase onto current `origin/main` before final push: `git push --force-with-lease origin feature/community-v2-ai-triage`.
- Update PR #391 body via `gh api PATCH /repos/.../pulls/391` (NOT `gh pr edit`) with: "Tier-1 CI fix: TriageCacheService DI wiring in AiTriageModule resolves UndefinedModuleException across module-graph, roles-enforced, openapi-spec suites. All gates green."

## Report

Write `/home/user/workspace/V2_4_BACKEND_TIER1_FIXER_REPORT.md`:
- Pre/post HEAD SHAs.
- Per-failure fix: one row with file:line evidence of the DI fix.
- Gate output excerpts (tsc 0, lint 0, jest pass count, R69 empty diff).
- 50-Failures sweep one-line-per-category.
- CI confirmation: `gh pr checks 391` green.

End your completion message **exactly** as: `FIX COMPLETE: <new-sha>`

## What you must NOT do

- Do NOT modify the triage business logic, controllers, or DTOs — only DI wiring.
- Do NOT add `as any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`.
- Do NOT touch `prisma/schema.prisma` (R69 — this PR must have ZERO schema diff).
- Do NOT skip tests.
- Do NOT use `gh pr edit` — use REST `gh api PATCH`.
- Do NOT use browser tools or `github_mcp_direct`.
