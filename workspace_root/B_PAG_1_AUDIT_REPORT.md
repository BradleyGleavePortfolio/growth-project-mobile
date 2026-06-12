# B-PAG-1 Audit Report — PR #392

VERDICT: NOT CLEAN

## Scope audited

- Repository: `BradleyGleavePortfolio/growth-project-backend`
- Branch: `feature/v3-1-pagination-enforcement`
- HEAD verified: `5b1ed2939be171a3c1b9c4954b35a0bc63c45621`
- Base: `origin/main` (`48f68ede4afed9225b252f89e8800c867c831778` from `gh pr view`)
- Diff: 9 files, +885 / -33; saved full diff to `/home/user/workspace/B_PAG_1_PR392.diff`
- Builder report cross-reference read only after independent source/diff inspection.

## Verdict summary

The PR is close on the core `limit + 1` pagination implementation, controller DTO wiring, no-schema/no-write-route scope, and test volume. It is **not clean** because the cursor contract is not fully correct:

1. **P2 — stale/foreign cursor does not reliably degrade to the first page for challenge list, leaderboard, or comments.** Direct Prisma cursors in `listChallenges` and `listParticipationsByProgress` are passed without first resolving an in-scope anchor; a local Prisma 6.19.3 reproduction showed a nonexistent cursor returns `[]`, not page 1. `listComments` resolves the bare id, but the resolution is unscoped (`where: { id }` only), so a deleted/foreign/community-message id can become a compound cursor outside the filtered comment set and return `[]`, not page 1.
2. **P2 — challenge list pagination order is not fully deterministic.** `listChallenges` orders only by `created_at desc` while cursoring by `id`; unlike leaderboard and comments, it lacks an `id` tie-breaker, so equal timestamps can produce unstable page boundaries.

No P0/P1 found.

## Pagination contract correctness evidence

### Passing evidence

- DTO adds `PaginationQueryDto` with optional `limit` and `cursor`; `limit` is transformed from query-string integer text, then validated with `@IsInt`, `@Min(1)`, and `@Max(50)`, and `cursor` is validated as UUID v4 (`src/community/challenges/community-challenges.dto.ts:189-202`).
- Repository defensive clamp exists: missing limit defaults to 20, non-finite defaults to 20, and finite values are truncated/clamped to 1..50 (`src/community/challenges/community-challenges.repository.ts:30-37`).
- `listChallenges`, `listParticipationsByProgress`, and `listComments` all use `take: limit + 1` (`community-challenges.repository.ts:133`, `343`, `488`).
- `paginate()` drops the overflow row and derives `nextCursor` from the last kept item; it returns `nextCursor: null` when no overflow row exists (`community-challenges.repository.ts:147-155`).
- Response schemas add `next_cursor` to challenge list, leaderboard, and comment list (`community-challenges.dto.ts:278-282`, `311-322`, `344-349`).
- Targeted pagination tests pass: `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand src/community/challenges/` -> 3 suites, 31 tests passed.
- Typecheck passes: `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` -> exit 0.

### Failing evidence: stale/foreign cursor degradation

- `listChallenges` passes `cursor: { id: params.cursor }, skip: 1` directly to Prisma with no in-scope anchor resolution and no fallback branch (`community-challenges.repository.ts:125-138`).
- `listParticipationsByProgress` does the same direct Prisma cursor pass-through (`community-challenges.repository.ts:336-348`).
- `listComments` resolves a bare id to `id_created_at`, but the anchor lookup is `where: { id: params.cursor }` only; it does not require `plan_context_type`, `plan_context_id`, or `deleted_at: null` to match the subsequent page query (`community-challenges.repository.ts:467-489`).
- The repository test covers comments only for an **unresolvable** cursor returning no Prisma cursor clause (`pagination.repository.spec.ts:324-337`); it does not cover challenge-list stale cursors, leaderboard stale cursors, or comments cursors that resolve to a row outside the challenge/deleted filter.
- Local Prisma 6.19.3 behavior check saved to `/home/user/workspace/B_PAG_1_cursor_repro.txt`: nonexistent direct cursor returned `[]`, and a cursor row outside the filtered set returned `[]`; neither degraded to first page.

Expected fix: resolve cursor anchors inside the same filter/scope before adding `cursor + skip`; if not found, omit the cursor clause and return the first page. For comments, anchor lookup should include `plan_context_type: CHALLENGE_COMMENT_CONTEXT_TYPE`, `plan_context_id: params.challengeId`, and `deleted_at: null` before building `id_created_at`.

### Failing evidence: challenge list stable ordering

- `listChallenges` orders by `{ created_at: 'desc' }` only (`community-challenges.repository.ts:132`) but derives the replay cursor from `id` (`community-challenges.repository.ts:134-135`, `151-153`).
- Leaderboard and comments correctly include stable `id` tie-breakers (`community-challenges.repository.ts:338-342`, `487`), showing the challenge list is the outlier.

