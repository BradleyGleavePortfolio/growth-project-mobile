# Roman P1 Mobile R1 Code Audit Report

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: `#238` (`feat/roman-p1-mobile-chat`)  
Audited mobile HEAD: `d72c02c7e7c75878b1944a029cf0acfa69d700d7`  
Backend contract checked against: `growth-project-backend` main (`3f271b3952d3c9c81e1540227c3a768c6a838a93`)  
Current mobile `origin/main`: `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`

## Verdict

**DIRTY** — do not merge.

The PR fails the top-priority anti-fabrication gate. Mobile does not match the real backend wire contract for Roman message roles, and it documents/tests retry idempotency that the backend does not implement for `POST /roman/sessions/:id/messages`. CI is also red at the exact PR HEAD, and the PR is not cleanly mergeable into current `main`.

## Blocking findings

### P0 — Backend/message role contract mismatch: mobile expects `assistant`; backend returns `roman`

**Evidence**

- Backend Prisma enum is `RomanMessageRole { user, roman }`, not `assistant`: `growth-project-backend/prisma/schema.prisma:6044-6049`.
- Backend persists assistant turns with `role: 'roman'`: `growth-project-backend/src/roman/roman.service.ts:437-439`.
- Backend controller maps message role verbatim in `toMessageView`: `growth-project-backend/src/roman/roman.controller.ts:204-218`, specifically `role: m.role` at `:213`.
- Mobile declares `ROMAN_MESSAGE_ROLES = ['user', 'assistant']`: `src/api/romanApi.ts:89`.
- Mobile strict schema validates `role: z.enum(ROMAN_MESSAGE_ROLES)`: `src/api/romanApi.ts:93-101`.
- Mobile UI treats only `message.role === 'assistant'` as Roman/assistant: `src/components/roman/RomanMessageBubble.tsx:29-34`.
- Mobile contract tests use fabricated backend data with `role: 'assistant'`: `src/api/__tests__/romanApi.test.ts:89-94`.

**Impact**

`listMessages()` will reject real backend assistant messages with `role: 'roman'` as wire drift, because the mobile schema only accepts `assistant`. If a `roman` role reached the bubble component, it would not render as a Roman assistant bubble/avatar because the UI checks for `assistant`.

**Required fix**

Mirror the backend wire contract exactly. Either use `role: 'roman'` throughout mobile wire/UI state, or parse a strict wire schema with `role: 'roman'` and explicitly map to an internal UI role after validation. Update drift tests to include real backend `roman` payloads.

---

### P0/P1 — Fabricated send idempotency contract

**Evidence**

- Mobile header comment claims `Idempotency-Key` deduplicates retry of the same logical turn server-side: `src/api/romanApi.ts:49-50`.
- `sendMessage()` sends `Idempotency-Key`: `src/api/romanApi.ts:348-356`.
- PR body claims buffered SSE preserves “persistence, idempotency, and rate-limit semantics”: `/home/user/workspace/roman_pr_body.txt:68-81`.
- PR tests assert the header exists: `src/api/__tests__/romanApi.test.ts:228-234`.
- Real backend `sendMessage()` accepts only request, response, path id, and `SendMessageDto`; it never reads an idempotency header: `growth-project-backend/src/roman/roman.controller.ts:91-119`.
- Real backend DTO for send contains only `content`: `growth-project-backend/src/roman/roman.dto.ts:28-35`.
- Backend Roman idempotency grep found only open/resume day-key idempotency in Roman (`growth-project-backend/src/roman/roman.service.ts:78`); no Roman send-message idempotency handler exists.

**Impact**

The client and PR body present retry deduplication as real backend behavior, but the backend ignores the header for Roman message sends. A retry after a transport/list-refresh failure can create duplicate user turns.

**Required fix**

Either implement backend idempotency for `POST /roman/sessions/:id/messages` and document the exact contract, or remove the header, remove the claims/tests, and ensure the UI does not present retry flows as duplicate-safe.

