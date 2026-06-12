# FIXER BRIEF — v3-1 mobile #235 R4 UX combined fixer (3 P2s)

## Authority
- D-046: Combined fixer for 3 P2s — accent text contrast, list a11y announcements, HapticPressable reduce-motion.

## Worktree
- Path: `/home/user/workspace/tgp/fixer-v3-1-mobile-235-r4-ux`
- Branch: `feature/community-v3-challenges-mobile` at HEAD `918fa47e3968ccb5ef18ec2312fb42c21b8a05f3`

Read full audit: `/home/user/workspace/V3_1_MOBILE_235_R4_UX_AUDIT_REPORT.md` for exact file:line evidence.

## P2-1 — Dark-mode accent text contrast (3.02:1 vs WCAG AA 4.5:1)

Add a new dark-mode role `accentText` separate from `accent` (filled CTA bg). Apply to:
- `ChallengeCard.tsx:131-132,179` (13px action label)
- `CommunityChallengeDetailScreen.tsx:632-633,882` (opt-in label)
- `CommunityChallengesScreen.tsx:160-161` (retry label)
- `CommunityChallengeDetailScreen.tsx:428-429` (retry label)
- `ChallengeProgressSheet.tsx:294-295,474` (completion hint)

Implementation:
- In `src/styles/semanticColors.ts` (or wherever palette lives), add `accentText` role — dark mode value must achieve ≥4.5:1 against both `bgPrimary` (#121110) and `bgSurface` (#1C1A18). Suggested: `#E07373` or lighter (verify with contrast calculator).
- Light mode `accentText` = same as existing `accent` (or adjust if light-mode contrast is also marginal).
- DO NOT change `accent` itself (would break filled CTAs).
- Update the 5 listed component sites to use `accentText` for text-on-bg usage; keep `accent` for fills.

Add a regression test: `src/styles/__tests__/contrastTokens.test.ts` (or similar) asserting `accentText` against `bgPrimary` and `bgSurface` ≥4.5:1.

## P2-2 — Async lists not named/live-announced

Add to challenge/comment/leaderboard FlatLists:
- `accessibilityLabel={n > 0 ? \`Challenges, \${n} items\` : 'Challenges, empty'}` (and equivalents for comments/leaderboard)
- `accessibilityLiveRegion="polite"` on the list container
- Or use `AccessibilityInfo.announceForAccessibility(\`Loaded \${n} challenges\`)` on data-arrival useEffect when count transitions from 0→N or N→M.

Files:
- `CommunityChallengesScreen.tsx:187-208` — challenges list
- `CommunityChallengeDetailScreen.tsx:668-676` — comments list
- `CommunityChallengeDetailScreen.tsx:772-781` — leaderboard list

Add tests asserting list label + live-region or announcement firing.

## P2-3 — HapticPressable doesn't honor reduce-motion

Centralize in `src/components/HapticPressable.tsx:91-122`:
- Subscribe to `AccessibilityInfo.isReduceMotionEnabled()` (initial value) + `reduceMotionChanged` event (live updates).
- When reduce-motion enabled, set internal `shouldAnimate = false` and skip the Animated.spring/timing calls — but KEEP haptics firing.
- Keep `disableAnimation` prop override for explicit per-callsite control (so callers can still force-off independently).

Files:
- `src/components/HapticPressable.tsx` — central change
- Verify no callsite passes `disableAnimation={false}` expecting animation in reduce-motion (none should, based on audit).

Add regression test in `src/components/__tests__/HapticPressable.test.tsx`: simulate reduce-motion ON, press the button, assert NO Animated.spring/timing call but YES haptic.

## Constraints
- Author: Dynasia G <dynasia@trygrowthproject.com>
- Title-only commits, no trailers
- Model: Opus 4.8. Sonnet 4.6 FORBIDDEN.
- R0 grep clean
- Bradley Law #36 — no swallowed catches
- R66 full jest exit 0
- R70 fail-fast <30s before R66
- Use bash + gh + git with api_credentials=["github"]
- NO browser_task, NO github_mcp_direct
- R69 — N/A (no schema)

## Verification gates (all must pass before push)
1. npm ci exit 0
2. npx tsc --noEmit exit 0
3. npm run lint exit 0
4. Targeted: HapticPressable + CommunityChallenges + CommunityChallengeDetail + ChallengeProgressSheet + contrastTokens tests exit 0
5. Full jest --runInBand exit 0
6. R0 grep clean

## Push
- `git push --force-with-lease origin feature/community-v3-challenges-mobile`
- CI auto-dispatches (runner outage may persist; local gates are SOURCE OF TRUTH)

## Report
`/home/user/workspace/V3_1_MOBILE_235_R4_UX_FIXER_REPORT.md`:
- New HEAD SHA
- Per-P2 diff summary + contrast measurements (P2-1) + test evidence
- Gate evidence
- `FIX COMPLETE: <sha>` final line.
