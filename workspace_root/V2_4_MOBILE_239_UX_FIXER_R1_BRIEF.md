# FIXER BRIEF — v2-4 mobile #239 UX combined fixer R1

You are a FIXER (Opus 4.8, NOT builder/auditor — R31). Author: `Dynasia G <dynasia@trygrowthproject.com>`. Title-only commits, no trailers. Read `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md`, `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md`, `/tmp/tgp-agent-context/quality-references/MOBILE_APP_DESIGN_INTELLIGENCE.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`. Read the UX audit:
- `/home/user/workspace/V2_4_MOBILE_239_R1_UX_AUDIT_REPORT.md` (VERDICT: NOT CLEAN — 1 P1 + 2 P2)
- `/home/user/workspace/V2_4_MOBILE_239_R1_CODE_AUDIT_REPORT.md` (VERDICT: CLEAN — no code fixes needed)

## PR & repo
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #239 — `feature/community-v2-ai-triage-mobile`
- HEAD: `97954d253eb5517948d66421bebbc285f7c93604`
- CI: 1/1 GREEN (passing). Fix MUST NOT regress CI.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/fixer-v2-4-mobile-ux
cd /home/user/workspace/tgp/fixer-v2-4-mobile-ux
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/239/head:pr-239
git checkout pr-239
git log -1 --format='%H'   # MUST equal 97954d25...
git config user.email "dynasia@trygrowthproject.com"
git config user.name  "Dynasia G"
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Findings to fix (EXACTLY these — no scope creep)

### P1 — loading a11y semantics
`src/components/community/AiTriageCard.tsx` around lines 96, 100, 101. The loading state currently uses `accessibilityRole="summary"`. Per RN a11y semantics, the loading container MUST be either:
- `accessibilityRole="progressbar"` (preferred — explicit indeterminate progress), OR
- Keep `accessibilityRole="summary"` AND add `accessibilityState={{ busy: true }}`

**Choose `accessibilityRole="progressbar"`** for cleaner intent. Update the test if it asserts the role. Verify the loading container still has its existing `accessibilityLabel`.

### P2 — typed state machine missing `empty`
`src/components/community/AiTriageCard.tsx:42, 153, 159`. The render-state contract claims `loading | error | empty | ready` (per PR body), but `Status` union omits `empty` — empty is derived inside `ready`. Fix:
1. Add `'empty'` to the `Status` type union.
2. Update `InboxTriageBanner` (the caller in `CoachCommunityInboxScreen.tsx` if that's where derivation happens) to pass `status="empty"` explicitly when `is_empty === true`.
3. Keep the existing all-zero guard inside `ready` as defensive validation, NOT the primary state path.
4. Update tests to exercise the new `empty` status path explicitly.

### P2 — semantic tokens (typography + micro-layout)
`src/components/community/AiTriageCard.tsx` lines 251, 256, 258, 269, 272, 282 use raw numbers for typography/spacing. Fix:
1. `import { typography } from 'src/theme/tokens'` (verify exact import path — check the file).
2. Replace raw text-style numbers with `...typography.eyebrow`, `...typography.bodySmall`, and an appropriate heading/body token.
3. Replace ad-hoc rule/gap metrics (line heights, gaps) with `tokens.spacing.*` or a tokenized local constant.
4. Do NOT introduce new tokens unless absolutely necessary; if you must, add them to `src/theme/tokens.ts` with semantic names matching the existing convention.

## Hard rules
- FACE+VOICE: this card is system-voice (AI triage on COACH app). NO RomanAvatar attribution allowed (would be wrong-surface). Already CLEAN — keep it that way. The Roman empty state is a SEPARATE component outside this card.
- R0 grep battery on added lines MUST stay clean: no `as any`, no `as unknown as`, no `@ts-ignore`, no TODO/FIXME, no swallowed catch, no raw hex, no pictograph emoji.
- R69: N/A (mobile).
- R66 full jest before push.

## Verify
```bash
npx tsc --noEmit                    # 0 errors
npm run lint                        # 0 errors (warnings ok)
npx jest --runInBand src/components/community/__tests__/AiTriageCard.test.tsx \
                     src/screens/community/__tests__/coachCommunityInboxAiTriageFlagOff.test.tsx
npx jest --runInBand                # full suite must stay green
```

## Commit + push
```bash
git add src/components/community/AiTriageCard.tsx \
        src/components/community/__tests__/AiTriageCard.test.tsx \
        src/screens/community/CoachCommunityInboxScreen.tsx \
        [theme/tokens.ts if you added tokens]
git commit -m "fix(community-v2-4-mobile): progressbar a11y on loading, typed empty state, semantic typography tokens on AiTriageCard"
git push origin HEAD:feature/community-v2-ai-triage-mobile
sleep 60
gh pr view 239 --repo BradleyGleavePortfolio/growth-project-mobile --json headRefOid,statusCheckRollup
```

## Output
Write `/home/user/workspace/V2_4_MOBILE_239_UX_FIXER_R1_REPORT.md`:
```
# UX FIXER REPORT — v2-4 mobile #239 R1
Fixes:
  1. AiTriageCard.tsx loading → accessibilityRole=progressbar (P1)
  2. Status union + InboxTriageBanner typed `empty` state (P2)
  3. Typography/spacing tokens applied at 6 sites (P2)

Local tsc: pass
Local lint: pass
Local jest targeted: PASS
Local jest full: PASS (N/N)
Pushed: <sha>
CI: <green / red + reasoning>
R0 grep: CLEAN
FACE+VOICE: N/A (system-voice card, no Roman attribution — confirmed not added)

FIX COMPLETE: <sha>
```
End literally with `FIX COMPLETE: <sha>`.
