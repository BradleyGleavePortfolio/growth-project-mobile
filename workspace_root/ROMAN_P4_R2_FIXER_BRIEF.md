# Roman P4 R2 Fixer Brief — PR #242 (HEAVY)

## Mission
Fix 4 P1s + 3 P2s from R1 audit. Per D-049: **NO MMKV install** (AsyncStorage fallback is spec-compliant — `src/storage/mmkv.ts` handles it).

## Target
- **Repo**: `BradleyGleavePortfolio/growth-project-mobile`
- **Branch**: `feature/roman-p4-ed3-ed4-showpieces`
- **HEAD to fix on top of**: `904c182dcc0afea8daa936c803438830229e947f`
- **Worktree**: `/home/user/workspace/tgp/fixer-roman-p4-r2`

## Setup
```bash
cd /tmp/tgp-agent-context-mobile
git fetch origin feature/roman-p4-ed3-ed4-showpieces
git worktree add /home/user/workspace/tgp/fixer-roman-p4-r2 feature/roman-p4-ed3-ed4-showpieces
cd /home/user/workspace/tgp/fixer-roman-p4-r2
npm ci
```
Use `api_credentials=["github"]` for all `gh`/`git` calls.

## Fix #1 — P1-1: ED.4 ProgressChartCard NOT WIRED (CRITICAL)

**Problem**: `ProgressChartCard` exists at `src/screens/client/progress/ProgressChartCard.tsx:88` but no production file imports it. `src/screens/client/ProgressScreen.tsx:490-495` still renders `TgpLineChart`.

**Fix**:
- In `src/screens/client/ProgressScreen.tsx`, replace the `TgpLineChart` import + render with `ProgressChartCard` from `./progress/ProgressChartCard`.
- Pass through the same data props (chart data series). Map the existing data shape to `ProgressChartCard`'s expected props. If the shape differs, add an adapter inline at the call site.
- Preserve any existing surrounding container/spacing.

**Test addition**: Add a smoke test that `ProgressScreen` renders `ProgressChartCard` (snapshot or `getByTestId` if testIDs exist; otherwise a mock-based render assertion).

## Fix #2 — P1-3: Dismiss does not wait for gate write

**Problem**: `src/screens/coach/ed/FirstPaymentWowHost.tsx:61` does `void markFirstPaymentSeen(coachId); setEvent(null);` — UI clears before persistence.

**Fix**: Make the dismiss handler async; `await markFirstPaymentSeen(coachId)` BEFORE `setEvent(null)`. Wrap in try/catch — on failure, log via `console.warn` (NOT swallow) AND still clear UI (so user is not stuck), but record the warning. Pattern:
```ts
const handleDismiss = useCallback(async () => {
  try {
    await markFirstPaymentSeen(coachId);
  } catch (err) {
    console.warn('[FirstPaymentWowHost] markFirstPaymentSeen failed', err);
  }
  setEvent(null);
}, [coachId]);
```

**Test addition**: In `FirstPaymentWowHost.test.tsx`, add a test that dismiss awaits `markFirstPaymentSeen` resolution before `event` is null, AND a test that rejection logs a warning but still clears.

## Fix #3 — P1-4: 3 NEW swallowed catches (Bradley Law #36)

**File 1** — `src/screens/client/progress/ProgressChartCard.tsx:83` (haptic scrubber):
Replace the empty `.catch(() => {})` with a guarded warn:
```ts
.catch((err) => { console.warn('[ProgressChartCard] haptic failed', err); });
```

**File 2** — `src/screens/coach/ed/useFirstPaymentRealtime.ts:167` (hasSeenFirstPayment in event-time check):
Replace `void hasSeenFirstPayment(...).then(...)` pattern with `.then(...).catch((err) => console.warn('[useFirstPaymentRealtime] hasSeenFirstPayment failed', err))`.

**File 3** — `src/screens/coach/ed/useFirstPaymentRealtime.ts:200` (removeAllChannels in cleanup):
Inside the effect cleanup, wrap `client.removeAllChannels()` with `Promise.resolve(client.removeAllChannels()).catch((err) => console.warn('[useFirstPaymentRealtime] removeAllChannels failed', err))` — since cleanup can't be async, capture the promise.

**Test additions**:
- Assert `unsubscribe` and `removeAllChannels` are both called on unmount in `useFirstPaymentRealtime.test.tsx`.
- For the haptic scrubber catch, add a test where haptics rejects and assert warn is called.

## Fix #4 — P2-1: Missing live region on PR commentary

`src/screens/client/progress/ProgressChartCard.tsx:313` — add `accessibilityLiveRegion="polite"` to the PR commentary `<Text>` (only render when PR detected, so the announcement fires on appearance).

**Test addition**: Snapshot or prop assertion that the PR commentary text carries the live-region prop when shown.

## Fix #5 — P2-2: §3.8 slight_smile expression invariant

`src/components/roman/RomanAvatar.tsx` currently only has a `crop` prop. Add an optional `expression?: 'neutral' | 'slight_smile'` prop and a mapping so `expression="slight_smile"` selects the §3.8 spec asset (use the existing smile asset if no distinct slight_smile asset exists, but expose the API name).

Update call sites:
- `src/screens/coach/ed/FirstPaymentWowScreen.tsx:102`
- `src/screens/client/progress/ProgressChartCard.tsx:312`

Both should pass `expression="slight_smile"` (or equivalent) instead of relying on `crop="smile"` alone. Update related test labels from `'Roman, pleased'` to a label matching §3.8 ("Roman, slight smile") if a test asserts the label string.

**Test additions**: Snapshot/prop test for `RomanAvatar` rendering with `expression="slight_smile"`.

## Fix #6 — P2-3: Dismiss button touch target

`src/screens/coach/ed/FirstPaymentWowScreen.tsx:148` — add `minHeight: 44, minWidth: 44` to the button style OR add `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}` if padding is borderline.

## Out-of-scope (per D-049)
- **NO P1-2 fix**: AsyncStorage fallback in `src/storage/mmkv.ts` is spec-compliant. Do NOT add `react-native-mmkv` dependency.

## R0 / Bradley Law #36 / R66 / R70

- **R0 grep** on added lines including comments: NO `console.log` (warn is OK for catches), NO TODO/FIXME, NO @ts-ignore, NO `as any`, NO Math.random, NO Date.now in production code.
- **Bradley Law #36**: After fixes, `grep -nE "\\.catch\\(\\(\\) => (\\{|undefined)" src/screens/client/progress/ProgressChartCard.tsx src/screens/coach/ed/` must return ZERO hits in changed files.
- **R70 fail-fast**: `npx jest --runInBand src/screens/coach/ed/__tests__/ src/screens/client/progress/__tests__/ src/components/roman/__tests__/` — exit 0.
- **R66 full Jest**: `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand --silent` — exit 0.
- **Typecheck**: `npx tsc --noEmit` — exit 0.

## Commit & push
- **Author**: `Dynasia G <dynasia@trygrowthproject.com>`
- **Title only**: `fix(roman): P4 R2 — wire ED.4, gate await, catches, live region, slight_smile, touch target`
- `git push origin feature/roman-p4-ed3-ed4-showpieces`

## Output
Write `/home/user/workspace/ROMAN_P4_R2_FIXER_REPORT.md` ending with:
```
FIX COMPLETE: <new-HEAD-sha>
```

## DO NOT
- Do NOT install `react-native-mmkv` (D-049).
- Do NOT touch pre-existing swallowed catches in other files (out-of-scope).
- Do NOT change §2.6 / §2.8 spec copy strings.
- Do NOT introduce new dependencies.
