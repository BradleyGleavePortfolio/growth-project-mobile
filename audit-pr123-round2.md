# PR #123 — Audit Round 2

**Branch:** `feat/phase-11-workout-builder`
**Scope:** Re-audit after applying the two round-1 follow-ups.

## Round-1 follow-ups verified

### F1. `commandCenterApi.getLtvMetrics` — `__DEV__` breadcrumb on catch

- ✅ Catch arm now logs `console.warn('[commandCenterApi.getLtvMetrics]', err)` behind `__DEV__`.
- ✅ Production builds (where `__DEV__ === false`) still see zero log noise — no PII leakage and no Sentry double-report.
- ✅ Mirrors the existing pattern in `CoachLtvDashboard.tsx:471`. Consistent posture across the LTV stack.
- **Verdict:** Clean.

### F2. `EmptyStateNoClients` — drop dead `loading`, replace closure-`code` with a ref

- ✅ `loading` state variable + `setLoading(false)` removed. No call site read it, no render branch depended on it; the three-way `state` enum is the single source of truth for which view to render. Dead-code rule (ENGINEERING_RULES §7) satisfied.
- ✅ `codeRef` mirrors the latest `code` so the mount-only effect's `catch` branch can decide whether an optimistic MMKV value is already on-screen without re-creating the effect on every `code` change. The deps array stays `[]` — the effect is now genuinely a one-shot hydrator and that is reflected in the code, not just in a comment.
- ✅ Added a `cancelled` guard + cleanup return so a fast-unmounting parent (e.g. coach drilling out of the Clients screen before the network round-trips) does not call `setState` after unmount. This was a latent bug in the original — not the cause of the typecheck failure, but a textbook "missing-cleanup useEffect" AI failure pattern. Addressed.
- ✅ Lint passes on this file with no new warnings; the previous `react-hooks/exhaustive-deps` warning is gone because the closure now only reads from a ref.
- ✅ No conditional hook calls. No hydration race. No swallowed errors that the user would feel — the share/copy/skeleton/notfound branches are unchanged.
- **Verdict:** Clean.

## Re-audit of round-1 changes that weren't touched again

| Area | Re-checked | Result |
|---|---|---|
| `invites.ts` resendInvite optional email | Caller still passes `invite.clientEmail`; backend body is `{}` only when no email is on the invite record. | ✅ |
| `CoachInvitesScreen` resendInvite call | Diff is one line, no hook changes. | ✅ |
| `aiGatewayClient.ts` typed meta + narrowDisabledReason | Helper is exhaustive on the union; default arm preserves fail-closed posture. | ✅ |
| Test file mocks (top-level jest.mock) | All 17 sibling tests still pass; no resetModules cross-talk. | ✅ |

## Sweep against the AI-coding failure patterns

| Pattern | Status |
|---|---|
| Race conditions in async effects | Addressed in F2 via `cancelled` flag + cleanup. The only other async effect I touched is the `(_path) => commandCenterApi.getLtvMetrics()` lambda in `OverviewScreen.tsx`, which is inside `CoachLtvDashboard` and is unmodified by this PR; its own component already handles cleanup via `load(false)` + state guards. |
| Hydration timing (state set before mount) | `EmptyStateNoClients` now uses `cancelled` guard. The PR-original workout-builder fix (`44bfa0b`) blocks save during hydration — verified still in place. |
| Conditional hook calls | None of my edits add a hook inside a branch. All `useState`/`useEffect`/`useRef`/`useCallback`/`useMemo` calls are unconditional, top-of-function. |
| Missing useEffect deps | Was present in `EmptyStateNoClients` pre-PR; fixed in F2. Other files I touched don't use `useEffect`. |
| Swallowed errors | `getLtvMetrics` catch now warns in dev. `EmptyStateNoClients` clipboard catch is intentional (best-effort UX, Share affordance remains). `narrowDisabledReason` default arm maps to the safest enum value. |
| Missing awaits | None. All `async` calls are awaited or explicitly `.catch()`-chained at the call site. |
| `any` types | None introduced. The `unknown as { setString }` cast in the old Clipboard fallback is gone. |
| `@ts-ignore` / `eslint-disable` | None added anywhere. |
| Raw error codes shown to user | All UI error paths in changed code use either themed copy ("Set up your invite code in Settings…") or the existing `errorMessage()` helper (`CoachInvitesScreen` resend failure). No `err.message`, no axios string, no HTTP status leaked. |
| WCAG AA contrast | All themed colors in changed files use the existing token system; the dark-mode tokens were verified in commit `a56f7fc`. My changes do not introduce hard-coded hex values. |
| Never shrink / delete features | No feature paths removed. `EmptyStateNoClients` retains all three branches; `resendInvite` retains its 404 `supported:false` UX hide; `aiGatewayClient` retains the same six disabled-reason branches; the LTV dashboard gains an explicitly-typed API surface where before it had a runtime-only call. |

## Cross-cutting items intentionally NOT changed in this PR

These were spotted during the audit but are out of scope for "make PR #123 CI green":

1. **15 unrelated test suites failing on `main`** — documented in `audit-pr123-round1.md` § C. Need separate triage; fixing them requires either (a) backend coordination on live API contracts or (b) reverting recent production code, both of which violate the rules for this PR's scope.
2. **`CoachWorkoutBuilderScreen.tsx` is now >500 lines** — a worthy refactor (split into search panel, form panel, hydration hook) but not blocking, and not requested.

## Conclusion

**Zero new findings in round 2.** The round-1 follow-ups landed cleanly and pass typecheck + lint + the 41 tests across the files I touched (workout-builder, empty-states, invitesApi). The PR is ready to ship.
