# AUDIT — Roman P1 Mobile Chat (PR #238) — R2 code audit

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: `#238`  
Audited worktree: `/home/user/workspace/tgp/audit-roman-p1-r2-code`  
Audited HEAD: `5ded65c194a1e97c10bad27583f164418cc7f7b5`  
Base checked: `origin/main` = `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`; merge-base = `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`  
Diff checked: 18 files, 2496 insertions / 1 deletion.  
R69: N/A mobile; `git diff origin/main...HEAD -- '**/*.prisma'` is empty.

## VERDICT

**NOT CLEAN** — do not merge until the P1/P2 findings below are fixed.

## Gates run

- `npm ci`: completed successfully; npm reported 18 audit vulnerabilities (14 moderate, 4 high) in dependency tree after install.
- `npx tsc --noEmit`: initial `npx` invocation was killed by the sandbox, but direct `./node_modules/.bin/tsc --noEmit --pretty false` completed with exit 0 and no output.
- `npm run lint`: exit 0; 82 warnings, 0 errors.
- `npx jest --runInBand`: full suite reached `212 passed, 212 total`, `2459 passed, 2459 total`, `5 passed, 5 total`, then did not exit due a lingering async handle and was killed by the sandbox. A follow-up full-suite run with `--silent --forceExit` exited 0 with the same totals.

## P0 findings

None found.

## P1 findings

### P1 — U6 / avatar lane directive not satisfied; RomanAvatar remains in `community/` with raw hex constants

Evidence:
- There is no `src/components/roman/RomanAvatar.tsx`; the only RomanAvatar file is `src/components/community/RomanAvatar.tsx`.
- `src/components/community/RomanAvatar.tsx:59-61` defines `ROMAN_ACCENT = '#C9A961'` and `ROMAN_INK = '#1A1A18'` directly, not via design tokens.
- New Roman chat components import that community avatar: `src/components/roman/RomanGreeting.tsx:16`, `src/components/roman/RomanMessageBubble.tsx:16`, `src/components/roman/RomanState.tsx:17`, `src/components/roman/RomanTypingIndicator.tsx:18`, and `src/screens/roman/RomanChatScreen.tsx:37`.

Why P1: the R2 brief explicitly requires confirming the lane boundary as `src/components/roman/RomanAvatar.tsx`, not `src/components/community/`, and U6 requires the raw avatar hex values removed into tokens. This did not land.

Required fix: move/wrap RomanAvatar into the Roman component lane or otherwise satisfy the explicit lane contract, and replace the avatar raw hex constants with theme/design tokens.

### P1 — Bradley Law #36 violation: swallowed `.catch` in new Roman lane

Evidence:
- `src/components/roman/RomanTypingIndicator.tsx:36-45` calls `AccessibilityInfo.isReduceMotionEnabled().then(...).catch(() => { ... })` and the catch body only contains a comment; it neither logs nor surfaces the failure.

Why P1: Bradley Law / Failure #36 is zero tolerance for swallowed errors. Even if the animation fallback is safe, the caught platform query failure should be handled with logged context or the code should avoid a catch that hides an operational signal.

Required fix: log the failure with structured, non-PII context (for example `logger.warn('RomanTypingIndicator.reduceMotionQuery', err)`) while preserving the safe fallback behavior.

## P2 findings

### P2 — F2 verification is not exact: PR-touched files still contain `Idempotency-Key` references

Evidence:
- Runtime send headers are clean: `src/api/romanApi.ts:414-420` posts only `Content-Type`, `Accept`, and optional `Authorization`.
- However, the R2 brief requires `grep -nE 'Idempotency-Key|idempotency-key|idempotencyKey' src/` to show zero references in PR-touched files. PR-touched `src/api/__tests__/romanApi.test.ts:266-279` still contains `Idempotency-Key` in the test name, comments, and assertion.

Why P2: the fabricated runtime header was removed, but the anti-fabrication verification instruction was stricter than runtime behavior and is not satisfied exactly.

Required fix: rewrite the negative test so it proves the header is absent without retaining the forbidden string in a PR-touched file, or get explicit reviewer acceptance that negative assertion references are allowed.

### P2 — F8 verification is not exact: `featureFlags.ts` Roman block is not a single line

Evidence:
- The Roman feature flag addition in `src/config/featureFlags.ts:142-144` is a section comment, a doc comment, and the flag line.
- The diff adds four lines in that area, not a single additive line.

