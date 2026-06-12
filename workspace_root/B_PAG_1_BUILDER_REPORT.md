# B-PAG-1 — v3-1 Community Challenges Pagination Enforcement (Backend)

**Authority:** D-040 — Mobile #235 ships defensive request-side `{ limit: 20 }`; backend repository methods still read unbounded. This PR adds the backend half: DTOs accept and enforce `limit`/`cursor`, and the four already-shipped (#390) community-challenge read endpoints become cursor-paginated.

## PR

- **PR number:** #392
- **URL:** https://github.com/BradleyGleavePortfolio/growth-project-backend/pull/392
- **Base:** `main` · **Head:** `feature/v3-1-pagination-enforcement`
- **Branch HEAD SHA:** `5b1ed2939be171a3c1b9c4954b35a0bc63c45621`
- **Author:** Dynasia G <dynasia@trygrowthproject.com>
- **Commit:** title-only, no trailers, no co-author lines — `feat(community): v3-1 challenges pagination enforcement (B-PAG-1)`

## Diff summary

9 files changed, **+885 / −33**.

| File | LOC (Δ) | Change |
|---|---|---|
| `src/community/challenges/community-challenges.dto.ts` | +80 / −9 | `PAGINATION_DEFAULT_LIMIT`/`MAX_LIMIT` consts; `PaginationQueryDto` (limit 1..50 default 20, uuid cursor); `ListChallengesQueryDto extends PaginationQueryDto`; `next_cursor` added to challenge-list / leaderboard / comment-list response schemas |
| `src/community/challenges/community-challenges.repository.ts` | +144 / −~12 | `Page<T>` interface; `clampLimit`; `paginate()` helper; `take: limit+1` + `cursor`/`skip` on `listChallenges`, `listParticipationsByProgress`, `listComments` (composite-PK cursor resolution); `listOptedInUserIds` left unbounded |
| `src/community/challenges/community-challenges.service.ts` | +43 / −12 | thread `limit`/`cursor` through `list` / `getLeaderboard` / `listComments`; build `{ ..., next_cursor }` from the repository page boundary |
| `src/community/challenges/community-challenges.controller.ts` | +7 / −2 | `@Query() PaginationQueryDto` on leaderboard + comments handlers; import |
| `jest.config.js` | +13 / −1 | add `src/community/challenges` as a fourth narrowly-scoped root |
| `src/community/challenges/__tests__/pagination.dto.spec.ts` | +151 (new) | DTO validation |
| `src/community/challenges/__tests__/pagination.repository.spec.ts` | +364 (new) | repository boundaries |
| `src/community/challenges/__tests__/pagination.controller.spec.ts` | +99 (new) | controller query wiring |
| `test/community/challenges/community-challenges.service.spec.ts` | +17 / −6 | update existing leaderboard mock to new `{ items, nextCursor }` repo shape |

## Pagination contract

