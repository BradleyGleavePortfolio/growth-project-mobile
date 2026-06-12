# FIXER BRIEF — ROMAN P1 MOBILE CHAT — Round 1 (COMBINED code + UX)

You are an Opus 4.8 fixer (R31 — not the builder or either auditor). Fix PR **#238** to resolve ALL findings from BOTH R1 audits. Code verdict was **DIRTY**; UX verdict was **NEEDS_REVISION**.

## Target
- Repo: `BradleyGleavePortfolio/growth-project-mobile`, PR #238, HEAD `d72c02c7e7c75878b1944a029cf0acfa69d700d7` (get branch name via `gh pr view 238`). Mobile main has MOVED to `79c0a9be` (v2-2 merged) — you must rebase.
- Backend Roman contract is MERGED on backend main (`roman.controller.ts`, `roman.dto.ts`, prisma enum `RomanMessageRole { user, roman }`). The backend is the binding contract — the backend lane is CLOSED; do not request backend changes.
- Setup (bash + `gh`, api_credentials=["github"], NEVER browser): clone to `/home/user/workspace/tgp/fixer-roman-p1`, checkout the PR branch, verify HEAD.

## Read first (NO SKIMMING)
1. `/home/user/workspace/ROMAN_P1_MOBILE_R1_CODE_AUDIT_REPORT.md`
2. `/home/user/workspace/ROMAN_P1_MOBILE_R1_UX_AUDIT_REPORT.md` (8-item revision checklist with file:line evidence)
3. Roman identity spec: `/home/user/workspace/roman_identity_spec.md` (§1 voice incl §1.4 forbidden moves / §1.6 failure tone, §2 twelve contexts, §3 mascot)
4. Doctrine: `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md` + `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md`

## Fix list — CODE (decisions already made; implement exactly)
- **F1 (P0) role contract**: Backend sends `role: 'roman'` verbatim (`roman.service.ts:437-439`, controller `toMessageView`); mobile schema expects `'assistant'`. Fix: parse the wire value `'roman'` STRICTLY in the Zod schema, then map to the internal UI role AFTER validation. Add drift tests using real `roman` payloads (extra-field rejection, bad role rejection).
- **F2 (P0/P1) fabricated Idempotency-Key**: backend never reads it (`SendMessageDto` only has `content`). REMOVE the header, all claims about it, and its tests. Make retry UX honest accordingly (no "safe to retry, deduplicated" implications).
- **F3 (P1) red CI**: eslint `no-misleading-character-class` on emoji regex at `romanVoice.test.ts:67-68` — fix properly (use `u` flag / explicit code points), no eslint-disable.
- **F4 (P1) rebase**: rebase onto mobile main `79c0a9be`, resolving `.env.example` conflict by KEEPING BOTH flags.
- **F5 (P1) rollback bug** `useRomanChat.ts:157-180`: a successful send must NOT roll back the optimistic message when the follow-up `listMessages` refresh fails — separate the refresh error from the send error.
- **F6 (P1/P2) SSE silent skip** `romanApi.ts:307-320`: malformed frames must throw a typed `RomanWireError`, not be silently skipped.
- **F7 (P2)**: move hardcoded interrupted copy out of `RomanMessageBubble.tsx:42-45` into `romanVoice.ts`.
- **F8 (P2)**: reduce the 11-line `featureFlags.ts` block to a single line.

## Fix list — UX (ALL 8 checklist items from the UX report)
- **U1**: surface- and first-open-aware greeting per spec §2.1/§2.3.
- **U2**: visible 48dp retry affordance + honest §1.6 failure copy + `clearSendError` wiring.
- **U3**: scroll-to-latest on send, on receive, and on keyboard open.
- **U4**: `AccessibilityInfo.announceForAccessibility` for incoming Roman messages, deduped by message id.
- **U5**: Roman-voiced state strings (loading/empty/error) — all in `romanVoice.ts`.
- **U6**: remove accent fills / raw hex (`#C9A961`, `#1A1A18` in `RomanAvatar`) → design tokens.
- **U7**: coach-specific entry-row copy.
- **U8**: dynamic composer growth with a height cap.

## Hard rules
- FACE+VOICE: Roman's voice is NEVER disembodied — every Roman-voiced string renders with the RomanAvatar face.
- R0 greps on added lines INCLUDING comments must return NOTHING: `as unknown as`, `as any`, `@ts-ignore`, TODO/FIXME/placeholder, "Coming soon", empty catch, `.catch(() => undefined)`, sonnet, raw hex outside tests, pictograph emoji (comment-literal failures recurred 3× this wave).
- Lane containment: mobile Roman surfaces only; zero Prisma/backend changes.

## Gates before declaring done
- `npx tsc --noEmit` zero NEW errors vs main (pre-existing expo-notifications TS1010 allowed).
- Targeted jest for Roman suites (npm install often times out — use the shared node_modules symlink trick, exclude from commits; document blockers with exact errors).
- CI green at final HEAD (`gh pr checks 238`) — the F3 lint fix must turn CI green.
- Self-check ALL F1–F8 and U1–U8 present at final HEAD with file:line.

## Output
Commits: title-only messages, author Dynasia G <dynasia@trygrowthproject.com>. Rebase-before-final-push. Push to the PR branch. Update PR #238 body via REST (`gh api` PATCH), NOT `gh pr edit`. Report → `/home/user/workspace/ROMAN_P1_COMBINED_FIXER_R1_REPORT.md` (per-finding fix table with file:line + test evidence). End completion message exactly: `FIX COMPLETE: <sha>`
