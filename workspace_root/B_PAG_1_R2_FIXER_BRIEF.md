# B-PAG-1 R2 Fixer Brief — PR #392 (backend pagination)

## Mission
Fix 2 P2s: stale/foreign cursor degradation across `listChallenges` + `listParticipationsByProgress` + `listComments`, and add deterministic `id` tie-breaker to `listChallenges`.

## Target
- **Repo**: `BradleyGleavePortfolio/growth-project-backend`
- **Branch**: `feature/v3-1-pagination-enforcement`
- **HEAD to fix on top of**: `5b1ed2939be171a3c1b9c4954b35a0bc63c45621`
- **Worktree**: `/home/user/workspace/tgp/fixer-b-pag-1-r2`

## Setup
```bash
cd /tmp/tgp-agent-context
git fetch origin feature/v3-1-pagination-enforcement
git worktree add /home/user/workspace/tgp/fixer-b-pag-1-r2 feature/v3-1-pagination-enforcement
cd /home/user/workspace/tgp/fixer-b-pag-1-r2
npm ci
```
Use `api_credentials=["github"]` for all `gh`/`git` calls.

## Fix #1 — listChallenges: stale cursor + tie-breaker

In `src/community/challenges/community-challenges.repository.ts` around lines 125-155:

**1a.** Add deterministic ordering: change `orderBy: { created_at: 'desc' }` to `orderBy: [{ created_at: 'desc' }, { id: 'desc' }]`.

**1b.** Before passing cursor to Prisma, resolve the cursor **inside the same scope** (the visibility/coach filter that the rest of the query uses). Pattern:
```ts
let cursorClause: { id: string } | undefined;
let skipClause: 1 | undefined;
if (params.cursor) {
  const anchor = await this.prisma.community_challenge.findFirst({
    where: { ...filter, id: params.cursor },
    select: { id: true },
  });
  if (anchor) {
    cursorClause = { id: anchor.id };
    skipClause = 1;
  }
}
// Then pass `...(cursorClause ? { cursor: cursorClause, skip: 1 } : {})` to findMany.
```
If anchor is null → omit cursor/skip → degrades to page 1.

## Fix #2 — listParticipationsByProgress (leaderboard): stale cursor

Around lines 336-348, apply the same scoped-anchor pattern. The leaderboard already orders by `[..., { id: 'desc' }]`, so only the stale-cursor degradation is needed. Resolve `params.cursor` inside the same `where` filter (challenge_id + the leaderboard scoping); if not found, omit cursor/skip.

## Fix #3 — listComments: anchor must be scoped

Around lines 467-489: the current anchor lookup is `where: { id: params.cursor }` only. Change to:
```ts
const anchor = await this.prisma.community_message.findFirst({
  where: {
    id: params.cursor,
    plan_context_type: CHALLENGE_COMMENT_CONTEXT_TYPE,
    plan_context_id: params.challengeId,
    deleted_at: null,
  },
  select: { id: true, created_at: true },
});
```
If null → no cursor clause → page 1.

## Test additions (mandatory)

In `src/community/challenges/__tests__/pagination.repository.spec.ts` add cases:

1. **listChallenges with stale cursor** (nonexistent UUID) → returns first page (items length == limit), nextCursor non-null when more rows exist.
2. **listChallenges with foreign cursor** (id of a row outside the visibility filter) → returns first page within scope.
3. **listChallenges tie-breaker stability**: two rows with identical `created_at` paginate deterministically by id desc; page boundaries are stable across two queries.
4. **listParticipationsByProgress with stale cursor** → returns first page.
5. **listParticipationsByProgress with foreign cursor** (id of participation in a different challenge) → returns first page within the challenge scope.
6. **listComments with stale cursor** (nonexistent UUID) → returns first page (this exists already at line 324-337, keep).
7. **listComments with foreign cursor** (id of a message with different `plan_context_type` like a non-challenge community message) → returns first page within scope.
8. **listComments with deleted cursor** (id where `deleted_at != null`) → returns first page within scope.

## R0 / Bradley Law #36 / R66 / R69 / R70

- **R0 grep** on added lines including comments: NO TODO/FIXME, NO `as any`, NO @ts-ignore, NO console (controller/repository tests can mock log).
- **Bradley Law #36**: ZERO swallowed catches in changed files.
- **R69**: NO `prisma/schema.prisma` or `prisma/migrations/**` diff.
- **R70 fail-fast**: `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand src/community/challenges/` — exit 0.
- **R66 full Jest**: `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand --silent` — exit 0.
- **Typecheck**: `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit` — exit 0.

## Commit & push
- **Author**: `Dynasia G <dynasia@trygrowthproject.com>`
- **Title only**: `fix(community): B-PAG-1 R2 — scoped cursor anchors + challenge tie-breaker`
- `git push origin feature/v3-1-pagination-enforcement`

## Output
Write `/home/user/workspace/B_PAG_1_R2_FIXER_REPORT.md` ending with:
```
FIX COMPLETE: <new-HEAD-sha>
```

## DO NOT
- Do NOT change Prisma schema.
- Do NOT add new write routes — this PR is read-only pagination.
- Do NOT change the public cursor format (bare UUID stays bare UUID; the compound is internal only).
- Do NOT change the `take: limit + 1` contract.
