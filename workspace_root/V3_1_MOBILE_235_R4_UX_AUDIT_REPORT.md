# PR #235 R4 UX Audit — feature/community-v3-challenges-mobile

VERDICT: NOT CLEAN

Scope: BradleyGleavePortfolio/growth-project-mobile at HEAD `918fa47e3968ccb5ef18ec2312fb42c21b8a05f3` in `/home/user/workspace/tgp/audit-v3-1-mobile-235-r4-ux`.

## R4 fix verification

- CLEAN: `CommunityChallengesScreen.tsx` wraps each challenge row in a lowercase W3C `role="listitem"` `View` and keeps the inner `ChallengeCard` as the button target (`src/screens/community/CommunityChallengesScreen.tsx:187-204`, `src/components/community/ChallengeCard.tsx:67-72`).
- CLEAN: `CommunityChallengeDetailScreen.tsx` wraps each comment row in lowercase W3C `role="listitem"` and keeps the report control as `accessibilityRole="button"` (`src/screens/community/CommunityChallengeDetailScreen.tsx:464-497`).
- CLEAN: `CommunityChallengeDetailScreen.tsx` wraps leaderboard rows in lowercase W3C `role="listitem"` (`src/screens/community/CommunityChallengeDetailScreen.tsx:501-527`).
- CLEAN: Parent containers expose list semantics via `accessibilityRole="list"` on the challenge, leaderboard, and comments `FlatList`s (`src/screens/community/CommunityChallengesScreen.tsx:187-190`, `src/screens/community/CommunityChallengeDetailScreen.tsx:668-676`, `src/screens/community/CommunityChallengeDetailScreen.tsx:772-781`).
- CLEAN: The implementation follows the `EventCard` precedent: lowercase W3C `role="listitem"` on the outer wrapper, button semantics on the inner press target (`src/components/community/EventCard.tsx:115-124`).

## P0/P1/P2 findings

### P2 — Dark-mode accent text fails WCAG AA for body-sized labels

Evidence:
- `semanticColors.accent` in dark mode is `#B43C3C`; measured contrast is only `3.02:1` against `bgSurface #1C1A18` and `3.28:1` against `bgPrimary #121110`, below WCAG AA's `4.5:1` threshold for body-sized text.
- Body-sized accent labels are used in multiple challenge surfaces, including `ChallengeCard`'s 13px action label (`src/components/community/ChallengeCard.tsx:131-132`, `src/components/community/ChallengeCard.tsx:179`), the detail opt-in label (`src/screens/community/CommunityChallengeDetailScreen.tsx:632-633`, `src/screens/community/CommunityChallengeDetailScreen.tsx:882`), retry labels (`src/screens/community/CommunityChallengesScreen.tsx:160-161`, `src/screens/community/CommunityChallengeDetailScreen.tsx:428-429`), and the progress-sheet completion hint (`src/components/community/ChallengeProgressSheet.tsx:294-295`, `src/components/community/ChallengeProgressSheet.tsx:474`).

Remediation hint: split the token role into `accentFill` and `accentText` for dark mode, or use a higher-contrast text token for outline/link/chip labels while preserving `textOnAccent` for filled CTAs. Add a contrast regression test for `accent` as text on `bgPrimary` and `bgSurface` at body sizes.

### P2 — Async lists are semantic but not live-announced/named

Evidence:
- The challenge, comments, and leaderboard lists have `accessibilityRole="list"`, but no `accessibilityLabel`, `accessibilityLiveRegion`, or count/change announcement after async load (`src/screens/community/CommunityChallengesScreen.tsx:187-208`, `src/screens/community/CommunityChallengeDetailScreen.tsx:668-676`, `src/screens/community/CommunityChallengeDetailScreen.tsx:772-781`).
- Existing live-region coverage is for action-error/progress text, not for list data arrival (`src/screens/community/CommunityChallengeDetailScreen.tsx:152-162`, `src/screens/community/CommunityChallengeDetailScreen.tsx:751-762`, `src/components/community/ChallengeProgressSheet.tsx:278-281`).

