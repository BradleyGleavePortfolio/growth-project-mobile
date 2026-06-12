# AUDITOR BRIEF — MWB-4 #237 R1 UX audit

Independent UX AUDITOR (GPT-5.5, fresh, NOT builder/fixer/designer). Read `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md`, `/tmp/tgp-agent-context/quality-references/MOBILE_APP_DESIGN_INTELLIGENCE.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`. Surface: Master Workout Builder phase 4 — autosave with offline mirror + 409 conflict resolution. UX surface: the `AutosaveStatusPill` + `CoachWorkoutBuilderScreen` autosave indicators.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #237, HEAD `c1120e127403446afe89634242eebc100dde7977`
- Feature flag: `EXPO_PUBLIC_FF_MWB_AUTOSAVE` (default OFF — verify).

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-mwb-4-r1-ux
cd /home/user/workspace/tgp/audit-mwb-4-r1-ux
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/237/head:pr-237
git checkout pr-237
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Severity + merge bar
Standard P0+P1+P2 CLEAN.

## UX-specific checks for autosave indicator
The autosave pill has multiple states (idle / saving / saved / offline / conflict). For each state:
- **idle**: per fixer note "pill is intentionally hidden while idle" — verify this is correct UX (not a stuck state).
- **saving**: subtle, non-blocking. Reduced-motion safe. a11y label.
- **saved**: confirmation appears briefly. NO celebratory emoji. NO checkmark over-styling.
- **offline**: clear but calm. NO alarm icons. NO red/destructive color (quiet-luxury). Indicates work is preserved locally.
- **conflict (409)**: this is the dangerous state — must NEVER imply data loss. Copy must guide user to resolution without panic. NO "Error!", NO destructive language.

## Quiet-luxury invariants on added lines
1. NO pictograph emoji
2. NO raw hex outside `src/theme/tokens.ts`
3. fontWeight ≤ 600
4. Tap targets ≥ 48dp on interactive
5. Reduced-motion safe
6. Semantic tokens only

## a11y
- Pill states must be announced (`accessibilityLiveRegion="polite"` or `AccessibilityInfo.announceForAccessibility`).
- Status changes must have `accessibilityState={{ busy: <bool> }}` where relevant.
- Conflict-resolution affordance (if any) must be Pressable with ≥48dp hit area + clear a11y label.

## Roman voice gate
Coach workout builder is NOT a Roman surface — system voice. Confirm NO Roman attribution. If any Roman voice IS introduced (e.g. for autosave guidance), the FACE+VOICE invariant applies (RomanAvatar in same component tree).

## Reduced-motion
Any pulse/spinner on the saving pill must be damped or replaced under reduced-motion. Verify `useReducedMotion()` (or equivalent) is checked.

## Output
Write `/home/user/workspace/MWB_4_237_R1_UX_AUDIT_REPORT.md` in standard auditor format. End with literal `VERDICT: CLEAN | NOT CLEAN`. Do NOT modify code.