---

### P1 — CI is red at exact PR HEAD

**Evidence**

- `gh pr view 238` reports the `CI / Typecheck, lint, test` check as `FAILURE` for exact head `d72c02c7e7c75878b1944a029cf0acfa69d700d7`: `/home/user/workspace/roman_pr_ci_test_evidence.txt`.
- Failed CI log reports: `src/components/roman/__tests__/romanVoice.test.ts` line 68, `Unexpected combined character in character class  no-misleading-character-class`: CI job `https://github.com/BradleyGleavePortfolio/growth-project-mobile/actions/runs/27388958630/job/80942125656`.
- The offending regex is at `src/components/roman/__tests__/romanVoice.test.ts:67-68`.

**Impact**

The exact PR head is not green. This alone fails the merge gate.

**Required fix**

Replace the emoji regex with a lint-safe implementation or otherwise make lint pass without disabling the requirement silently.

---

### P1 — PR is not cleanly mergeable into current `main`

**Evidence**

- PR base ref is `1ba30d86be049f159b0d9793d2ff8d02bc4844d9`; current `origin/main` is `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`: `/home/user/workspace/roman_pr_ci_test_evidence.txt`.
- GitHub reports `mergeStateStatus: DIRTY`: `/home/user/workspace/roman_pr_ci_test_evidence.txt`.
- `git merge-tree` shows a conflict in `.env.example` between the Roman flag and the newer community acks flag: `/home/user/workspace/roman_merge_conflict_evidence.txt`.

**Impact**

This cannot be merged cleanly into current mobile `main` without resolving `.env.example` and validating against the updated baseline.

**Required fix**

Rebase/merge current `main`, keep both env flags, rerun the full gate at the rebased head.

---

## Additional correctness findings

### P1 — `useRomanChat` rollback can discard a successfully persisted send

**Evidence**

- `send()` awaits `sendMessage()` first: `src/screens/roman/useRomanChat.ts:157-158`.
- It then performs a separate `listMessages()` refresh in the same `try`: `src/screens/roman/useRomanChat.ts:160-165`.
- The catch rolls back the optimistic user turn for any error from either operation: `src/screens/roman/useRomanChat.ts:169-180`.

**Impact**

If `sendMessage()` succeeds and the backend persists the user/assistant turns, but the follow-up `listMessages()` fails or hits the role-contract mismatch above, the UI removes the user turn and preserves a retry draft. With no real send idempotency, retrying can duplicate the message server-side.

**Required fix**

Separate send success from refresh failure. Once `sendMessage()` succeeds, do not roll back the user turn as if persistence failed. Either append the returned assistant reply locally and retry refresh in the background, or show a refresh error distinct from send failure.

---

### P1/P2 — SSE parser silently skips malformed frames instead of surfacing typed wire errors

**Evidence**

- `parseSseChunks()` catches JSON parse failure and `continue`s: `src/api/romanApi.ts:307-312`.
- Invalid non-error frames are silently ignored unless they parse successfully: `src/api/romanApi.ts:319-320`.
- The test explicitly expects a non-JSON frame to be skipped rather than errored: `src/api/__tests__/romanApi.test.ts:195-200`.

**Impact**

A malformed frame before a later `done` frame is treated as success, which weakens strict wire-drift detection. The brief required malformed/partial SSE handling with typed errors, not silent discard of contract drift.

**Required fix**

Throw/return `RomanWireError` for malformed `data:` frames and invalid chunk shapes, except for explicit SSE comments/heartbeats if the backend contract documents them.

---

### P2 — Hardcoded Roman interrupted-copy bypasses the cited voice constants

**Evidence**

