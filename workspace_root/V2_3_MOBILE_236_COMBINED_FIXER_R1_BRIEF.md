# FIXER BRIEF — v2-3 mobile #236 combined code+UX fixer R1

FIXER (Opus 4.8 ONLY — Sonnet 4.6 FORBIDDEN). NOT builder. NOT auditor. Closes ALL P1+P2 from code audit (`/home/user/workspace/V2_3_MOBILE_236_R1_CODE_AUDIT_REPORT.md`) + UX audit (`/home/user/workspace/V2_3_MOBILE_236_R1_UX_AUDIT_REPORT.md`). Read both first, plus `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md` and `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md`.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #236 — `feature/community-v2-events-mobile`
- HEAD: `a79880745e7e2e33d933c4a09701f7b3559488b8` (post-rebase + clean CI)
- Author: `Dynasia G <dynasia@trygrowthproject.com>` (title-only commits, NO trailers)

## Worktree (isolated)
```bash
mkdir -p /home/user/workspace/tgp/fixer-v2-3-mobile-combined
cd /home/user/workspace/tgp/fixer-v2-3-mobile-combined
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/236/head:pr-236
git checkout pr-236
git log -1 --format=%H   # MUST equal a79880745e7e2e33d933c4a09701f7b3559488b8
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Findings to fix

### CODE — P1: Swallowed `.catch(() => undefined)` in tests (Bradley Law #36)
- File: `src/hooks/__tests__/useCommunityEvents.test.tsx:158, 223`
- Pattern: `await mutateAsync(...).catch(() => undefined)` — hides thrown error class/message.
- **Fix**: Replace with explicit rejection assertion:
  ```ts
  await expect(mutateAsync(badInput)).rejects.toThrow(/expected message regex/);
  ```
  Pick the actual error class/message from the test context. Do NOT use `.catch(() => undefined)` anywhere.

### CODE — P2: React Query list key omits `limit`
- File: `src/hooks/useCommunityEvents.ts:40-47` (key) + `src/api/communityEventsApi.ts:273-293` (request)
- `communityEventsKeys.list` does not include `opts.limit` even though `limit` is part of the request.
- **Fix**: Include every request-shaping option in the cache key: workspace, state, cohort, limit, AND any future cursor (see next finding). Pattern:
  ```ts
  list: (workspaceId, opts = {}) => [
    'community-events', workspaceId, 'list',
    { state: opts.state ?? null, cohortId: opts.cohortId ?? null, limit: opts.limit ?? null, before: opts.before ?? null }
  ] as const,
  ```

### CODE — P2: `next_before` pagination not usable in mobile UI
- File: `src/api/communityEventsApi.ts:112-116, 273-277` (schema exposes `next_before`) + `src/screens/community/CoachCommunityEventsScreen.tsx:272-284` (FlatList no `onEndReached`)
- Mobile request options have no cursor param; coach FlatList has no load-more path.
- **Fix**:
  1. Add `before?: string` to `ListEventsOptions` and thread through API params.
  2. Add infinite query OR manual cursor state. Simplest: convert `useCommunityEvents` list to `useInfiniteQuery` with `getNextPageParam: (last) => last.next_before ?? null`.
  3. Wire `FlatList.onEndReached` → `fetchNextPage()`. Add calm loading footer (e.g. `ActivityIndicator` with a11y label "Loading more events").
  4. Update coach AND client event list screens to use the same pattern.

### CODE+UX — P1: Sub-48dp tap targets
- Files:
  - `src/screens/community/CommunityEventDetailScreen.tsx:623-630` (`rsvpQuiet` minHeight: 44)
  - `src/screens/community/CommunityEventDetailScreen.tsx:668-671` (`retry` minHeight: 44)
  - `src/screens/community/CoachCommunityEventsScreen.tsx:1026-1030` (`reflectTrigger` minHeight: 44)
  - `src/screens/community/CoachCommunityEventsScreen.tsx:1042-1045` (`modalButton` minHeight: 44)
- **Fix**: Change all `minHeight: 44` on interactive controls to `minHeight: 48`. Ensure modal action rows don't compress below.

### UX — P1: Loading states lack a11y labels
- Files:
  - `src/screens/community/CommunityEventDetailScreen.tsx:116-119` (event detail spinner)
  - `src/screens/community/CoachCommunityEventsScreen.tsx:222-225` (coach events spinner)
- **Fix**: Wrap each `ActivityIndicator` in a `View` with:
  ```tsx
  <View accessibilityRole="progressbar" accessibilityLabel="Loading events" accessibilityState={{ busy: true }}>
    <ActivityIndicator color={tokens.colors.accent} />
  </View>
  ```
  Customize label per surface (`"Loading event"` for detail, `"Loading events"` for list).

### UX — P1: Coach event list missing list/listitem semantics
- File: `src/screens/community/CoachCommunityEventsScreen.tsx:272-283` (FlatList) + `src/components/community/EventCard.tsx:115-120` (card root)
- **Fix**:
  1. Add `accessibilityRole="list"` to the FlatList container (wrap in `View` if FlatList doesn't accept role prop directly).
  2. In `EventCard.tsx`, change the root `HapticPressable accessibilityRole` to use `"button"` for press semantics BUT wrap the entire card in a `View accessibilityRole="listitem"`. Or: keep `button` on inner press target and add `listitem` to outer wrapper.

### UX — P2: RSVP/link error messages not announced
- Files:
  - `src/screens/community/CommunityEventDetailScreen.tsx:314-320` (rsvpError)
  - `src/screens/community/CommunityEventDetailScreen.tsx:295-301` (linkError)
- **Fix**: Wrap each error `Text` in a `View` with `accessibilityLiveRegion="polite"`:
  ```tsx
  <View accessibilityLiveRegion="polite">
    <Text>{rsvpError}</Text>
  </View>
  ```
  Or use `AccessibilityInfo.announceForAccessibility(message)` from the mutation error callback.

### UX — P2: Misleading "Pull to retry" copy in error branch
- File: `src/screens/community/CoachCommunityEventsScreen.tsx:235-241`
- Error message currently says "Could not load your events. Pull to retry." — but pull-to-refresh isn't available in error branch (only in non-error FlatList branch).
- **Fix**: Change copy to match the actual affordance: `"Could not load your events. Tap to retry."` — and confirm the `CoachErrorState` retry button is the available control.

## Mandatory checks (R0 hectacorn)

1. **R0 grep battery on added lines (incl. comments)**:
   ```bash
   git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | \
     grep -vE '^\+\+\+' | \
     grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}' || echo "CLEAN"
   ```
2. **Bradley Law specific re-check**:
   ```bash
   git diff origin/main...HEAD | grep -E '^\+' | grep -E '\.catch\(\s*\(\)\s*=>\s*undefined' && echo "VIOLATION" || echo "BRADLEY CLEAN"
   ```
3. **R69 (Prisma)**: ZERO Prisma schema diff (mobile PR).
4. **FACE+VOICE**: confirm no new Roman copy added without RomanAvatar.
5. **Full test suite**: `npx jest --runInBand` — must pass. D-011 carve-out maintained.
6. **Tap target check**:
   ```bash
   git diff origin/main...HEAD | grep -E '^\+.*minHeight:\s*4[0-7]' && echo "SUB-48DP" || echo "TAP CLEAN"
   ```

### D-011 pre-existing leak suites
Same list — not yours to fix here.

## Push + finish
```bash
git add -A
git commit -m "fix(v2-3-events): a11y (live region/list role/loading label/48dp), rejected-promise tests, cursor pagination, query key"
git push origin HEAD:feature/community-v2-events-mobile --force-with-lease
```
Then report:
```
FIX COMPLETE: <new SHA>
Report at /home/user/workspace/V2_3_MOBILE_236_COMBINED_FIXER_R1_REPORT.md
```

Report must include:
- Changed files
- Before/after for each finding
- R0 grep result, Bradley Law check, tap target check (all CLEAN)
- Full jest result with D-011 leak signature
- New tests added (rejection-asserting + cursor pagination)

## Quality gate
ALL P1+P2 from BOTH audits closed. CI green after push. No regression.
