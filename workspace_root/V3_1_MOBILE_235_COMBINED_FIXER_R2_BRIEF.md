# FIXER BRIEF — v3-1 mobile #235 combined R2 (code + UX)

FIXER (Opus 4.8 ONLY). Surgical. NO browser_task, NO github_mcp_direct.

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR: #235 (v3-1 mobile community challenges)
HEAD: `7a4b7aeddecee8f48887ddd92bb3c6262404b114`
Worktree: `/home/user/workspace/tgp/fixer-v3-1-mobile-235-combined-r2`
`api_credentials=["github"]` for git/gh.

Setup:
```bash
mkdir -p /home/user/workspace/tgp/fixer-v3-1-mobile-235-combined-r2
cd /home/user/workspace/tgp/fixer-v3-1-mobile-235-combined-r2
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/235/head:pr-235
git checkout pr-235
git log -1 --format=%H   # MUST equal 7a4b7aeddecee8f48887ddd92bb3c6262404b114
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```

READ FIRST:
- `/home/user/workspace/V3_1_MOBILE_235_R2_CODE_AUDIT_REPORT.md` (3 P1 + 1 P2 code)
- `/home/user/workspace/V3_1_MOBILE_235_R2_UX_AUDIT_REPORT.md` (4 P1 + 1 P2 UX)

CODE findings to close:
- **P1-code-1** `CommunityChallengesScreen` registered but unreachable AND can't fetch without `workspaceId`. Fix: resolve `workspaceId` internally via same `useCommunityMe` source CommunityTabScreen uses, OR thread it through route params. Add a tab/card entry to CommunityTabScreen (Today/Hall/Cohorts/Messages + **Challenges**). Add integration test verifying `listChallenges('ws-id')` fires.
- **P1-code-2** Bradley Law #36: `Haptics.notificationAsync(...).catch(() => { /*...*/ })` at `ChallengeProgressSheet.tsx:161-165`. Replace silent catch with explicit unsupported-platform check + structured non-PII log on unexpected failures.
- **P1-code-3** Unpaginated challenges/comments/leaderboard. Add `limit`/`cursor` to `communityChallengesApi.listChallenges`, `getLeaderboard`, `listComments`. Keep current calls valid with sensible defaults (e.g. `limit=20`). Include pagination in React Query keys. Virtualize/page leaderboard rows in detail screen (replace `.map` with `FlatList`).
- **P2-code-1** No challenge leave/withdraw path. Decision: this is a v3-1 surface scope item — add `leaveChallenge` API method + UI affordance for joined challenges (small secondary button in detail). If product wants explicit "no leave," LOG operator decision instead — but default is ADD.

UX findings to close (overlap with code findings; close in same change):
- **P1-ux-1** Discovery list unreachable (same as P1-code-1)
- **P1-ux-2** Join/leaderboard writes non-optimistic + no live-region announcement of rollback. Make join/leaveLeaderboard/optInLeaderboard optimistic (React Query `onMutate`/`onError` rollback). Add `accessibilityLiveRegion="polite"` + `AccessibilityInfo.announceForAccessibility` to rollback banner.
- **P1-ux-3** Missing list/listitem semantics on challenge list, comments list, leaderboard. Add `accessibilityRole="list"` to each container and `accessibilityRole="listitem"` to row components (ChallengeCard root, comment row View, leaderboard row View).
- **P1-ux-4** No leave affordance (same as P2-code-1)
- **P2-ux-1** Loading states lack busy/progressbar semantics + labels. Add `accessibilityState={{ busy: true }}` to ActivityIndicator containers; set `accessibilityRole="progressbar"` + `accessibilityLabel="Loading challenges"` (etc.) on the indicator.

Constraints:
- R0 hectacorn floor + 50 AI Coding Failures all 8 categories
- Bradley Law #36 — ZERO swallowed catches (including in any new tests)
- R69 zero Prisma schema diff (mobile PR — shouldn't touch any anyway)
- D-009 leaderboard reference fontWeight allowlist preserved
- Quiet-luxury: no font weights >600 on touched surfaces
- Tokens: no raw hex/rgba in components (use semanticColors)
- FACE+VOICE: any new Roman copy → RomanAvatar in same tree (challenges screens are NEUTRAL by audit — keep neutral)
- NO `forceExit`, NO `--detectOpenHandles` masks
- R66 full Jest before push; R70 fail-fast lane <30s

Verification before push:
1. `npx tsc --noEmit` exit 0
2. ESLint on changed files exit 0
3. Targeted Jest: `useCommunityChallenges*`, `CommunityChallenges*`, `ChallengeCard*`, `ChallengeProgressSheet*`, navigation flag-off tests — exit 0
4. Full `npx jest --runInBand` — exit 0
5. R0 grep on diff (no TODO/FIXME/console.log/any-cast/pictograph/banned copy)

Commit: `fix(community): #235 v3-1 challenges combined R2 — list semantics, optimistic writes, pagination, reachable route, leave affordance, Bradley`
Push force-with-lease to PR-235 source branch.

Output report: `/home/user/workspace/V3_1_MOBILE_235_COMBINED_FIXER_R2_REPORT.md`
End with `FIX COMPLETE: <sha>` or `FIX BLOCKED: <reason>`.

Sonnet 4.6 FORBIDDEN.