- Builder/report posture says client Roman voice strings live in `romanVoice.ts` and are tested there.
- `RomanMessageBubble` renders hardcoded assistant-side interrupted copy: `This reply was cut short. Send again to continue.` at `src/components/roman/RomanMessageBubble.tsx:42-45`.
- That string is not in `src/components/roman/romanVoice.ts`, so the Roman voice sweep does not cover it.

**Impact**

A user-visible Roman-adjacent string with Roman avatar context bypasses the single audited/cited voice surface.

**Required fix**

Move this copy into `romanVoice.ts` with the same identity-spec citation/testing pattern, or have the backend supply it.

---

### P2 — `featureFlags.ts` change is not the promised one-line additive flag

**Evidence**

- `src/config/featureFlags.ts:128-139` adds an 11-line comment block plus `romanChat: readFlag('EXPO_PUBLIC_FF_ROMAN_CHAT', false)`.
- The brief constrained this file to exactly one additive flag line.

**Impact**

This is not functionally dangerous, but it violates the lane-minimization requirement for the feature flag file.

**Required fix**

Reduce the diff in `featureFlags.ts` to the single `romanChat` flag line unless the reviewer explicitly accepts the expanded comment block.

---

## Checks that passed or were acceptable

- The expected mobile HEAD was verified: `d72c02c7e7c75878b1944a029cf0acfa69d700d7`.
- REST endpoint paths and DTO scalar constraints mostly match the backend for sessions, list, send body `content`, delete, surfaces, cursor, and limit: `growth-project-backend/src/roman/roman.controller.ts:89-156`, `growth-project-backend/src/roman/roman.dto.ts:18-52`, `src/api/romanApi.ts:211-267`, `src/api/romanApi.ts:335-411`. The blocking exceptions are message role and fabricated send idempotency.
- `.strict()` Zod boundaries exist for session, message page, message, stream chunk, and stream error schemas: `src/api/romanApi.ts:78-130`.
- Buffered SSE deviation is documented in code and PR body: `src/api/romanApi.ts:28-43`, `/home/user/workspace/roman_pr_body.txt:68-81`.
- Roman avatar is reused from `src/components/community/RomanAvatar.tsx`; no forked Roman avatar file was found, and Roman surfaces import the community avatar: `/home/user/workspace/roman_lane_avatar_evidence.txt`.
- Flag-off route registration is at navigator level: client route registration is gated at `src/navigation/ClientNavigator.tsx:469-476`, coach route registration is gated at `src/navigation/CoachNavigator.tsx:397-403`.
- Lane containment is clean for source edits: changed files are Roman API/components/screens/navigation/flag/env/tests only, with zero `src/components/community/**` edits and no package dependency changes: `/home/user/workspace/roman_lane_avatar_evidence.txt`.
- R0 grep battery on added lines found no `as any`, `as unknown as`, `@ts-ignore`, `TODO`, `FIXME`, `Coming soon`, empty catch, `.catch(() => undefined)`, `sonnet`, or raw hex colors. Only `placeholder` hits were legitimate React Native `TextInput` props in `RomanComposer`: `/home/user/workspace/roman_grep_local_evidence.txt`.

## Local gate note

Local test/typecheck attempts were blocked by incomplete dependency installation in the audit worktree, but GitHub CI is authoritative here and is already failing at exact PR HEAD.

## Saved evidence files

- `/home/user/workspace/roman_backend_controller_dto_evidence.txt`
- `/home/user/workspace/roman_backend_role_idempotency_evidence.txt`
- `/home/user/workspace/roman_mobile_api_ui_evidence.txt`
- `/home/user/workspace/roman_hook_flag_evidence.txt`
- `/home/user/workspace/roman_pr_ci_test_evidence.txt`
- `/home/user/workspace/roman_pr_body.txt`
- `/home/user/workspace/roman_merge_conflict_evidence.txt`
- `/home/user/workspace/roman_lane_avatar_evidence.txt`
- `/home/user/workspace/roman_grep_local_evidence.txt`
- `/home/user/workspace/roman_p1_added_diff.patch`

