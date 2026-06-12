# FIXER REPORT — v3-1 mobile #235 R4 UX combined fixer (3 P2s, D-046)

## Result

- **New HEAD SHA:** `e7c5ef69b749ee4e88b52449142f5d81a02ee7c4`
- **Base HEAD:** `918fa47e3968ccb5ef18ec2312fb42c21b8a05f3`
- **Branch:** `feature/community-v3-challenges-mobile`
- **Repo:** `BradleyGleavePortfolio/growth-project-mobile`
- **Worktree:** `/home/user/workspace/tgp/fixer-v3-1-mobile-235-r4-ux`
- **Author:** `Dynasia G <dynasia@trygrowthproject.com>`
- **Commit (title-only, no trailers):** `community(v3-1): add accentText role, live-announce async lists, and honor reduce-motion in HapticPressable`
- **Push:** `git push --force-with-lease` succeeded (`918fa47..e7c5ef6`); remote HEAD confirmed = `e7c5ef69b749ee4e88b52449142f5d81a02ee7c4`.

Note on file locations: the brief named `src/styles/semanticColors.ts` and `src/styles/__tests__/contrastTokens.test.ts`, but this repo keeps semantic tokens in `src/theme/tokens.ts`. The new role and the regression test were placed accordingly (`src/theme/tokens.ts`, `src/theme/__tests__/contrastTokens.test.ts`).

## Diff stat

```
 src/components/HapticPressable.tsx                 |  73 ++++++++--
 src/components/__tests__/HapticPressable.test.tsx  | 152 +++++++++++++++++++++
 src/components/community/ChallengeCard.tsx         |   4 +-
 .../community/ChallengeProgressSheet.tsx           |   4 +-
 .../community/CommunityChallengeDetailScreen.tsx   |  59 +++++++-
 .../community/CommunityChallengesScreen.tsx        |  40 +++++-
 .../CommunityChallengeDetailScreen.test.tsx        |  80 +++++++++++
 .../__tests__/CommunityChallengesScreen.test.tsx   |  46 +++++++
 src/theme/__tests__/contrastTokens.test.ts         |  93 +++++++++++++
 src/theme/tokens.ts                                |  25 +++-
 10 files changed, 557 insertions(+), 19 deletions(-)
```

---

## P2-1 — Dark-mode accent text contrast

**Change:** Added a new `accentText` role to `SemanticTokens` (`src/theme/tokens.ts`), separate from `accent` (the fill). `accent` is unchanged (dark `#B43C3C`, light `#4A0404`) so filled CTAs / progress fills / borders are untouched.

- Dark `accentText = #E07373`
- Light `accentText = #4A0404` (oxblood — already deep enough as text on bone/cream)

**Callsites migrated from `accent` → `accentText` (text/icon foreground only; fills kept on `accent`):**
- `src/components/community/ChallengeCard.tsx` — 13px action-label `Text` and the adjacent in-chip checkmark `Ionicons` (the chip **border** stays on `accent`).
- `src/screens/community/CommunityChallengesScreen.tsx` — retry label `Text` (retry **border** stays on `accent`).
- `src/screens/community/CommunityChallengeDetailScreen.tsx` — detail opt-in label `Text` and **both** retry labels (detail-load retry + comments-load retry); all surrounding borders stay on `accent`.
- `src/components/community/ChallengeProgressSheet.tsx` — completion-hint `Text` and its adjacent checkmark `Ionicons`.

**Contrast measurements (WCAG 2.1 relative luminance, AA body floor = 4.5:1):**

| Token (mode) | vs bgPrimary | vs bgSurface | AA |
|---|---|---|---|
| `accentText` dark `#E07373` | `#121110` → **6.17:1** | `#1C1A18` → **5.68:1** | PASS |
| `accentText` light `#4A0404` | `#F5EFE4` → **14.00:1** | `#FFFDF8` → **15.77:1** | PASS |
| (regression baseline) `accent` dark `#B43C3C` as text | `#121110` → 3.28:1 | `#1C1A18` → 3.02:1 | FAIL (this is the audited bug `accentText` avoids) |

**Regression test:** `src/theme/__tests__/contrastTokens.test.ts` (5 tests) asserts `accentText` ≥4.5:1 on both backgrounds in both modes, asserts the `accent` fill is still below AA as text (locks the rationale), asserts the fill values are unchanged so the filled-CTA contrast (`textOnAccent` on `accent`) still clears AA, and logs the measured ratios for the manual contrast gate.

