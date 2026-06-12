# v3-1 mobile #235 R3 final UX audit

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: #235  
HEAD audited: `6d4bed83ce712789b25242e8e4997269b26bc33f`  
Worktree: `/home/user/workspace/tgp/audit-v3-1-mobile-235-r3-ux`

## Verdict

NOT CLEAN — one R2 P1 UX finding remains open.

## Scope audited

- Re-verified the 4 R2 P1 UX findings and 1 R2 P2 UX finding called out in the R3 brief.
- Re-checked the R0 UX dimensions requested for the challenge surfaces: quiet-luxury, FACE+VOICE neutrality, a11y, token usage, reduced motion, and banned-copy/pictograph posture.
- Validation mode: static source audit. I did not modify repo files. Targeted Jest/TS validation was not runnable in this checkout because `node_modules` is a broken symlink and local `jest`/`tsc` binaries are absent.

## R2 finding re-verification

| R2 item | R3 status | Evidence |
|---|---:|---|
| P1 unreachable challenge list / empty route | CLOSED | `CommunityTabScreen` now adds a flag-gated `Challenges` tab and renders `CommunityChallengesScreen` with the resolved `workspaceId` (`src/screens/community/CommunityTabScreen.tsx:59-65`, `:98-103`). `CommunityChallengesScreen` also self-resolves `workspaceId` from `useCommunityMe` when no prop is supplied, so direct route/deep-link entry is no longer functionally empty for want of injected props (`src/screens/community/CommunityChallengesScreen.tsx:61-86`). Regression coverage pins self-resolution and bounded fetches (`src/screens/community/__tests__/CommunityChallengesScreen.test.tsx:90-127`). |
| P1 non-optimistic join / leaderboard writes and no live-region rollback | CLOSED | Join now uses `onMutate` to write provisional participation, `onError` to restore the previous detail cache, and `onSettled` to reconcile (`src/screens/community/CommunityChallengeDetailScreen.tsx:197-238`). Leaderboard opt-in/out now follows the same optimistic/snapshot rollback pattern (`src/screens/community/CommunityChallengeDetailScreen.tsx:261-296`). Rollback/failure copy is announced with `AccessibilityInfo.announceForAccessibility` and the banner also has `accessibilityLiveRegion="polite"` (`src/screens/community/CommunityChallengeDetailScreen.tsx:152-162`, `:746-764`). Regression coverage pins rollback paths (`src/screens/community/__tests__/CommunityChallengeDetailScreen.test.tsx:297-363`). |
| P1 list/listitem semantics | **OPEN** | List containers now have `accessibilityRole="list"`, but row wrappers still do not expose `listitem` semantics: challenge rows are plain `View`s (`src/screens/community/CommunityChallengesScreen.tsx:187-200`), comment rows are plain `View`s (`src/screens/community/CommunityChallengeDetailScreen.tsx:467-475`), and leaderboard rows are plain `View`s (`src/screens/community/CommunityChallengeDetailScreen.tsx:499-510`) inside a `FlatList` with only container `accessibilityRole="list"` (`src/screens/community/CommunityChallengeDetailScreen.tsx:663-670`, `:767-770`). The in-code rationale says React Native lacks typed `accessibilityRole="listitem"`, but this repo already uses the typed W3C `role="listitem"` pattern on community event rows (`src/components/community/EventCard.tsx:115-119`), and React Native 0.85.3 includes `listitem` in the W3C `Role` union even though it is not in `AccessibilityRole` ([React Native v0.85.3 `ViewAccessibility.d.ts`](https://github.com/facebook/react-native/blob/v0.85.3/packages/react-native/Libraries/Components/View/ViewAccessibility.d.ts#L354-L380)). |
| P1 no leave affordance | CLOSED BY PRODUCT DECISION | The R3 brief explicitly records D-030 as no-leave and defines leaderboard opt-out as the reversible withdrawal. The API client keeps no fabricated challenge leave method and documents the backend-contract rationale (`src/api/communityChallengesApi.ts:347-367`). The detail screen preserves both the private default and the reversible opt-out affordance (`src/screens/community/CommunityChallengeDetailScreen.tsx:588-631`, `:672-684`). |
| P2 loading busy/progressbar semantics | CLOSED | Challenge list loading has `accessibilityState={{ busy: true }}` and an `ActivityIndicator` with `accessibilityRole="progressbar"` plus label (`src/screens/community/CommunityChallengesScreen.tsx:117-134`). Detail loading and leaderboard loading use the same busy/progressbar pattern (`src/screens/community/CommunityChallengeDetailScreen.tsx:372-394`, `:633-644`). |

## Remaining finding

### P1-R3-1 — Challenge collections still lack row-level `listitem` semantics

R2 asked for list/listitem semantics across challenge, comment, and leaderboard collections. R3 only adds the parent `list` role; the rows remain unrole'd wrappers. This leaves assistive technology without explicit row/item semantics for:

- challenge discovery rows (`src/screens/community/CommunityChallengesScreen.tsx:187-200`),
- encouragement comment rows (`src/screens/community/CommunityChallengeDetailScreen.tsx:467-475`), and
- leaderboard rows (`src/screens/community/CommunityChallengeDetailScreen.tsx:499-510`, `:663-670`).

This is fixable without unsafe casts: keep the inner `ChallengeCard` / report buttons as buttons, and put `role="listitem"` on the row wrapper, matching the existing project pattern in `EventCard` (`src/components/community/EventCard.tsx:115-119`). If desired, the containers can likewise use the W3C `role="list"` prop, but the critical missing piece is row-level `role="listitem"`.

## R0 UX dimension checks

| Dimension | Status | Notes |
|---|---:|---|
| Quiet-luxury | PASS | Audited challenge surfaces use calm progress/competence framing, no trophy/flame/confetti chrome in runtime code, and font weights are capped at `600` or below in the changed challenge surfaces. |
| FACE+VOICE | PASS | Challenge comments true-empty state is neutral and non-Roman; no `RomanAvatar`, `romanCopy`, or local `romanVoice` runtime usage is present in challenge surfaces (`src/components/community/ChallengeCommentsEmptyState.tsx:1-80`, `src/screens/community/CommunityChallengeDetailScreen.tsx:459-463`, `:727-734`). |
| A11y | **FAIL due to P1-R3-1** | Loading/progress/live-region/touch-target improvements are present, but row-level listitem semantics remain missing. |
| Tokens | PASS | Challenge UI uses `semanticColors`, `spacing`, `radius`, and `motion`; raw color scan of changed challenge runtime files found no runtime raw hex/rgba outside token definitions. |
| Reduced motion | PASS | `ChallengeProgressSheet` reads `AccessibilityInfo.isReduceMotionEnabled`, listens for `reduceMotionChanged`, skips timing animations when enabled, and uses fade modal animation under reduced motion (`src/components/community/ChallengeProgressSheet.tsx:100-145`, `:151-185`, `:220-224`). Regression tests pin both reduced-motion branches (`src/components/community/__tests__/ChallengeProgressSheet.reducedMotion.test.tsx:81-137`). |
| Banned copy / pictograph | PASS | Targeted scans of changed challenge surfaces found no banned “Coming soon” / “We’re working on it” / “Oops” / “Sorry” copy and no pictograph emoji. |

## Required fix before clean verdict

Add row-level `role="listitem"` semantics to the challenge discovery row wrapper, comment row wrapper, and leaderboard row wrapper. Keep the existing parent list semantics and inner button roles.

VERDICT: NOT CLEAN
