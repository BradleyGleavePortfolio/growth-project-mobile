# 07 — Loading / error / empty states

> Pre-build brief. Defines a single contract for what every React Query-backed screen looks like in each non-happy-path state, so the expansion features don't grow eleven different "couldn't load" treatments.

## WHY

The app already uses React Query (persisted) for server state (see `src/services/queryClient.ts` and `src/components/OfflineBanner.tsx`). What is **not** standardised:

- The visual + behavioural treatment for `isLoading` (cold load, no cache) vs `isFetching` (background refresh) vs `isError` (terminal failure) vs `data?.length === 0` (success but empty).
- Whether a screen shows a skeleton, a spinner, or stale-while-revalidate.
- How errors retry — automatic vs user-initiated.
- The empty-state copy and CTA: what the user does next.

Every expansion feature lists data — check-ins, clients, recap drafts, intake templates, starter programs. Without a contract, each will choose its own four states, the app will look uneven, and accessibility regressions ([brief 06](./06-accessibility-readiness.md)) creep in via inconsistent live-regions.

## WHEN

Land this brief before the first React Query consumer in the expansion pack starts (currently #92 item 5: weekly check-ins client). It is also a low-cost retrofit for existing screens later.

## WHERE

When implemented:

- `src/components/patterns/LoadingState.tsx`, `ErrorState.tsx`, `EmptyState.tsx` (per [brief 05](./05-reusable-expansion-ui-patterns.md)).
- `src/components/patterns/AsyncBoundary.tsx` (new) — a small wrapper that takes a React Query result and renders the right state without per-screen branching.
- `docs/PATTERNS_ASYNC.md` (new) — the contract.
- React Query default options possibly tweaked in `src/services/queryClient.ts` (e.g. `retry`, `staleTime`).

## WHO

- **Engineer**: wraps a screen's data block in `<AsyncBoundary query={...}>` rather than writing four `if` branches.
- **Mobile lead**: enforces the wrapper in CR.
- **Designer/operator**: writes the empty-state copy + CTA per feature; copy is kept in feature code, not here.

## WHAT

A four-state contract:

| State | Trigger | Visual | Behaviour |
| --- | --- | --- | --- |
| **Loading (cold)** | First-time fetch, no cached data. | `LoadingState variant="skeleton"`. | No interaction. |
| **Loading (warm)** | Refetch with cached data present. | Stale data shown; small `OfflineBanner`-style indicator at top. | Full interaction; new data swaps in. |
| **Error** | Query rejected, no cached data, or cached data older than the feature's max staleness. | `ErrorState retry={refetch}`. | Tap "Try again" calls `refetch()`. |
| **Empty (success)** | Query fulfilled, `data` is an empty list / null. | `EmptyState title body cta?`. | CTA is feature-specific. |

The wrapper:

```tsx
<AsyncBoundary
  query={query}                    // React Query result
  loading={<LoadingState variant="skeleton" />}
  error={<ErrorState />}
  empty={<EmptyState title="…" body="…" cta={…} />}
  isEmpty={(data) => data.length === 0}
>
  {(data) => <List items={data} />}
</AsyncBoundary>
```

Defaults exist for `loading` and `error`; only `empty` is required (because empty copy is feature-specific).

## HOW

1. Land the three primitives (`LoadingState`, `ErrorState`, `EmptyState`) per [brief 05](./05-reusable-expansion-ui-patterns.md).
2. Add `AsyncBoundary` with the prop shape above.
3. Write `docs/PATTERNS_ASYNC.md` with three short examples (list, single-item, paginated).
4. Migrate two existing screens (proposed: `HomeScreen`'s metric block, `RecipesScreen`'s list) as canonical examples.
5. Tweak `queryClient.ts` defaults: `retry: 2`, `staleTime: 60_000` for read queries (already in place where relevant — verify and codify).

## Expo / EAS considerations

- React Query persisted client is already configured; behaviour depends on `@tanstack/query-async-storage-persister` being able to read/write AsyncStorage on cold start. No new native config.
- Skeletons must not block the splash screen. The skeleton is rendered after the root navigator mounts, not during `bootstrapAuth()`.
- `OfflineBanner` already exists; it overlaps with the "warm loading" indicator. Mitigation: keep `OfflineBanner` for *connectivity* state and use a distinct (subtle) refresh indicator for *fetching* state.

## Acceptance criteria

- `AsyncBoundary` renders the correct state for each of the four triggers, in unit tests.
- Two existing screens are migrated, with no visual regression compared to before (verify by side-by-side screenshot).
- `docs/PATTERNS_ASYNC.md` exists with three runnable examples.
- An `ErrorState` retry button calls `refetch()` exactly once per tap (debounced).
- `EmptyState` is required-prop in `AsyncBoundary` — TypeScript blocks omission.

## Rollout strategy

- **Phase 1**: ship primitives + `AsyncBoundary` + the pattern doc.
- **Phase 2**: migrate two reference screens.
- **Phase 3**: every new screen uses `AsyncBoundary`; CR enforces.
- **Phase 4** (optional): retroactively migrate older screens.
- Rollback: revert per-screen migrations independently.

## Tests

- Unit (`AsyncBoundary.test.tsx`):
  - Renders `loading` when `query.isLoading && !query.data`.
  - Renders cached data + warm indicator when `query.isFetching && query.data`.
  - Renders `error` when `query.isError && !query.data`.
  - Renders `empty` when `query.isSuccess` and `isEmpty(data)`.
- Manual: with the network throttled, observe the refetch indicator. With airplane mode, observe `ErrorState` and the retry behaviour after re-enabling network.

## Risks

- **`OfflineBanner` + warm-loading indicator collide visually**: mitigated by keeping them at different positions or stacking in priority order. Documented in the pattern doc.
- **Empty-state copy is shipped as a default and never customised**: mitigated by making `empty` a required prop. There is no default empty state.
- **Retry storms**: React Query's `retry: 2` already bounds this. The user's manual retry is debounced.
- **Accessibility on error**: error region must use `accessibilityLiveRegion="polite"` so screen readers announce. Embedded in `ErrorState` once.

## Dependencies

- [`05-reusable-expansion-ui-patterns.md`](./05-reusable-expansion-ui-patterns.md) — the three primitives this contract relies on.
- [`06-accessibility-readiness.md`](./06-accessibility-readiness.md) — error live-region rule.
- React Query is already a dependency; no new package.
- No backend dependency.

## Operator handoff

- **Owning surface(s)**: `src/components/patterns/AsyncBoundary.tsx`, `docs/PATTERNS_ASYNC.md`, the three primitive files.
- **Out-of-band steps**: none.
- **Done means**: an engineer writing a new query-backed screen wraps it in `AsyncBoundary`, supplies an `EmptyState`, and gets correct accessible loading / error / empty / warm-refresh behaviour without writing branching logic.
