# v3-1 mobile #235 R2 UX audit

VERDICT: NOT CLEAN

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: #235  
HEAD audited: `7a4b7aeddecee8f48887ddd92bb3c6262404b114`  
Worktree: `/home/user/workspace/tgp/audit-v3-1-mobile-r2-ux`

## Scope audited

Surfaces reviewed: challenge list, challenge detail, join/log progress, leaderboard opt-in/opt-out, completion state, empty/loading/error states, feature flag posture, quiet-luxury doctrine invariants, a11y, FACE+VOICE, and empty-state copy.

## P0 findings

None found.

## P1 findings

### P1-1 — Challenge list is registered but not reachable, and the registered route cannot fetch data without an injected `workspaceId`

The discovery list route exists, but the Community tab never exposes a Challenges tab/card/list entry: the tab list only includes Today, Hall, Cohorts, and Messages (`src/screens/community/CommunityTabScreen.tsx:46-61`), and the rendered branches only mount Today/Hall/Cohorts/DMs (`src/screens/community/CommunityTabScreen.tsx:79-90`). The only challenge entry on Today opens one specific detail directly (`src/screens/community/CommunityTodayScreen.tsx:154-165`), so users cannot browse the full challenge list from the visible client UI.

Even if the registered route is reached directly, `CommunityChallengesScreen` requires a `workspaceId` prop (`src/screens/community/CommunityChallengesScreen.tsx:39-43`) and disables its query when `workspaceId` is absent (`src/screens/community/CommunityChallengesScreen.tsx:52-56`). The navigator registers the screen without passing that prop (`src/navigation/CommunityNavigator.tsx:42-46`), so the route falls through to `data = challenges.data ?? []` and renders the empty state (`src/screens/community/CommunityChallengesScreen.tsx:131-143`) instead of fetching real challenges.

Coach-side list coverage is also missing from the audited route tree: `CoachCommunityNavigator` registers Home, Inbox, Cohorts, CohortDetail, PostDetail, and Moderation only (`src/navigation/CoachCommunityNavigator.tsx:36-65`).

### P1-2 — Join/leaderboard write flows are not optimistic and rollback messages are not announced

The brief requires join/leave interactions to have optimistic update plus rollback messaging announced via a live region. Join clears errors, waits for server success, and only invalidates detail on success (`src/screens/community/CommunityChallengeDetailScreen.tsx:151-160`); the primary action simply calls `joinMutation.mutate` and opens the sheet on success (`src/screens/community/CommunityChallengeDetailScreen.tsx:241-247`). Leaderboard opt-in/out follows the same non-optimistic pattern (`src/screens/community/CommunityChallengeDetailScreen.tsx:184-197`) and is used by the opt-in/keep-private controls (`src/screens/community/CommunityChallengeDetailScreen.tsx:485-516`) and opt-out control (`src/screens/community/CommunityChallengeDetailScreen.tsx:534-546`).

Rollback/failure copy is shown in a dismissible banner, but the banner has no `accessibilityLiveRegion` and no `AccessibilityInfo.announceForAccessibility` call (`src/screens/community/CommunityChallengeDetailScreen.tsx:608-621`). That means failed writes can be visually surfaced but not reliably announced to assistive tech.

### P1-3 — Required list/listitem semantics are missing on challenge, comments, and leaderboard lists

The challenge list `FlatList` is rendered without `accessibilityRole="list"` (`src/screens/community/CommunityChallengesScreen.tsx:149-162`), and each row is a `ChallengeCard` button rather than a list item or list-item-wrapped control (`src/components/community/ChallengeCard.tsx:67-77`).

The detail comments list also renders a `FlatList` without `accessibilityRole="list"` (`src/screens/community/CommunityChallengeDetailScreen.tsx:624-632`), and comment rows are plain `View`s without `accessibilityRole="listitem"` (`src/screens/community/CommunityChallengeDetailScreen.tsx:360-384`). Leaderboard rows are likewise plain `View`s without list/listitem semantics (`src/screens/community/CommunityChallengeDetailScreen.tsx:388-408`) inside a plain container (`src/screens/community/CommunityChallengeDetailScreen.tsx:532-547`).

### P1-4 — No challenge leave affordance exists

The challenge API client exposes join, progress update, leaderboard opt-in/out, leaderboard fetch, comments, and report endpoints, but no challenge leave method (`src/api/communityChallengesApi.ts:229-310`). The detail primary action only supports `Join this challenge`, `Log progress`, or `Log more progress` (`src/screens/community/CommunityChallengeDetailScreen.tsx:249-254`), and the only “leave” copy on the screen is for leaving an encouragement note (`src/screens/community/CommunityChallengeDetailScreen.tsx:590-596`). The audited join/leave surface is therefore incomplete unless the product decision is explicitly “no challenge leave.”

## P2 findings

### P2-1 — Loading states lack the required busy/progressbar semantics and labels

Challenge list loading shows a centered `ActivityIndicator` and text, but the loading container has no `accessibilityState={{ busy: true }}` and the indicator has no `progressbar` role/label (`src/screens/community/CommunityChallengesScreen.tsx:87-96`). Challenge detail loading repeats the same pattern (`src/screens/community/CommunityChallengeDetailScreen.tsx:274-289`). Leaderboard loading also renders only an `ActivityIndicator` in a generic container (`src/screens/community/CommunityChallengeDetailScreen.tsx:519-522`). The brief explicitly requires loading states to expose a progressbar role plus busy state.

## Quiet-luxury / doctrine checks

- Font weights on the audited added surfaces are `600` or lower; no `700`/`800`/`bold` weights were found in the challenge surfaces.
- D-009 leaderboard allowlist is present and scoped to the leaderboard reference check (`src/__tests__/quietLuxuryDoctrine.test.ts:35-40`), while the heavy-weight allowlist remains empty (`src/__tests__/quietLuxuryDoctrine.test.ts:24`).
- Raw hex/rgba additions are confined to `src/theme/tokens.ts` overlay tokens (`src/theme/tokens.ts:362-384`); audited challenge surfaces use `semanticColors` rather than raw hex.
- No pictograph emoji, “Coming soon,” “We’re working on it,” “Oops,” or “Sorry” copy was found in the audited challenge surfaces.
- FACE+VOICE is acceptable on the v3-1 challenge surfaces reviewed: the comments empty state is explicitly neutral/non-Roman (`src/screens/community/CommunityChallengeDetailScreen.tsx:353-356`, `src/components/community/ChallengeCommentsEmptyState.tsx:55-79`), while existing Roman-voiced community empty states render `RomanAvatar` in the same component tree (`src/components/community/EmptyState.tsx:49-59`).

## Validation notes

- `gh pr view 235` confirmed PR HEAD `7a4b7aeddecee8f48887ddd92bb3c6262404b114`.
- Targeted Jest commands could not run because the checkout does not have a usable local Jest binary (`sh: 1: jest: not found`). No code was modified.