- **Request:** `limit` (int, 1..50, default 20, coerced from query-string form then validated) + `cursor` (v4 uuid = id of previous page's last item).
- **Repository:** every paginated `findMany` fetches `take: limit + 1`; when a cursor is present adds `cursor` + `skip: 1` to exclude the anchor row.
- **Response:** `{ items, next_cursor }`. `next_cursor` = id of the last **kept** item when the over-fetch returned `limit + 1` rows; `null` on the final page.
  - List keeps `challenges` array name (back-compat with #390) + adds `next_cursor`.
  - Leaderboard adds `next_cursor`; unavailable/opted-out board → `next_cursor: null`. Ranks are page-local; `next_cursor` is derived from the repo page boundary so the next page resumes correctly even if a page's tail is entirely non-consenting.
  - Comments: `CommunityMessage` has composite PK `[id, created_at]`; the bare-id public cursor is resolved to the `id_created_at` compound Prisma cursor. A stale/unresolvable cursor degrades to the first page (no throw).

## Scope compliance

- **R69:** no schema/migration changes (`git diff` touches no `schema.prisma` / `migrations/`). Comments + opt-in still reuse `CommunityMessage` discriminators.
- Challenge join/leave, progress, and opt-in **write** routes untouched (verified by diff grep).
- `listOptedInUserIds` deliberately left unbounded — internal-only `Set<string>` for leaderboard filtering, never feeds a paginated list.

## Verification gates (local)

| Gate | Command | Result |
|---|---|---|
| 1. Install | `npm ci` | **exit 0**; lockfile unchanged |
| 2. Typecheck | `npx tsc --noEmit` (`--max-old-space-size=4096`) | **exit 0** |
| 3. Lint | `npm run lint` / `eslint src/community/challenges/**` | **exit 0** (0 errors; 17 pre-existing warnings repo-wide, none in changed files) |
| 4. Targeted | `npx jest --runInBand src/community/challenges/` | **exit 0** — 3 suites, **31 tests passed** |
| 5. Full test | `npx jest` (= `npm test`, `--max-old-space-size=4096`) | **exit 0** — 394 passed / 12 skipped suites; **5171 tests passed**, 0 failed |
| 6. R0 grep | added lines (885) scanned | **CLEAN** — no TODO/FIXME/XXX/HACK, no `as any`, no `as unknown as`, no `@ts-ignore`/`eslint-disable`, no `console.*`, no bare `: any` |
| Bradley Law #36 | swallowed catches on added lines | **CLEAN** — no `catch` blocks added; nothing to swallow |
| nest build | `npm run build` | **exit 0** |
| R45 grep | `git grep 'tgp\.app'` | **CLEAN** (no banned hostname) |
| dist guard | `git ls-files dist/` | **CLEAN** (empty) |

## CI workflow status

- Backend CI workflow id: **265421167** (`.github/workflows/ci.yml`), jobs: `build-and-test`, `rls-floor-guard`, `rls-live-tests`, `mwb-3-live-tests`. (Other workflows: `verify-doc-refs` 283684271, `verify-push-cadence` 283684272, `fly-deploy` 246633222.)
- Auto-dispatch on push fired CI run **27419031708** (event `pull_request`).
- **Run reported `failure`, but this is a CI INFRASTRUCTURE issue, not a code failure.** Evidence:
  - Run created `13:34:00Z`, completed `13:34:05Z` — **~5 seconds total**; a real `build-and-test` (npm ci + prisma + lint + tsc + build + 5000+ tests) takes minutes.
  - All four jobs report `failure` with **zero executed steps** (empty `steps[]` in the jobs API) — jobs aborted at startup before running anything.
  - Manual re-run (attempt 2) reproduced the identical 5-second, no-steps abort across all four jobs (`13:36:28Z` → `13:36:33Z`).
  - The **same four jobs are GREEN on the base commit** `48f68ede` (run 27409544688: build-and-test/rls-live-tests/mwb-3-live-tests/rls-floor-guard all `success`), confirming the failure is environmental (runner not picking up / aborting jobs), not introduced by this PR.
- All gates the `build-and-test` lane runs were re-confirmed locally and pass (table above), including the full `npm test` suite.

## Sample request / response

`GET /community/workspaces/{workspaceId}/challenges?limit=20&cursor=00000000-0000-4000-8000-000000000004`

```json
{
  "challenges": [
    { "id": "…", "workspace_id": "…", "title": "…", "status": "active", "leaderboard_enabled": false, "...": "…" }
  ],
  "next_cursor": "00000000-0000-4000-8000-000000000024"
}
```

`GET /community/challenges/{challengeId}/comments?limit=20`

```json
{
  "comments": [
    { "id": "…", "challenge_id": "…", "author_user_id": "…", "body": "keep going!", "created_at": "2026-03-01T00:00:01.000Z" }
  ],
  "next_cursor": null
}
```

`GET /community/challenges/{challengeId}/leaderboard?limit=20` (opted-in caller, board enabled)

```json
{
  "available": true,
  "opted_in": true,
  "rows": [ { "user_id": "…", "rank": 1, "progress_value": 90, "is_self": false } ],
  "next_cursor": null
}
```

Boundary behavior (proven by repository tests): `limit=20` over a set of 21 rows returns 20 items with `next_cursor` = the 20th item's id; over 19 rows returns 19 items with `next_cursor: null`; a supplied cursor advances via `cursor` + `skip: 1`.

BUILD COMPLETE: 392 5b1ed2939be171a3c1b9c4954b35a0bc63c45621
