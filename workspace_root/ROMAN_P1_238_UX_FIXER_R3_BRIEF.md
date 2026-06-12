# FIXER BRIEF — Roman P1 #238 UX R3 (a11y + live regions + list semantics + motion)

FIXER (Opus 4.8 ONLY). Surgical. NO browser_task, NO github_mcp_direct.

Repo: `BradleyGleavePortfolio/growth-project-mobile`
PR: #238 (Roman P1 — entry rows + coach/client wiring + RomanAvatar canonical)
HEAD: `55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7`
Worktree: `/home/user/workspace/tgp/fixer-roman-p1-238-ux-r3`
`api_credentials=["github"]` for git/gh.

Setup:
```bash
mkdir -p /home/user/workspace/tgp/fixer-roman-p1-238-ux-r3
cd /home/user/workspace/tgp/fixer-roman-p1-238-ux-r3
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/238/head:pr-238
git checkout pr-238
git log -1 --format=%H   # MUST equal 55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7
git config user.email "dynasia@trygrowthproject.com"
git config user.name "Dynasia G"
npm ci
```

READ FIRST: `/home/user/workspace/ROMAN_P1_238_R3_UX_AUDIT_REPORT.md` (3 P1 + 1 P2)

Findings to close:
- **P1-1** Loading states need busy/progressbar a11y semantics on Roman chat + entry-row loading states
- **P1-2** Error/rollback announcements need `accessibilityLiveRegion="polite"` AND `AccessibilityInfo.announceForAccessibility` calls
- **P1-3** Roman chat message list AND Roman entry-list surfaces need `accessibilityRole="list"` + each item `accessibilityRole="listitem"`
- **P2-1** Reduced motion: Roman entry-row hover/animation defaults must respect `AccessibilityInfo.isReduceMotionEnabled()` (typing indicator already does — extend pattern)

Constraints:
- Bradley Law #36: ZERO swallowed catches. Any new `.catch()` must log structured context or rethrow.
- R0 grep battery on added lines: no TODO/FIXME/console.log/any-cast/pictograph/banned copy
- D-012 FACE+VOICE: every Roman copy render-site has RomanAvatar in same tree (preserve)
- D-013 RomanAvatar canonical at `src/components/roman/RomanAvatar.tsx`
- NO `forceExit`, NO `--detectOpenHandles` masks
- R66: full `npx jest --runInBand` before push, expect exit 0
- R70: fail-fast lane <30s before R66

Verification before push:
1. Targeted Jest on touched files + a11y suites — exit 0
2. Full `npx jest --runInBand` — exit 0
3. `npx tsc --noEmit` exit 0
4. ESLint on changed files exit 0
5. R0 grep on diff

Commit: title-only, e.g. `fix(community): #238 Roman P1 UX R3 a11y + live regions + list semantics + reduced motion`
Author: `Dynasia G <dynasia@trygrowthproject.com>`
Push: force-with-lease to `feature/roman-p1-entry-rows` (or whichever branch PR-238 sources from)

Output report: `/home/user/workspace/ROMAN_P1_238_UX_FIXER_R3_REPORT.md`
End with `FIX COMPLETE: <sha>` or `FIX BLOCKED: <reason>`.

Sonnet 4.6 FORBIDDEN.
