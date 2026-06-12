# V2-4 BACKEND TIER-1 FIXER REPORT — PR #391

**Repo:** BradleyGleavePortfolio/growth-project-backend
**Branch:** feature/community-v2-ai-triage
**Author:** Dynasia G <dynasia@trygrowthproject.com>
**Role:** v2-4 backend TIER-1 FIXER (CI-green at HEAD; no audit)

## HEAD SHAs

| Stage | SHA |
|---|---|
| Pre-fix HEAD (as briefed) | `23414c81000df683e8858dfd1727856256d0b4ab` |
| Backend main rebased onto | `5e5d3b1127a3` (`community: v3-1 challenges (#390)`) |
| **Post-fix HEAD (pushed)** | **`8ca1137344c87e17b4266dc45b13b4a5d108bec9`** |

Branch history after rebase:
```
8ca11373 fix(community): wire TriageCacheService via factory so AppModule DI resolves   <- fix commit
8c599072 feat(community): v2-4 AI inbox triage (read-only generation)                   <- builder commit (rebased)
5e5d3b11 community: v3-1 challenges (#390)                                               <- current origin/main
```

## Root cause

`src/community/ai-triage/triage-cache.service.ts:34` —

```ts
constructor(private readonly now: () => number = () => Date.now()) {}
```

`TriageCacheService`'s sole constructor parameter is an injectable clock with a
production default. Nest's DI reads that parameter's design-time type via
`reflect-metadata` as `Function`; with no `@Inject()` token and no registered
provider for it, the container cannot resolve the dependency. Compiling
`AppModule` therefore threw:

```
Nest can't resolve dependencies of the TriageCacheService (?). Please make sure
that the argument Function at index [0] is available in the AiTriageModule module.
```

Every failing test compiles the full `AppModule`, so the single DI error
cascaded into all 10 failures.

## The fix (DI wiring only — one file)

`src/community/ai-triage/ai-triage.module.ts` — replaced the bare class entry in
`providers` with a factory provider so Nest constructs the cache through its
zero-arg constructor (taking the `Date.now` default) instead of attempting to
inject the `Function` parameter:

```ts
{ provide: TriageCacheService, useFactory: (): TriageCacheService => new TriageCacheService() }
```

Diff: **1 file changed, 10 insertions(+), 1 deletion(-)**. No business-logic,
controller, DTO, or service-method change. The class contract is unchanged — the
unit tests still construct `TriageCacheService` directly with an injected clock
(`new TriageCacheService(() => now)`) for deterministic TTL assertions, and the
service-level tests construct it with no arg (`new TriageCacheService()`).

## Per-failure fix table

All 10 failures share the one root cause and one fix. Evidence: `git diff`
touches only `src/community/ai-triage/ai-triage.module.ts:37` (the factory
provider line), resolving the unsatisfied `TriageCacheService` dep that crashed
`AppModule` compilation.

| # | Failing suite | Failing assertion / path | Fix evidence | Result |
|---|---|---|---|---|
| 1 | test/module-graph.spec.ts | `compiles AppModule without throwing UndefinedModuleException` | ai-triage.module.ts:37 factory provider | PASS |
| 2 | test/module-graph.spec.ts | `has no unexpected directed import cycles` | same | PASS |
| 3 | test/roles-enforced.spec.ts | `every route handler has @Roles or @Public` (needs AppModule.compile) | same | PASS |
| 4 | test/roles-enforced.spec.ts | `RolesGuard is registered as a global APP_GUARD` | same | PASS |
| 5 | test/openapi-spec.spec.ts | `declares OpenAPI 3.1` (needs compiled app) | same | PASS |
| 6 | test/openapi-spec.spec.ts | `publishes the expected metadata` | same | PASS |
| 7 | test/openapi-spec.spec.ts | `publishes the bearer security scheme` | same | PASS |
| 8 | test/openapi-spec.spec.ts | `includes the documented auth paths` | same | PASS |
| 9 | test/openapi-spec.spec.ts | `tags auth and users operations` | same | PASS |
| 10 | test/openapi-spec.spec.ts | `has @ApiOperation summary on the documented auth endpoints` | same | PASS |

## Gate output

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **0 errors** (exit 0) |
| Lint (CI) | `npm run lint` (`eslint "src/**/*.ts"`) | **0 errors**, 17 pre-existing warnings (unchanged from base) |
| Lint (changed file) | `npx eslint src/community/ai-triage/ai-triage.module.ts` | **0 problems** |
| Build | `npm run build` (`nest build`) | exit 0 |
| Fail-fast lane | `npx jest --runInBand --testPathPatterns "module-graph\|roles-enforced\|openapi-spec"` | **3 suites / 12 tests PASS** |
| Targeted | `npx jest --runInBand --testPathPatterns "module-graph\|roles-enforced\|openapi-spec\|ai-triage"` | **7 suites / 56 tests PASS** |
| Full suite | `npx jest --runInBand` (run in 20 batches to fit sandbox memory) | **381 suites PASS, 0 FAIL** (9 `describe.skip` suites skipped; all 390 spec files covered) |
| Circular deps | `npx madge --circular --extensions ts src/` | **11 pre-existing, ZERO new, none in ai-triage** (identical count at base HEAD) |
| **R69 schema invariant** | `git diff origin/main -- prisma/schema.prisma` | **EMPTY (0 lines)** |

Note on lint scope: CI's lint step is `npm run lint` = `eslint "src/**/*.ts"`
(src only), which is clean. A broader `eslint src/ test/` surfaces 12 errors, but
all 12 are **pre-existing** in unrelated test files (`meal-plans.service.spec.ts`,
`v1-coach.service.spec.ts`, `triage-output.schema.spec.ts`, etc.) — verified
identical (12 errors / 36 warnings) at the original HEAD before this change, and
none are in the changed file. They are out of scope (test files, not DI wiring)
and are not run by CI.

## R65 / 50-Failures sweep (on `git diff origin/main`)

- **#14–20 Architecture** — Fix is a factory provider; ZERO new circular deps
  (madge identical to base), no global mutable singleton (cache lifecycle
  unchanged — still one instance per module scope), no god-module. CLEAN.
- **#36 Silent Failures (Bradley Law)** — no `.catch(() => undefined/null/{})`,
  no empty `catch(e) {}` in added lines. CLEAN.
- **R0 grep battery on added lines (incl. comments)** — zero `as any`,
  `as unknown as`, `@ts-ignore`, `eslint-disable`, `TODO`, `FIXME`,
  `"Coming soon"`, `sonnet`. CLEAN.

## CI confirmation

`gh pr checks 391` on HEAD `8ca11373`:

```
build-and-test    pass   6m59s
mwb-3-live-tests  pass   2m43s
rls-floor-guard   pass   17s
rls-live-tests    pass   1m57s
```

**All checks GREEN.** PR body updated via `gh api -X PATCH /repos/.../pulls/391`
(builder description preserved, Tier-1 fix note appended).

FIX COMPLETE: 8ca1137344c87e17b4266dc45b13b4a5d108bec9
