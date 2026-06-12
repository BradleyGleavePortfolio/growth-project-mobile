# FIXER BRIEF — Roman P1 #238 reduce-motion P2

FIXER (Opus 4.8). Surgical. NO browser_task. NO github_mcp_direct. `api_credentials=["github"]`.

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR #238 HEAD: `00d8a0abee809ebe67b2fb35d54ef788ffc1cfd6`
Worktree: `/home/user/workspace/tgp/fixer-roman-p1-238-reduce-motion`

Setup:
```bash
mkdir -p /home/user/workspace/tgp/fixer-roman-p1-238-reduce-motion
cd /home/user/workspace/tgp/fixer-roman-p1-238-reduce-motion
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/238/head:pr-238
git checkout pr-238
git log -1 --format=%H   # MUST equal 00d8a0abee809ebe67b2fb35d54ef788ffc1cfd6
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```

## P2 — Client Roman entry row reduce-motion gate
READ: `/home/user/workspace/ROMAN_P1_238_R4_UX_AUDIT_REPORT.md`

Bug: `src/screens/client/MoreScreen.tsx:169-201` Roman row uses `HapticPressable` with default `disableAnimation=false`. Reduce-motion users still get scale/opacity animation.

Preferred fix: Make `HapticPressable` (`src/components/HapticPressable.tsx:41-42, 83-86, 91-123`) respect `AccessibilityInfo.isReduceMotionEnabled()` GLOBALLY — internal hook into the existing `useReducedMotion()` hook, gate the press scale/opacity animation. This fixes ALL rows automatically (Roman + others), not just Roman.

Alternative: pass `disableAnimation={reduceMotion}` from `MoreScreen` ONLY on Roman row. Lower-leverage, only fixes Roman. Choose preferred unless preferred breaks tests.

Constraints:
- Bradley #36 zero swallowed catches
- D-012 FACE+VOICE preserved
- D-013 RomanAvatar canonical preserved
- No forceExit
- R66 full Jest exit 0
- R0 grep on diff clean
- Tests: add regression test that with `useReducedMotion()` returning true, the press handlers don't trigger Animated.timing or set scale values <1

Verification:
1. tsc --noEmit exit 0
2. lint exit 0
3. Targeted Jest on HapticPressable.* + useReducedMotion.* + (any MoreScreen tests) exit 0
4. Full `npx jest --runInBand` exit 0
5. R0 grep clean

Title-only commit: `fix(community): #238 Roman P1 HapticPressable respects reduce-motion globally`
Author: Dynasia G <dynasia@trygrowthproject.com>.
Push force-with-lease to PR-238 branch `feat/roman-p1-mobile-chat`.
After push: `gh api -X POST /repos/BradleyGleavePortfolio/growth-project-mobile/actions/workflows/265423898/dispatches -f ref=feat/roman-p1-mobile-chat`.

Output: `/home/user/workspace/ROMAN_P1_238_REDUCE_MOTION_FIXER_REPORT.md`
End with `FIX COMPLETE: <sha>` or `FIX BLOCKED: <reason>`.

Sonnet 4.6 FORBIDDEN.
