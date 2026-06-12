# V3-1 Mobile PR #235 — Combined R2 Fixer Report

**Status:** FIX COMPLETE
**Commit:** `fdeab27a4d086dbcf53d3c4ff9ceead00d6af086`
**Author:** Dynasia G <dynasia@trygrowthproject.com> (title-only commit)
**Pushed to:** `feature/community-v3-challenges-mobile` (PR #235 source/head branch) via force-with-lease (lease base `7a4b7aeddecee8f48887ddd92bb3c6262404b114`).
**Base HEAD before fix:** `7a4b7aeddecee8f48887ddd92bb3c6262404b114`

**Commit message (exact):**
`fix(community): #235 v3-1 challenges combined R2 — list semantics, optimistic writes, pagination, reachable route, leave affordance, Bradley`

---

## Operator / product-direction decisions captured

### DECISION 1 — Challenge LEAVE / WITHDRAW: **NO LEAVE** (no client method added)

**Decision:** No `leaveChallenge` / withdraw client method was added.

**Rationale (zero-drift):** The binding backend (growth-project-backend PR #390 head) `community-challenges.controller.ts` exposes exactly twelve routes — create, patch, archive, list, getOne, leaderboard, comments(list), join, progress, leaderboard-opt-in, comments(post), report. There is **no** `DELETE join`, no `/leave`, and no `/withdraw` route, and `community-challenges.dto.ts` defines no leave DTO. Adding a client `leaveChallenge` method would **fabricate a contract the backend does not serve** — the exact failure class already corrected once in this PR (the invented `getCommentsEmptyState` endpoint, F1 P0) — and would violate the zero-drift posture (R69 / the F2 strict-drift suite owns the contract).

**Reversible affordance that DOES exist:** A participant can withdraw from the cohort leaderboard at any time via `setLeaderboardOptIn(challengeId, false)` — the "Stop sharing my progress" / "Keep private" affordance in the detail screen. This is preserved and is the reversible withdrawal the surface offers today.

**Flagged for operator/product:** Full challenge withdrawal (leaving a challenge entirely / resetting participation) requires a backend route first. This is escalated for product decision — if "leave a challenge" is a desired product capability, the backend must add a `DELETE /community/challenges/:id/join` (or `/leave`) route + DTO before the client can honestly expose it. Documented in-code at `src/api/communityChallengesApi.ts` (LEAVE/WITHDRAW comment block, ~line 347).

### DECISION 2 — Pagination: **REQUEST-only** (no response envelope invented)

**Decision:** Added bounded `limit` (+ optional `cursor`) request parameters to `listChallenges` / `getLeaderboard` / `listComments`, page limits into the React Query keys, and a `FlatList` for leaderboard rows. **Did not** add a `next_cursor`/cursor field to the response Zod schemas.

**Rationale (zero-drift):** The backend response contract serves no cursor envelope. Inventing a `next_cursor` response field would drift from the binding backend and trip the F2 strict-drift suite. Requests are capped (Category 3 — no unbounded fetches) while the response schemas stay `.strict()` and unchanged. A drift test pins that a server-sent `next_cursor` is **rejected** as a contract error.

**Exports added:** `CHALLENGES_PAGE_LIMIT=20`, `CHALLENGE_COMMENTS_PAGE_LIMIT=20`, `CHALLENGE_LEADERBOARD_PAGE_LIMIT=20`, `PageParams` interface, `pageParams()` helper.

### DECISION 3 — `listitem` accessibility role: container-`list` only

**Decision:** Used `accessibilityRole="list"` on the `FlatList` containers (challenge list, comments list, leaderboard list); each row is an addressable wrapper `View` **without** a `listitem` role.

**Rationale:** React Native 0.85.3's typed `AccessibilityRole` union includes `'list'` but **not** `'listitem'`. Assigning `'listitem'` would require an unsafe cast, which R0 forbids. The supported, type-clean signal for collection membership is the parent `accessibilityRole="list"` plus an addressable per-row wrapper. Documented in-code at each list site.

---

## Findings closed (7 P1 + 2 P2)

| ID | Pri | Finding | Resolution |
|----|-----|---------|------------|
| P1-code-1 / ux-1 | P1 | Challenges discovery route unreachable / functionally empty (no workspace id, no tab entry) | `CommunityChallengesScreen` resolves `workspaceId` internally via `useCommunityMe` when no prop is supplied (deep-link safe); added a flag-gated **Challenges** tab to `CommunityTabScreen` so the list is reachable from the visible client UI. Integration test pins `listChallenges('ws-id', {limit:20})` fires when reachable. |
| P1-code-2 | P1 | `ChallengeProgressSheet` haptic used a silent catch (Bradley #36) | Replaced with an unsupported-platform branch (`Platform.OS === 'web' → return`) + structured non-PII `logger.warn('ChallengeProgressSheet.completionHaptic', {platform, reason})` for unexpected native rejections. No swallowed catch. |
| P1-code-3 | P1 | Unbounded list/leaderboard/comments fetches (Category 3) | Added `limit`/`cursor` request params + `pageParams()` helper to `listChallenges`/`getLeaderboard`/`listComments`; page limits folded into React Query keys; leaderboard rows render via `FlatList` (N+1 render gate). Request-only pagination (see Decision 2). |
| P1-ux-2 | P1 | Join + leaderboard opt-in had no optimistic UX | Optimistic `join` and `setLeaderboardOptIn` mutations via `onMutate` (provisional cache write) / `onError` (exact-snapshot rollback) / `onSettled` (server reconcile). Rollback surfaces a calm banner **and** announces it to assistive tech via `AccessibilityInfo.announceForAccessibility` (live-region). |
| P1-ux-3 | P1 | Missing list/listitem semantics on collections | `accessibilityRole="list"` on the challenge list, comments list, and leaderboard `FlatList`s; rows are addressable wrapper Views (see Decision 3). |
| P1-code-1 / ux-4 (leave) | P1 | Leave/withdraw affordance | **NO-LEAVE operator decision** (see Decision 1); leaderboard opt-out preserved as the reversible withdraw affordance. |
| P2-ux-1 | P2 | Loading states lacked busy/progressbar semantics | Loading containers carry `accessibilityState={{busy:true}}`; `ActivityIndicator`s carry `accessibilityRole="progressbar"` + descriptive `accessibilityLabel`. |
| F10-class | P2 | (covered) typed mock surface | Detail-test mock kept via `jest.mocked()`; new tests follow the same typed pattern. |

---

## Files changed (9)

- `src/api/communityChallengesApi.ts` — pagination params/helper + page-limit exports + LEAVE/WITHDRAW operator-decision comment block.
- `src/api/__tests__/communityChallengesApi.drift.test.ts` — updated default-call assertion to `{params:{limit:'20'}}`; added explicit limit+cursor, bounded leaderboard/comments, and no-cursor-in-response drift tests.
- `src/components/community/ChallengeProgressSheet.tsx` — haptic platform branch + structured logger (Bradley #36).
- `src/components/community/SpaceTabBar.tsx` — `CommunitySpaceKey` adds `'challenges'`.
- `src/screens/community/CommunityTabScreen.tsx` — flag-gated Challenges tab entry + embedded render.
- `src/screens/community/CommunityChallengesScreen.tsx` — internal workspace-id resolution, page-limited query, `FlatList` list semantics, busy/progressbar loading, cast-free queryFn guard.
- `src/screens/community/CommunityChallengeDetailScreen.tsx` — optimistic join + opt-in mutations w/ rollback + live-region announce; page-limited comments/leaderboard queries; list semantics; busy/progressbar loading.
- `src/screens/community/__tests__/CommunityChallengeDetailScreen.test.tsx` — fixed `getLeaderboard` assertion to `('ch-1', {limit:20})`; re-export page-limit constants in the module mock; added optimistic join-rollback and opt-in-rollback tests.
- `src/screens/community/__tests__/CommunityChallengesScreen.test.tsx` — **new** suite: internal workspace-id resolution, disabled fetch when no id, explicit-prop precedence, bounded fetch.

---

## Verification gates (all green on the committed tree)

1. `npx tsc --noEmit` → **exit 0** (zero errors).
2. ESLint on changed files → **exit 0** (one pre-existing unrelated `navigation` unused-var warning in `CommunityTabScreen`, not in the diff; 0 errors).
3. Targeted Jest (detail, challenges, drift, flag-off, reduced-motion, card) → **exit 0**.
4. Full `npx jest --runInBand` → **215 suites / 2374 tests / 5 snapshots — all pass, exit 0.** No `forceExit`, no `--detectOpenHandles` mask. (The benign "Jest did not exit one second after the test run" notice originates from RN `Animated` timers in the progress-sheet celebration animation; the run completes successfully.)
5. R0 grep on the diff — clean: no raw hex/rgba, no `fontWeight > 600`, no `as any`/`as unknown`/unsafe casts (the one `workspaceId as string` was removed in favor of a type-clean queryFn guard), no `forceExit`/`detectOpenHandles`, no empty/swallowed catch, no `console.log`, no emoji.

**Other constraints honored:** R69 — no Prisma schema files touched (zero schema diff). D-009 — cohort leaderboard allowlist preserved (untouched). FACE+VOICE — challenges screens kept NEUTRAL (no Roman voice copy added). Navigator flag-off test (`communityChallengesFlagOff.test.ts`) still passes — `CommunityNavigator.tsx` was not touched (the tab gate lives in `CommunityTabScreen`).

---

FIX COMPLETE: fdeab27a4d086dbcf53d3c4ff9ceead00d6af086
