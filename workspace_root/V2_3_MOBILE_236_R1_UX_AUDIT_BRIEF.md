# AUDITOR BRIEF — v2-3 mobile #236 R1 UX audit

Independent UX AUDITOR (GPT-5.5, fresh — NOT builder/fixer/designer). Read `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md`, `/tmp/tgp-agent-context/quality-references/MOBILE_APP_DESIGN_INTELLIGENCE.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`. NO code modifications.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #236 — `feature/community-v2-events-mobile`, HEAD `a79880745e7e2e33d933c4a09701f7b3559488b8`
- Feature flag: `EXPO_PUBLIC_FF_COMMUNITY_EVENTS` (default OFF — verify)

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-v2-3-mobile-r1-ux
cd /home/user/workspace/tgp/audit-v2-3-mobile-r1-ux
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/236/head:pr-236
git checkout pr-236
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## UX surfaces to audit
Events list, event detail, attendance toggle, create-event (coach only), empty/loading/error states.

## State-by-state UX review
For each surface, evaluate:
- **idle/loading**: subtle, reduced-motion safe, has a11y label
- **empty**: clear next-step copy, NO panic, calm
- **error**: NO destructive language, NO "Oops/Sorry", NO emoji, gives next action
- **interactive (RSVP toggle)**: 48dp tap target, optimistic update, rollback on failure with clear messaging

## Quiet-luxury invariants on added lines
1. NO pictograph emoji
2. NO raw hex outside `src/theme/tokens.ts`
3. fontWeight ≤ 600
4. Tap targets ≥ 48dp on interactive
5. Reduced-motion safe (any animation uses `useReducedMotion`)
6. Semantic tokens only (no `Colors.specificName` — use `tokens.colors.*`)

## a11y
- Every interactive control has `accessibilityRole`, `accessibilityLabel`, `accessibilityHint` where helpful, `accessibilityState` where applicable (e.g. selected/busy)
- State changes are announced (live region or `AccessibilityInfo.announceForAccessibility`)
- Lists declare `accessibilityRole="list"` and items declare `"listitem"`

## FACE+VOICE invariant
If any event renders Roman-voiced copy (greeting, error, etc.), it MUST have RomanAvatar in the same component tree. Event slice is unlikely to have Roman voice; verify with grep.

## Empty-state copy
NO "Coming soon", NO "We're working on it", NO sonnet/florid language. Calm, factual, with a clear next step.

## Verdict format
`VERDICT: CLEAN | NOT CLEAN`. Enumerate findings P0/P1/P2 with file:line evidence.

Report at `/home/user/workspace/V2_3_MOBILE_236_R1_UX_AUDIT_REPORT.md`.