Remediation hint: add named list labels such as `Challenges, {n} items`, `Encouragement notes, {n} items`, and `Leaderboard, {n} rows`; add `accessibilityLiveRegion="polite"` or `AccessibilityInfo.announceForAccessibility(...)` on successful list/count transitions, with tests that assert the list announcement path.

### P2 — Press feedback animations ignore OS Reduce Motion

Evidence:
- `HapticPressable` unconditionally runs press-in/press-out `Animated.spring` and `Animated.timing` unless callers manually pass `disableAnimation` (`src/components/HapticPressable.tsx:91-122`).
- The challenge surfaces use `HapticPressable` extensively without wiring `disableAnimation` from the OS reduce-motion setting (`src/components/community/ChallengeCard.tsx:67-77`, `src/screens/community/CommunityChallengeDetailScreen.tsx:568-580`, `src/screens/community/CommunityChallengeDetailScreen.tsx:604-635`, `src/screens/community/CommunityChallengeDetailScreen.tsx:677-689`).
- `ChallengeProgressSheet` correctly respects reduce motion for the progress fill and modal animation, but that does not cover the shared press-feedback animation (`src/components/community/ChallengeProgressSheet.tsx:100-145`, `src/components/community/ChallengeProgressSheet.tsx:220-224`).

Remediation hint: centralize reduce-motion handling inside `HapticPressable` by reading/subscribing to `AccessibilityInfo.isReduceMotionEnabled()` / `reduceMotionChanged` and suppressing scale/opacity animation when enabled; keep haptics as-is unless the product spec also disables haptics. Add a reduced-motion regression test for `HapticPressable`.

## Other checklist evidence

- Touch targets meet the 44pt floor for interactive controls inspected: challenge cards are `minHeight: 48`, retry/CTA/opt-in/report/opt-out controls are at least `48`, composer input/send are `44`, and progress-sheet controls are `48` (`src/components/community/ChallengeCard.tsx:141-147`, `src/screens/community/CommunityChallengeDetailScreen.tsx:816-895`, `src/components/community/ComposerInput.tsx:127-143`, `src/components/community/ChallengeProgressSheet.tsx:453-496`).
- Loading states are present for challenge list, challenge detail, leaderboard, and progress submission (`src/screens/community/CommunityChallengesScreen.tsx:117-136`, `src/screens/community/CommunityChallengeDetailScreen.tsx:372-397`, `src/screens/community/CommunityChallengeDetailScreen.tsx:638-649`, `src/components/community/ChallengeProgressSheet.tsx:387-418`).
- Empty states are present and distinguish true empty from load error for challenge list, comments, and leaderboard (`src/screens/community/CommunityChallengesScreen.tsx:171-180`, `src/screens/community/CommunityChallengeDetailScreen.tsx:450-462`, `src/screens/community/CommunityChallengeDetailScreen.tsx:654-657`, `src/screens/community/CommunityChallengeDetailScreen.tsx:709-741`).
- Error states are generic-neutral and recoverable; comments load error does not masquerade as empty (`src/screens/community/CommunityChallengesScreen.tsx:139-166`, `src/screens/community/CommunityChallengeDetailScreen.tsx:67-85`, `src/screens/community/CommunityChallengeDetailScreen.tsx:399-434`, `src/screens/community/CommunityChallengeDetailScreen.tsx:709-731`).
- Roman-tone empty copy is not locally emitted for challenge comments; the comments empty state is neutral UI copy (`src/screens/community/CommunityChallengeDetailScreen.tsx:164-174`, `src/screens/community/CommunityChallengeDetailScreen.tsx:459-462`, `src/components/community/ChallengeCommentsEmptyState.tsx:5-24`).
- Haptic feedback is consistently routed through `HapticPressable`, and the completion peak uses a success haptic with structured logging for unexpected native failure (`src/components/HapticPressable.tsx:47-72`, `src/components/community/ChallengeProgressSheet.tsx:163-184`).
- Validation commands passed: `npm run typecheck`; targeted Jest passed 4 suites / 38 tests for the challenge screens, EventCard precedent, and reduced-motion progress sheet. Jest emitted existing async `act(...)` warnings and an open-handle notice, but no suite failed.

Final line: verdict.

VERDICT: NOT CLEAN