Why P2: R1 F8 required the feature flag block to be reduced to a single line. The bloated 11-line block is gone, but the current shape still misses the exact requirement.

Required fix: reduce the change to the single `romanChat: readFlag('EXPO_PUBLIC_FF_ROMAN_CHAT', false),` line unless reviewers explicitly accept the comment lines.

## Fix verification table (F1–F8)

| ID | Status | Evidence |
|---|---|---|
| F1 role contract | VERIFIED | `src/api/romanApi.ts:97-123` defines strict wire roles `['user','roman']`; `src/api/romanApi.ts:109-112` maps validated `roman` to internal `assistant`; `src/api/romanApi.ts:135-143` maps wire messages after validation. Real `roman` payload tests are at `src/api/__tests__/romanApi.test.ts:90-98` and drift tests at `src/api/__tests__/romanApi.test.ts:157-187` cover acceptance, bad roles, extra fields, and list drift. |
| F2 fabricated idempotency | NOT FULLY VERIFIED | Runtime send no longer sends the header (`src/api/romanApi.ts:414-420`), but PR-touched `src/api/__tests__/romanApi.test.ts:266-279` still contains `Idempotency-Key` references, violating the brief's zero-reference grep requirement. |
| F3 emoji-regex ESLint | VERIFIED | `src/components/roman/__tests__/romanVoice.test.ts:77-90` uses explicit Unicode code point ranges through `new RegExp(..., 'u')`; no `eslint-disable` is present in this file. |
| F4 rebase | VERIFIED | HEAD is based on `origin/main` `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`; `.env.example:100` keeps `EXPO_PUBLIC_FF_COMMUNITY_ACKS`, `.env.example:104` adds `EXPO_PUBLIC_FF_ROMAN_CHAT`; `src/config/featureFlags.ts:140` keeps `communityAcks` and `src/config/featureFlags.ts:144` adds `romanChat`. |
| F5 rollback bug | VERIFIED | `src/screens/roman/useRomanChat.ts:179-199` rolls back only when `sendMessage` throws; after success, `src/screens/roman/useRomanChat.ts:201-219` preserves the optimistic user turn and appends the local assistant reply; `src/screens/roman/useRomanChat.ts:221-238` isolates refresh failure to logging without rollback. |
| F6 SSE silent skip | VERIFIED | `src/api/romanApi.ts:360-368` throws `RomanWireError` for non-JSON frames; `src/api/romanApi.ts:380-384` throws `RomanWireError` for chunk shape drift; test coverage at `src/api/__tests__/romanApi.test.ts:241-244`. |
| F7 interrupted copy | VERIFIED | `src/components/roman/romanVoice.ts:150-151` defines `ROMAN_INTERRUPTED_NOTE`; `src/components/roman/RomanMessageBubble.tsx:17` imports it and `src/components/roman/RomanMessageBubble.tsx:43-46` renders it. A grep found the old text only in `romanVoice.ts`. |
| F8 feature flag one-line block | NOT VERIFIED | `src/config/featureFlags.ts:142-144` still has a section comment + doc comment + flag line. The requirement was a single-line block. |

## UX fix cross-check (U1–U8)

| ID | Status | Evidence |
|---|---|---|
| U1 greeting | VERIFIED | `src/components/roman/romanVoice.ts:53-75` selects first-open, client, and coach greetings; `src/components/roman/RomanGreeting.tsx:48-51` renders greeting and subtitle. |
| U2 retry affordance | VERIFIED | `src/screens/roman/RomanChatScreen.tsx:239-255` renders visible inline retry with RomanAvatar and “Send again”; `src/components/roman/romanVoice.ts:159-160` contains honest retry copy; `src/screens/roman/RomanChatScreen.tsx:145-148` wires retry to send. |
| U3 scroll to latest | VERIFIED | `src/screens/roman/RomanChatScreen.tsx:213-223` wires FlatList ref/content-size change; code also scrolls on send/receive/keyboard via the screen callbacks inspected in the same file. |
| U4 accessibility announce | VERIFIED | `src/screens/roman/RomanChatScreen.tsx:120` announces Roman replies with `ROMAN_REPLY_ANNOUNCE_PREFIX`; dedupe is via message id in the adjacent effect. |
| U5 state strings centralised | VERIFIED | Roman state strings are in `src/components/roman/romanVoice.ts:90-168` and rendered through RomanState / screen sites with avatars. |
| U6 avatar tokens/lane | NOT VERIFIED | See P1 finding: avatar remains in `src/components/community/RomanAvatar.tsx:59-61` with raw hex and Roman chat imports it from `community/`. |
| U7 coach entry row | VERIFIED | Client row copy at `src/screens/client/MoreScreen.tsx:129-137`; coach row copy and hint at `src/screens/coach/SettingsScreen.tsx:554-564`; coach navigator wires `surface="coach"` at `src/navigation/CoachNavigator.tsx:397-403`. |
| U8 composer growth | VERIFIED | `src/components/roman/RomanComposer.tsx:67-78` computes dynamic height cap from window height and enables scrolling after max; `src/components/roman/RomanComposer.tsx:94-105` applies `height`/`maxHeight` and `onContentSizeChange`. |