Expected fix: order challenge list by `[{ created_at: 'desc' }, { id: 'desc' }]` or equivalent deterministic ordering, and keep cursor semantics aligned with that ordering.

## Composite PK + stale cursor evidence

- Composite PK handling for comments is partially correct: public cursor is bare comment id, repository resolves `created_at`, and builds `cursor: { id_created_at: { id, created_at } }` (`community-challenges.repository.ts:467-475`).
- Stale `findFirst` returning null degrades to first page because `cursorClause` stays null and no cursor/skip is spread into `findMany` (`community-challenges.repository.ts:466-489`), covered by `pagination.repository.spec.ts:324-337`.
- Not clean: the anchor resolution is unscoped, so a bare id from a different challenge/message type or deleted row is treated as valid and used as an out-of-filter compound cursor; local Prisma check shows out-of-filter cursor returns `[]` rather than first page.

## Service threading evidence

- Challenge list threads `query.limit` and `query.cursor` to the repository and returns `next_cursor: page.nextCursor` after post-fetch visibility filtering (`community-challenges.service.ts:353-384`). This avoids deriving `next_cursor` from the filtered visible slice.
- Leaderboard threads `query.limit` and `query.cursor` to the repository and returns `next_cursor: page.nextCursor` after opt-in filtering (`community-challenges.service.ts:574-603`). This avoids stranding later pages when non-consenting rows are filtered out.
- Comments thread `query.limit` and `query.cursor` to the repository and return `next_cursor: page.nextCursor` (`community-challenges.service.ts:626-640`). No post-fetch filter is applied there.

## Controller @Query DTO wiring

- Challenge list already used `@Query() query: ListChallengesQueryDto`; that DTO now extends `PaginationQueryDto` (`community-challenges.controller.ts:117-123`, `community-challenges.dto.ts:205-214`).
- Leaderboard now accepts `@Query() query: PaginationQueryDto` and forwards it to `getLeaderboard` (`community-challenges.controller.ts:140-147`).
- Comments now accept `@Query() query: PaginationQueryDto` and forward it to `listComments` (`community-challenges.controller.ts:152-158`).
- Controller wiring tests pass and cover list, leaderboard, and comments forwarding (`pagination.controller.spec.ts`, 4 cases).

## Test coverage

- New pagination suites include 31 test cases: controller 4, DTO 14, repository 13.
- Existing service spec file has 25 test cases and was adjusted for the new `{ items, nextCursor }` repository shape.
- Coverage includes DTO validation bounds/string coercion/UUID, repository default/clamp/take+1/boundary/null cursor/cursor+skip, comment composite cursor, controller query forwarding.
- Missing coverage: stale/foreign cursors for challenge list and leaderboard; comments cursor that resolves to a deleted/foreign/out-of-filter row; challenge list tie-break stability.

## R0 + Bradley Law #36 + R69 + R31 + R65 + write-route sweep

- R0 added-line sweep over 885 added lines: 0 TODO/FIXME/XXX/HACK, 0 console/debugger, 0 `as any` / `as unknown as` / bare `: any`, 0 `@ts-ignore` / `eslint-disable`, 0 stub/placeholder/fake-data markers.
- Bradley Law #36: 0 added `catch` blocks; no swallowed catches found.
- R69 schema/migration scope: no diff under `prisma/schema.prisma` or `prisma/migrations/**`.
- R31 distinct builder/auditor: commit author/committer is `Dynasia G <dynasia@trygrowthproject.com>`; this report is an independent GPT-5.5 audit in a fresh clone/worktree.
- R65 50-Failures sweep on added lines, 8 categories checked: secrets/tokens, raw env defaults, unsafe raw SQL, type/check suppressions, skipped tests, swallowed catches, PII logging/console output, unbounded external read patterns. No hits requiring action; three added `findMany` hits all include `take: limit + 1` in the same query.
- No write routes touched: controller diff only imports `PaginationQueryDto` and adds `@Query()` to two GET handlers; grep found no added `@Post`, `@Put`, `@Patch`, `@Delete`, `@Body`, or write handler definitions.

## Local verification

- `npm ci --prefix /home/user/workspace/tgp/audit-b-pag-1`: exit 0.
- `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand src/community/challenges/`: exit 0, 31 tests passed.
- `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit`: exit 0.
- Changed-file ESLint: 0 errors, 2 warnings in existing service spec (`User` and `owner` unused), not introduced in production code.

## Final assessment

The implementation enforces bounded reads and correctly threads repository page boundaries through post-fetch filtering, but it fails the required stale-cursor degradation contract and leaves one cursor path without deterministic ordering. These are P2 pagination correctness issues, so the PR is not clean until fixed and covered by tests.

VERDICT: NOT CLEAN