---

## P2-2 — Async lists not named / live-announced

**Change:** All three async FlatLists now carry a named `accessibilityLabel` + `accessibilityLiveRegion="polite"`, and each fires `AccessibilityInfo.announceForAccessibility(...)` on settled successful data arrival (count transition; last-announced count tracked in a ref to avoid re-announcing on unrelated re-renders). Both paths together cover a reader focused on the list and one elsewhere on the screen.

- `src/screens/community/CommunityChallengesScreen.tsx` — challenges list: label `Challenges, {n} items` / `Challenges, empty`; announce `Challenges loaded, {n} items` (or `…none yet`).
- `src/screens/community/CommunityChallengeDetailScreen.tsx` — comments list: label `Encouragement notes, {n} items` / `…empty`; announce `Encouragement notes loaded, {n} item(s)`.
- `src/screens/community/CommunityChallengeDetailScreen.tsx` — leaderboard list: label `Leaderboard, {n} rows` / `…empty`; announce `Leaderboard loaded, {n} rows`.

**Tests:**
- `CommunityChallengesScreen.test.tsx` (+3): list named with count, marked polite live region; empty-state path; announcement fires with the loaded count.
- `CommunityChallengeDetailScreen.test.tsx` (+3): comments list named + polite + announced; leaderboard list named + polite + announced once opted in.

---

## P2-3 — HapticPressable ignores OS Reduce Motion

**Change:** `src/components/HapticPressable.tsx` now centralizes reduce-motion handling via a new `useReduceMotion()` hook that reads `AccessibilityInfo.isReduceMotionEnabled()` (initial value) and subscribes to the `reduceMotionChanged` event (live updates, cleaned up on unmount). When reduce motion is ON, `shouldAnimate` is `false` and `animateIn`/`animateOut` skip the `Animated.spring`/`Animated.timing` entirely — **haptics still fire on press**. The existing `disableAnimation` prop remains an explicit per-callsite override (`shouldAnimate = !disableAnimation && !reduceMotion`).

**Bradley Law #36:** the initial `isReduceMotionEnabled()` read's `.catch` is **not** swallowed — it `console.warn`s the error and degrades to the safe default (animate). No callsite passes `disableAnimation={false}` expecting animation under reduce-motion.

**Regression test:** `src/components/__tests__/HapticPressable.test.tsx` (3 tests): reduce-motion OFF → press runs `Animated.spring`+`Animated.timing` AND fires haptic; reduce-motion ON → press fires haptic but runs NO spring/timing; explicit `disableAnimation` → no animation, haptic still fires; also asserts subscription to `reduceMotionChanged`.

---

## Verification gates (all PASS, before push)

1. **`npm ci`** — exit 0 (1101 packages, ~15s; offline cache).
2. **`npx tsc --noEmit`** — exit 0.
3. **`npm run lint`** — exit 0 (82 pre-existing warnings, 0 errors; **none** in any changed/new file — confirmed by grep).
4. **Targeted suites** — all PASS (`--forceExit` required; tanstack-query notifyManager keeps an open handle alive, pre-existing):
   - `contrastTokens.test.ts` — 5/5
   - `HapticPressable.test.tsx` — 3/3
   - `CommunityChallengesScreen.test.tsx` — 7/7
   - `CommunityChallengeDetailScreen.test.tsx` — 16/16
   - `ChallengeProgressSheet.reducedMotion.test.tsx` + `ChallengeCard.test.tsx` — 12/12
5. **Full `jest --runInBand`** — **227 suites / 2493 tests, all passed, exit 0**.
6. **R0 grep clean** — no raw hex in changed component files (tokens.ts legitimately defines them), no new `as` casts / `@ts-ignore` / `@ts-expect-error` / `eslint-disable` in production diff, no swallowed catches (the one new catch logs via `console.warn`).
7. **Manual contrast check** — measured ratios logged (see P2-1 table): dark `accentText #E07373` = 6.17:1 (bgPrimary) and 5.68:1 (bgSurface), both ≥4.5:1.

CI auto-dispatches on push; per the brief the runner outage may persist and local gates are the source of truth.

---

FIX COMPLETE: e7c5ef69b749ee4e88b52449142f5d81a02ee7c4