## FACE+VOICE invariant

Client/coach Roman chat render-sites are clean: `RomanGreeting` renders `RomanAvatar` with greeting/subtitle (`src/components/roman/RomanGreeting.tsx:40-52`), assistant bubbles render `RomanAvatar` with Roman content/interrupted note (`src/components/roman/RomanMessageBubble.tsx:32-48`), state copy renders with `RomanAvatar` (`src/components/roman/RomanState.tsx:58-67`), typing copy renders with `RomanAvatar` (`src/components/roman/RomanTypingIndicator.tsx:66-77`), and inline loading/send-error copy renders with avatars (`src/screens/roman/RomanChatScreen.tsx:223-229`, `src/screens/roman/RomanChatScreen.tsx:239-244`).

Coach app wiring is present for Roman chat: `src/navigation/CoachNavigator.tsx:397-403` registers `RomanChat` behind the flag and passes `surface="coach"`; `src/screens/coach/SettingsScreen.tsx:554-564` routes the coach entry row to Roman with coach-specific copy. Coach community empty states that consume Roman content also render the avatar via `src/components/community/coach/CoachEmptyState.tsx:55-64`.

Caveat: the FACE+VOICE invariant is visually satisfied, but the avatar lane/token directive is not satisfied (P1 above).

## R0 / R65 / Bradley Law grep battery

- Exact R0 added-line battery from the brief: `GREP CLEAN`.
- Bradley Law exact grep from the brief: zero matches.
- Added-line pictograph emoji scan: zero matches.
- Added-line raw-hex scan: zero matches.
- Manual Bradley Law review still found the swallowed `.catch` in `src/components/roman/RomanTypingIndicator.tsx:36-45`; the exact grep misses this `.catch(() => { comment-only })` form, but #36 zero tolerance still applies.
- `eslint-disable` occurrences in changed files: `src/api/__tests__/romanApi.test.ts:50` and `src/components/roman/RomanTypingIndicator.tsx:80`; neither is related to F3's emoji regex.
- Test skip/only scan in changed files: zero matches.

## Saved evidence files

- `/home/user/workspace/roman_p1_r2_branch_diff_evidence.txt`
- `/home/user/workspace/roman_p1_r2_f1_f2_f6_evidence.txt`
- `/home/user/workspace/roman_p1_r2_f1_drift_tests.txt`
- `/home/user/workspace/roman_p1_r2_f3_f4_f7_f8_voice_evidence.txt`
- `/home/user/workspace/roman_p1_r2_f4_f8_diff.txt`
- `/home/user/workspace/roman_p1_r2_f5_u2_u3_u4_face_evidence.txt`
- `/home/user/workspace/roman_p1_r2_f5_refresh_tail.txt`
- `/home/user/workspace/roman_p1_r2_coach_wiring_evidence.txt`
- `/home/user/workspace/roman_p1_r2_coach_community_avatar_evidence.txt`
- `/home/user/workspace/roman_p1_r2_avatar_lane_evidence.txt`
- `/home/user/workspace/roman_p1_r2_grep_battery_evidence_exact.txt`
- `/home/user/workspace/roman_p1_r2_pictograph_added_evidence.txt`
- `/home/user/workspace/roman_p1_r2_tsc_retry.log`
- `/home/user/workspace/roman_p1_r2_lint.log`
- `/home/user/workspace/roman_p1_r2_jest_silent.log`
- `/home/user/workspace/roman_p1_r2_jest_forceexit.log`

VERDICT: NOT CLEAN
