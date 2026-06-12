# FIXER REPORT — Roman P1 #238 UX R3 (a11y + live regions + list semantics + reduced motion)

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR: #238 — source branch `feat/roman-p1-mobile-chat`, base `main`
Worktree: `/home/user/workspace/tgp/fixer-roman-p1-238-ux-r3`
PR head before fix: `55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7` (verified at checkout)
New commit: `00d8a0abee809ebe67b2fb35d54ef788ffc1cfd6`
Author: `Dynasia G <dynasia@trygrowthproject.com>`, title-only commit.
Pushed: force-with-lease to `feat/roman-p1-mobile-chat`; PR #238 head now `00d8a0a`.

## Findings closed (from `ROMAN_P1_238_R3_UX_AUDIT_REPORT.md`)

### P1-1 — Loading states now expose busy/progressbar semantics — CLOSED
- `src/screens/roman/RomanChatScreen.tsx` — `LoadingSkeleton` wrapper now carries
  `accessibilityRole="progressbar"`, `accessibilityLabel={ROMAN_LOADING_A11Y_LABEL}`,
  and `accessibilityState={{ busy: true }}`. The skeleton blocks remain hidden from
  assistive tech (unchanged), but the loading STATE is now announced on the container.
- The `loadingOlder` footer (`roman-loading-older`) now carries
  `accessibilityRole="progressbar"`, `accessibilityLabel={ROMAN_LOADING_OLDER}`,
  `accessibilityLiveRegion="polite"`, and `accessibilityState={{ busy: true }}`, while
  preserving the visible RomanAvatar attribution (FACE+VOICE).
- `src/components/roman/romanVoice.ts` — added `ROMAN_LOADING_A11Y_LABEL =
  'Roman is getting ready'` (Roman §2.9 readback register, cited inline), so the
  busy label is Roman-voiced rather than a generic "Loading…".

### P1-2 — Error/rollback announcements are now live regions + announced — CLOSED
- `src/screens/roman/RomanChatScreen.tsx` — the inline send-error row
  (`roman-send-error`) now carries `accessibilityRole="alert"` and
  `accessibilityLiveRegion="assertive"`. A deduped effect calls
  `AccessibilityInfo.announceForAccessibility(sendErrorCopy)` the moment a send
  failure (whose optimistic user turn was rolled back in `useRomanChat`) appears,
  guarded by a `lastAnnouncedError` ref so a re-render never repeats it.
- `src/components/roman/RomanState.tsx` — full-screen `error`/`offline`/`unavailable`
  states now carry `accessibilityRole="alert"`. Live-region severity is
  `assertive` for recoverable failures (`offline`/`error`) and `polite` for the calm,
  non-actionable `unavailable` state. An effect announces the title (+ body) via
  `AccessibilityInfo.announceForAccessibility`.
- `useRomanChat.ts` rollback logic was NOT changed — the rollback already lived
  there (F5/FIFTY_FAILURES #30 preserved); only the SURFACE announcement was added.

### P1-3 — list/listitem semantics added across Roman surfaces — CLOSED
- `src/screens/roman/RomanChatScreen.tsx` — the chat `FlatList` now carries
  `role="list"`.
- `src/components/roman/RomanMessageBubble.tsx` — assistant and user rows now carry
  `role="listitem"` (the existing per-row `accessibilityLabel` "Roman said:" / "You
  said:" is preserved).
- `src/screens/client/MoreScreen.tsx` — the `ScrollView` is `role="list"`; each row is
  wrapped in a `role="listitem"` `View` whose inner `HapticPressable` keeps its
  `accessibilityRole="button"` + action. Roman entry row preserved.
- `src/screens/coach/SettingsScreen.tsx` — the Concierge section `View` is `role="list"`
  with the Roman row wrapped in a `role="listitem"` container; inner `TouchableOpacity`
  keeps its button role + action. Roman entry row preserved.

**Type note:** React Native's `AccessibilityRole` union types `'list'` but omits
`'listitem'`. The properly-typed ARIA `role` prop (RN `Role` union) types BOTH, so all
list/listitem semantics use the `role` prop. This is type-safe (`tsc` exit 0) and the
runtime maps it to native list semantics on iOS/Android.

### P2-1 — Reduced motion now respected by chat scroll + skeleton pulse — CLOSED
- `src/screens/roman/RomanChatScreen.tsx` — caches the OS reduce-motion preference via
  `AccessibilityInfo.isReduceMotionEnabled()` + a `reduceMotionChanged` subscription
  (cleaned up on unmount), and passes `scrollToEnd({ animated: !reduceMotion })`. Probe
  failure is logged via `logger.warn('RomanChatScreen.reduceMotionQuery', err)` — no
  swallowed catch.
- `src/ui/skeletons/Skeleton.tsx` — the shared primitive now reads the same preference;
  under Reduce Motion it holds a steady `opacity = 0.7` instead of the infinite
  `withRepeat` ping-pong. The default (motion-on) `withRepeat` pulse path is unchanged.
  Probe failure logged via `logger.warn('Skeleton.reduceMotionQuery', err)`. This
  extends the pattern the typing indicator already established, app-wide.

## Constraints honoured
- **Bradley Law #36 (zero swallowed catches):** both new `.catch()` blocks call
  `logger.warn(...)` with structured context. No empty catches added.
- **D-012 FACE+VOICE:** every Roman copy render-site still has RomanAvatar in the same
  tree; the only RomanAvatar diff lines are indentation from the new listitem wrappers.
- **D-013 RomanAvatar canonical:** `src/components/roman/RomanAvatar.tsx` NOT modified;
  all imports remain from the canonical path.
- **No `forceExit`, no `--detectOpenHandles` masks** used anywhere.
- **R0 grep on added lines:** no TODO/FIXME, no `console.log`, no `: any`/`as any`, no
  pictograph/emoji.

## Verification
1. Fail-fast lane (R70, <30s): 5 Roman/skeleton suites — 157 tests pass in 6.7s.
2. Full `npx jest --runInBand` (R66): **213 suites, 2474 tests, 5 snapshots — all pass, exit 0** (103s).
   - The "Jest did not exit one second after…" notice is a pre-existing informational
     message (exit code 0); no `forceExit`/`--detectOpenHandles` mask was applied.
3. `npx tsc --noEmit`: **0 errors**.
4. ESLint on all changed files: **exit 0**.
5. R0 grep on diff: clean.

## Tests added
- `src/screens/roman/__tests__/romanA11yR3.test.tsx` (15 tests): render tests for
  RomanState (alert + live region + announce per kind) and RomanMessageBubble
  (`role="listitem"`), plus source-contract guards for the RomanChatScreen loading
  progressbars, send-error live region + announce, list semantics on chat/More/Settings,
  and reduced-motion gating of scroll + skeleton — mirroring the repo's existing
  `skeleton.test.tsx` contract-guard style.

## Files changed
- `src/screens/roman/RomanChatScreen.tsx`
- `src/components/roman/RomanMessageBubble.tsx`
- `src/components/roman/RomanState.tsx`
- `src/components/roman/romanVoice.ts`
- `src/ui/skeletons/Skeleton.tsx`
- `src/screens/client/MoreScreen.tsx`
- `src/screens/coach/SettingsScreen.tsx`
- `src/screens/roman/__tests__/romanA11yR3.test.tsx` (new)

FIX COMPLETE: 00d8a0abee809ebe67b2fb35d54ef788ffc1cfd6
