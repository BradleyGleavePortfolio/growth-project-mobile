# AUDITOR BRIEF — Roman P1 #238 R2 CODE audit (post-combined-fixer)

Independent AUDITOR (GPT-5.5, fresh, NOT builder/fixer). Read `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md`, `/home/user/workspace/doctrine/roman_identity_spec.md` (§1 voice incl §1.4 forbidden moves / §1.6 failure tone, §2 twelve contexts, §3 mascot), `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`, `/tmp/tgp-agent-context/rules/R65_50_FAILURES_SWEEP.md`, `/tmp/tgp-agent-context/specs/AUDITOR_BRIEF_COMMON.md`. Also read the R1 reports (the FIXER claimed to fix all 16 findings):
- `/home/user/workspace/ROMAN_P1_MOBILE_R1_CODE_AUDIT_REPORT.md` (8-item F1–F8 list)
- `/home/user/workspace/ROMAN_P1_COMBINED_FIXER_R1_REPORT.md` (the fixer's claims)

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #238 — Roman P1 (client mobile chat)
- HEAD: `5ded65c194a1e97c10bad27583f164418cc7f7b5` (post combined-fixer R1)
- CI: 1/1 GREEN at this HEAD.
- Diff vs main: 18 files, 2496 insertions / 1 deletion.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-roman-p1-r2-code
cd /home/user/workspace/tgp/audit-roman-p1-r2-code
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/238/head:pr-238
git checkout pr-238
git log -1 --format='%H'   # MUST equal 5ded65c194a1e97c10bad27583f164418cc7f7b5
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Severity + merge bar
Standard. P0+P1+P2 must be CLEAN.

## VERIFY each F1–F8 fix landed (anti-fixer-fabrication)
For EACH item below, verify the fixer's claimed fix is REALLY at HEAD with file:line:

- **F1 (P0) role contract**: Zod schema must STRICTLY parse the wire value `'roman'` from backend (`roman.controller.ts` `toMessageView`), then map to internal UI role AFTER validation. Confirm:
  - The schema accepts `role: 'roman'` (NOT `'assistant'`).
  - Drift tests exist: extra-field rejection, bad-role rejection — both using REAL `roman` payloads.
- **F2 (P0/P1) fabricated Idempotency-Key**: Confirm REMOVED. `grep -nE 'Idempotency-Key|idempotency-key|idempotencyKey' src/` should show ZERO references in PR-touched files. Retry UX must NOT claim "safe to retry, deduplicated".
- **F3 (P1) emoji-regex ESLint**: `romanVoice.test.ts:67-68` no-misleading-character-class fix — confirm `u` flag and explicit code points, no `eslint-disable` added by fixer.
- **F4 (P1) rebase**: branch must be on top of mobile main `79c0a9be`; `.env.example` keeps BOTH `EXPO_PUBLIC_FF_COMMUNITY_ACKS` and `EXPO_PUBLIC_FF_ROMAN_CHAT`; `featureFlags.ts` keeps both.
- **F5 (P1) rollback bug** `useRomanChat.ts:157-180`: a successful send must NOT roll back the optimistic message when the follow-up `listMessages` refresh fails. Confirm the refresh error path is now isolated from the send error path.
- **F6 (P1/P2) SSE silent skip** `romanApi.ts:307-320`: malformed frames now THROW a typed `RomanWireError` — verify.
- **F7 (P2)**: interrupted copy moved out of `RomanMessageBubble.tsx:42-45` into `romanVoice.ts`. Verify it's only in `romanVoice.ts`.
- **F8 (P2)**: `featureFlags.ts` block reduced to a single line.

## VERIFY each U1–U8 fix (UX list, but cross-checked here for completeness)
- **U1** surface- and first-open-aware greeting per spec §2.1/§2.3
- **U2** visible 48dp retry affordance + honest §1.6 failure copy + `clearSendError` wiring
- **U3** scroll-to-latest on send, on receive, on keyboard open
- **U4** `AccessibilityInfo.announceForAccessibility` for incoming Roman messages, deduped by message id
- **U5** Roman-voiced state strings (loading/empty/error) all in `romanVoice.ts`
- **U6** raw hex (`#C9A961`, `#1A1A18`) removed from `RomanAvatar` → tokens. The fixer noted "RomanAvatar.tsx in community/ was out of lane" — confirm the lane boundary is correct (Roman avatar lives at `src/components/roman/RomanAvatar.tsx`, not `src/components/community/`).
- **U7** coach-specific entry-row copy
- **U8** dynamic composer growth with height cap

## FACE+VOICE invariant (hectacorn standing rule)
Every Roman-voiced string render-site MUST have `<RomanAvatar />` in the same component tree. Find every Roman string in the PR (e.g. via `grep -rn "romanVoice\." src/`) and verify each rendering screen/component has a RomanAvatar sibling. If any disembodied Roman voice → **P0**.

The user's directive: "wire him up for COACH SCREENS TOO!" — confirm coach surfaces that consume Roman content (CoachCommunityInboxScreen empty state etc.) ALSO have the RomanAvatar wired. If only client side has Roman wired AND the PR claims coach parity in U7 → check coach entry-row + chat surface.

## R0 grep battery (added lines including comments)
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E '^\+' \
  | grep -nE 'as any|as unknown as|@ts-ignore|@ts-expect-error|TODO|FIXME|Coming soon|catch *\(([^)]*)\) *\{ *\}|\.catch\(\(\) *=> *(undefined|null)\)|sonnet' \
  && echo "GREP DIRTY" || echo "GREP CLEAN"
```
Plus pictograph emoji on added lines, raw hex outside test files outside design tokens. Any hit → P0/P1.

## Bradley Law (#36)
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E '^\+' \
  | grep -nE 'catch *\([^)]*\) *\{ *\}|\.catch\(\(\) *=> *(undefined|null)\)|catch *\([^)]*\) *\{ *console\.'
```
ZERO. Any hit → P0.

## Re-run gates yourself
```bash
npx tsc --noEmit                    # 0 errors
npm run lint                        # 0 errors (warnings ok)
npx jest --runInBand                # full suite
```

## R69 — N/A (mobile)
Confirm: `git diff origin/main...HEAD -- '**/*.prisma'` empty.

## Output
Write `/home/user/workspace/ROMAN_P1_238_R2_CODE_AUDIT_REPORT.md` in standard auditor format. Add a "Fix verification table" with one row per F1..F8 showing file:line evidence + verified/not. End with literal `VERDICT: CLEAN | NOT CLEAN`.
