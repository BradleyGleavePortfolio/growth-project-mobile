# V2-3 Mobile #236 Combined Fixer R1 — Report

**FIX COMPLETE: e668a8e079710f78e47499a2463f9fe128e12f01**

- **Repo:** BradleyGleavePortfolio/growth-project-mobile
- **PR:** #236
- **Branch:** `feature/community-v2-events-mobile`
- **Original PR HEAD (before fix):** `a79880745e7e2e33d933c4a09701f7b3559488b8`
- **New HEAD (pushed):** `e668a8e079710f78e47499a2463f9fe128e12f01`
- **Push:** `a798807..e668a8e  HEAD -> feature/community-v2-events-mobile` (force-with-lease, PUSH_EXIT 0)
- **Remote verified:** `git ls-remote origin feature/community-v2-events-mobile` → `e668a8e079710f78e47499a2463f9fe128e12f01`
- **Author:** Dynasia G <dynasia@trygrowthproject.com> (title-only commit, NO trailers)
- **Commit message:** `fix(v2-3-events): a11y (live region/list role/loading label/48dp), rejected-promise tests, cursor pagination, query key`
- **Carve-out:** D-011 (React-Query open-handle / "Jest did not exit one second after the test run" leak) — known, expected, not introduced by this commit.

---

## Findings Closed (all P1 + P2 from both audits)

### CODE audit

| # | Pri | Finding | Before | After |
|---|-----|---------|--------|-------|
| C1 | P1 | Swallowed `.catch(() => undefined)` masks rejection in hook tests | Two test cases ended in `.catch(() => undefined)` so a non-throwing mutation would pass silently | Replaced with `await expect(...).rejects.toThrow('boom')` / `.rejects.toThrow('nope')` in `useCommunityEvents.test.tsx`. Comment reworded to avoid the literal `.catch(() => undefined)` token so the Bradley grep does not false-positive. |
| C2 | P2 | React Query list cache key omits `limit` | `communityEventsKeys.list` keyed only on workspace/state/cohort → different page sizes collided in cache | Added `limit` to the list key. Cursor `before` intentionally NOT in the key (threaded via `pageParam` so all pages share one infinite cache entry). |
| C3 | P2 | No cursor pagination | List fetched a single page; no way to load older events | Added `before?: string` (keyset cursor) to `ListEventsOptions` and threaded into `communityEventsApi.list()`. New `useCommunityEventsInfiniteList` hook (`useInfiniteQuery`, `initialPageParam: undefined`, `getNextPageParam: (last) => last.next_before ?? undefined`). Coach screen flattens `pages.flatMap(p => p.events)`, wires `onEndReached` (guarded by `hasNextPage && !isFetchingNextPage`), `onEndReachedThreshold={0.4}`, and a `ListFooterComponent` load-more spinner. `useCreateEvent` optimistic insert/rollback rewritten to the `InfiniteData` shape. |
| C4 | P2 | Sub-48dp tap targets (code) | `reflectTrigger` / `modalButton` minHeight 44 | minHeight 44→48. |

### UX audit

