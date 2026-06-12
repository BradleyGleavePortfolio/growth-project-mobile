# AUDITOR BRIEF — v3-1 mobile #235 R2 UX audit

Independent UX AUDITOR (GPT-5.5, fresh — NOT builder/fixer/designer). Read `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md`, `/tmp/tgp-agent-context/quality-references/MOBILE_APP_DESIGN_INTELLIGENCE.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`. NO code modifications.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #235 — `feature/community-v3-challenges-mobile`, HEAD `7a4b7aeddecee8f48887ddd92bb3c6262404b114`
- Feature flag: `EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES` (default OFF — verify)

## D-009 context
Per operator decision D-009, the v3-1 doctrine fixer:
- Path B: extended `ALLOWLIST_LEADERBOARD_REFERENCE` for leaderboard tokenization
- fontWeight downgrade (no allowlist) was still applied
Verify both in place.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-v3-1-mobile-r2-ux
cd /home/user/workspace/tgp/audit-v3-1-mobile-r2-ux
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/235/head:pr-235
git checkout pr-235
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## UX surfaces to audit
Challenge list (coach + client), challenge detail, join/leave affordances, leaderboard, completion notifications, empty/loading/error states.

## State-by-state UX review
For each surface:
- **idle/loading**: subtle, reduced-motion safe, has a11y label, busy state on container
- **empty**: clear next-step copy, calm, no "Coming soon" / "We're working on it"
- **error**: calm, no "Oops/Sorry", gives next action, error copy matches available affordance
- **interactive (join/leave button)**: ≥48dp tap target, optimistic update, rollback messaging announced via live region

## Quiet-luxury invariants on added lines
1. NO pictograph emoji
2. NO raw hex outside `src/theme/tokens.ts` (note: `ALLOWLIST_LEADERBOARD_REFERENCE` exception applies to leaderboard surface only)
3. fontWeight ≤ 600 across ALL surfaces (no allowlist exception)
4. Tap targets ≥ 48dp on interactive
5. Reduced-motion safe
6. Semantic tokens only (no `Colors.<name>` outside leaderboard allowlist)

## a11y
- All interactive controls: `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` where helpful, `accessibilityState` where applicable
- State changes announced via live region or `AccessibilityInfo.announceForAccessibility`
- Lists: `accessibilityRole="list"` + items `"listitem"`
- Loading: `progressbar` role + `busy: true`

## FACE+VOICE invariant
Any Roman-voiced copy on challenge surfaces MUST have RomanAvatar in same component tree.

## Empty-state copy
NO "Coming soon", NO "We're working on it", NO sonnet/florid language. Calm, factual, with clear next step.

## Verdict format
`VERDICT: CLEAN | NOT CLEAN`. Enumerate P0/P1/P2 with file:line evidence.

Report at `/home/user/workspace/V3_1_MOBILE_235_R2_UX_AUDIT_REPORT.md`.
