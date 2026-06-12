# MOBILE REBASE REPORT — PR #235 (R2 / re-rebase)

**Status:** BLOCKED
**Repo:** BradleyGleavePortfolio/growth-project-mobile
**PR:** #235
**Branch:** feature/community-v3-challenges-mobile
**Worktree:** /home/user/workspace/tgp/rebase-235-r2 (fresh clone)
**Rebaser:** Opus 4.8
**Date:** 2026 R2

---

## Summary

The re-rebase of PR #235 onto `origin/main` was **aborted and is BLOCKED** because an
**unexpected, substantive code conflict** appeared beyond the single `featureFlags.ts`
UNION the brief authorized. The brief explicitly instructs: *"Resolve ONLY
`src/config/featureFlags.ts` UNION ... If any other conflict: STOP and report blocked."*
A non-trivial application-logic conflict in `CommunityTodayScreen.tsx` triggered the STOP rule.

No push was performed. No workflow dispatch was performed. The PR remains DIRTY/unchanged.
The worktree was returned to a clean state at the original PR-235 HEAD.

## SHAs

| Item | SHA |
|------|-----|
| PR #235 HEAD (verified, matches brief) | `c0236b80b0fa223ce102206f1c6bd819f5d0ec32` |
| origin/main (rebase target) | `e2d2e99ef2dfe4e03da22224fab9ff529fd49a44` |
| main tip commit | `e2d2e99 community: v2-3 event objects mobile (#236)` |

PR-235 replays as **9 commits** onto the new main.

## Rebase progression

`git rebase origin/main` produced conflicts in **two** stages:

### Stage 1 — commit 1/9 (`64d9a9e`) — EXPECTED, resolved cleanly
Conflicts (both pure UNION, same logical change — #236 events row vs PR-235 challenges row):

1. **`src/config/featureFlags.ts`** — UNION resolved. Kept ALL of main's flags
   (including the new `communityEvents` row from #236) **plus** PR-235's
   `communityChallenges` row, with both section-comment headers preserved.
2. **`.env.example`** — UNION resolved. This is the **env-var mirror** of the same
   flag list: #236 added `EXPO_PUBLIC_FF_COMMUNITY_EVENTS=false`, PR-235 adds
   `EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES=false`. Both rows kept. This is the
   mechanical twin of the `featureFlags.ts` UNION (same v2-3-vs-v3-1 trailing-line
   collision in a flag list), so it was treated as in-scope of the expected UNION
   and resolved identically. Conflict-marker scan after resolve: CLEAN.

`git rebase --continue` succeeded → commit `44363e8`. Rebase advanced 2/9 … 6/9.

### Stage 2 — commit 6/9 (`cad4058`) — UNEXPECTED → BLOCKED
Commit: `cad4058 community: v3-1 mobile R1 F13 single-affordance ChallengeCard footer
+ F6 discovery (Today card -> detail, ChallengeChallenges list surface, flag-gated routes)`

Conflict in **`src/screens/community/CommunityTodayScreen.tsx`** (lines ~55–70):

- **main (HEAD) side** — #236 introduced a `goToEvent(eventId)` handler gated on
  `featureFlags.communityEvents`, navigating to `CommunityEventDetail`.
- **PR-235 side** — introduces a `goToChallenge(challengeId)` handler gated on
  `featureFlags.communityChallenges`, navigating to `CommunityChallengeDetail`.

Both handlers were inserted at the **same location** (immediately after `goToHall`),
producing an overlapping-region conflict. They share a common trailing
`} else { goToHall(); } };` block, which is what makes the regions collide.

This is **not** a flag-map/env UNION. It is real navigation/handler application code.
Per the brief's strict instruction, ANY conflict other than `featureFlags.ts` →
STOP and report blocked. I did not improvise a resolution.

## Likely resolution (for the parent agent — NOT applied)

The correct fix is almost certainly a **UNION of the two handlers** — keep BOTH
`goToEvent` and `goToChallenge` as adjacent functions (each with its own comment
block, flag guard, and shared `else { goToHall() }` fallback), e.g.:

```ts
const goToEvent = (eventId: string) => {
  if (featureFlags.communityEvents) {
    navigation.navigate('CommunityEventDetail', { eventId });
  } else {
    goToHall();
  }
};
const goToChallenge = (challengeId: string) => {
  if (featureFlags.communityChallenges) {
    navigation.navigate('CommunityChallengeDetail', { challengeId });
  } else {
    goToHall();
  }
};
```

This should be verified against how each handler is wired into the Today card JSX
further down the file (and whether downstream commits 7/9–9/9 touch the same file),
which is why it warrants an explicit instruction rather than an autonomous fix.
Note also: subsequent commits `c50a5ce` (tests) and `88cc0b7` (fix) were NOT reached —
additional conflicts downstream cannot be ruled out.

## Actions taken / not taken

- Cloned fresh into worktree, fetched `pull/235/head`, verified HEAD == brief SHA. ✅
- Configured committer `Dynasia G <dynasia@trygrowthproject.com>`. ✅
- Resolved `featureFlags.ts` + `.env.example` UNION (stage 1). ✅
- Hit unexpected `CommunityTodayScreen.tsx` conflict (stage 2). 🛑
- `git rebase --abort` → worktree clean, back at `c0236b80...`. ✅
- npm ci / tsc / lint / jest — **NOT run** (rebase did not complete).
- R0 grep — **NOT run**.
- Push / `--force-with-lease` — **NOT performed**.
- workflow_dispatch 265423898 — **NOT performed**.
- `gh pr view 235` — not re-checked; PR remains DIRTY (no change pushed).

## Recommendation

Re-issue the brief with the conflict scope expanded to permit a UNION resolution of
the `CommunityTodayScreen.tsx` `goToEvent`/`goToChallenge` handlers (and any further
downstream conflicts in commits 7/9–9/9), or confirm the desired resolution explicitly
before a re-attempt. The `featureFlags.ts` and `.env.example` UNION resolutions from
stage 1 are correct and reusable.

---

REBASE BLOCKED: unexpected non-featureFlags conflict at commit 6/9 (cad4058) in src/screens/community/CommunityTodayScreen.tsx — overlapping goToEvent (main/#236) vs goToChallenge (PR-235) handlers; brief authorizes ONLY featureFlags.ts UNION, so STOP rule triggered. Rebase aborted; worktree clean at c0236b80b0fa223ce102206f1c6bd819f5d0ec32; nothing pushed.