| # | Pri | Finding | Before | After |
|---|-----|---------|--------|-------|
| U1 | P1 | Sub-48dp tap targets (UX) | `rsvpQuiet`, `retry` minHeight 44 (detail); modal/reflect triggers 44 (coach) | All raised to minHeight 48. |
| U2 | P1 | Loading states lack a11y labels | Bare `ActivityIndicator` spinners | Wrapped in `<View accessibilityRole="progressbar" accessibilityLabel="Loading events"/"Loading event"/"Loading more events" accessibilityState={{ busy: true }}>` with testIDs (`coach-community-events-loading`, `coach-community-events-load-more`). |
| U3 | P1 | Coach list lacks list/listitem semantics | FlatList + cards had no list semantics | FlatList wrapped in `<View accessibilityRole="list" testID="coach-community-events-list">`; `EventCard` wrapped in `<View role="listitem">` (W3C `role` prop used because RN's `AccessibilityRole` type lacks `'listitem'` but its `Role` type includes it; inner press target keeps `accessibilityRole="button"`). |
| U4 | P2 | RSVP/link errors not announced | Plain `Text` error nodes | `linkError` and `rsvpError` wrapped in `<View accessibilityLiveRegion="polite">`. |
| U5 | P2 | Misleading "Pull to retry" copy | Error state said "Pull to retry." but interaction is a tap | Copy changed to "Tap to retry." |

---

## Files Modified (8)

1. `src/api/communityEventsApi.ts` — `before?: string` keyset cursor on `ListEventsOptions`; threaded into `list()`.
2. `src/hooks/useCommunityEvents.ts` — `limit` in list key; new `useCommunityEventsInfiniteList`; `useCreateEvent` rewritten for `InfiniteData`; kept legacy `useCommunityEventsList`.
3. `src/components/community/EventCard.tsx` — wrapper `<View role="listitem">`; inner target keeps `accessibilityRole="button"`.
4. `src/screens/community/CoachCommunityEventsScreen.tsx` — infinite list usage, page flatten, `onEndReached`, loading + load-more progressbars, list semantics, "Tap to retry." copy, minHeight 44→48, `loadMore` style.
5. `src/screens/community/CommunityEventDetailScreen.tsx` — loading progressbar; live region around `linkError`/`rsvpError`; minHeight 44→48 on `rsvpQuiet`/`retry`.
6. `src/hooks/__tests__/useCommunityEvents.test.tsx` — rejected-promise assertions; InfiniteData seeds/assertions; +4 tests (keyset pagination ×2, list-key request-shaping ×2).
7. `src/screens/community/__tests__/communityEventsScreens.test.tsx` — mock switched to `useCommunityEventsInfiniteList` with paged data + `hasNextPage`/`isFetchingNextPage`/`fetchNextPage`; +6 tests (list semantics, loading label, tap-not-pull copy, onEndReached fetches, onEndReached no-op, load-more footer announces).
8. `src/components/community/__tests__/EventCard.test.tsx` — +1 test (press target `accessibilityRole === 'button'` and wrapper `role: 'listitem'`).

**New tests added: ~11** (4 hooks + 6 screens + 1 card).

---

## Verification Results

| Check | Result |
|-------|--------|
| Typecheck `tsc --noEmit` | **TSC_EXIT: 0** |
| Lint (changed files) | **ESLINT_EXIT: 0** |
| Full jest `npx jest --runInBand` | **216 suites passed, 2406 tests passed, 5 snapshots passed** (0 FAIL). Baseline was 216/2395; +11 new tests → 2406. |
| Full jest exit signature | Process hung on **"Jest did not exit one second after the test run has completed."** — the carved-out **D-011** React-Query open-handle leak. `Ran all test suites.` printed, zero failures; hung process killed. Expected, not introduced by this commit. |
| **R0 grep battery** (my-commit-only diff) | **MY-DIFF CLEAN.** (Full-PR diff retains 2 pre-existing non-blocking hits NOT from me: a `#389` backend-PR ref in a comment in `communityEventsApi.drift.test.ts`, and `as unknown as typeof AccessibilityInfo.addEventListener` in `useReducedMotion.test.tsx:49` — both present on PR head before my commit, audit-classified P3 non-blocking.) |
| **Bradley Law swallowed-catch** (full PR diff) | **BRADLEY CLEAN.** |
| **Tap-target** (added minHeight 40–47) | **TAP CLEAN.** |
| **R69 Prisma/schema diff** | **NO SCHEMA DIFF.** |

---

## Key Decisions

- New `useInfiniteQuery` hook added rather than replacing the single-query hook → satisfies cursor pagination while keeping optimistic mutations and existing single-query tests intact. Detail screen has no list (only `useCommunityEvent`), so "both list screens" reduces to the one coach list screen.
- `useCreateEvent` invalidation uses prefix `[...all, 'list', workspaceId]`, which matches the infinite query key (reconciles on settle).
- RN list semantics: container uses `accessibilityRole="list"` (valid in `AccessibilityRole`); items use the W3C `role="listitem"` prop (`AccessibilityRole` type lacks `'listitem'`, but the `Role` type includes it).
- `CoachErrorState.tsx` retry has `minHeight: 44` but is a shared pre-existing v1-6 component outside the PR's added lines and outside the carve-out scope; not flagged by either audit → intentionally left alone.
