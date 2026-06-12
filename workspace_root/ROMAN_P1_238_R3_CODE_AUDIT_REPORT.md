# Roman P1 #238 R3 final code audit report

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: `#238`  
Audited HEAD: `55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7`  
Worktree: `/home/user/workspace/tgp/audit-roman-p1-238-r3-code`

## Executive result

Code-dimension audit is clean, but the PR is **not merge-clean** against current `origin/main` due to a real merge conflict in `src/config/featureFlags.ts`. Because the brief asks to confirm merge readiness if clean, this is a blocking finding.

## Repository / PR state verified

- Local HEAD equals required target: `55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7`.
- `gh pr view` reports PR head `55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7` and check `Typecheck, lint, test` = `SUCCESS`.
- `gh pr view` reports `mergeStateStatus: DIRTY`.
- Local merge-tree verification also fails: `git merge-tree --write-tree origin/main HEAD` exits `1` with `CONFLICT (content): Merge conflict in src/config/featureFlags.ts`.

## Prior R2 fixer claims re-verified

- R2 P1 Bradley Law fix is present: `src/components/roman/RomanTypingIndicator.tsx` now catches the reduce-motion query failure as `.catch((err) => { logger.warn('RomanTypingIndicator.reduceMotionQuery', err); })`.
- R2 F2 fix is present: no added-line `Idempotency-Key` / `idempotencyKey` reference appears in PR #238, and `src/api/__tests__/romanApi.test.ts` builds the forbidden header string dynamically for the negative assertion.
- R2 F8 fix is present on the PR branch: `src/config/featureFlags.ts` adds only `romanChat: readFlag('EXPO_PUBLIC_FF_ROMAN_CHAT', false),` on the PR side.
- U6 path/token fix remains present: canonical file exists at `src/components/roman/RomanAvatar.tsx`, the old `src/components/community/RomanAvatar.tsx` path is absent, and `RomanAvatar.tsx` uses `colors.romanAccent` / `colors.romanInk` rather than raw `#C9A961` / `#1A1A18` literals.

## Audit dimensions

### 1. Bradley Law #36 — swallowed catches on added lines

CLEAN. Added catches either rethrow typed errors, map to typed errors, log via `logger.warn`, or throw `RomanWireError`. The prior swallowed `.catch` in `RomanTypingIndicator` is closed. Pre-existing silent catches in navigator unread polling are not newly added by PR #238.

### 2. 50-Failures sweep across added lines

CLEAN for code dimensions reviewed.

- Hidden coupling / schema drift: `romanApi.ts` validates all backend response shapes with strict Zod schemas and maps backend wire role `roman` to UI role `assistant` only after validation.
- Async races / stale updates: `useRomanChat.ts` gates post-await state updates with `active.current`, prevents duplicate sends with `sendingRef`, and rolls back optimistic user turns only when the send itself fails.
- Error swallowing / observability: added error paths either log, throw typed errors, or preserve user-visible retry state.
- Mock pollution: new `romanApi.test.ts` resets API mocks in `beforeEach`; fetch is restored in `afterEach`.
- Snapshot fragility: no snapshot or inline snapshot additions found.
- Deprecated / unsafe API: no added dangerous HTML / `eval` / WebView HTML injection found; chat text is rendered as React Native `Text`.
- Performance: message list is paginated, page size is clamped to backend cap, and the SSE fetch path has a 60s abort timeout.
- Infrastructure / deployment: no dependency or package-lock changes; Roman route and entry rows are feature-gated behind `romanChat`, default false.

### 3. FACE+VOICE invariant — D-012 / D-013

CLEAN. Roman copy render-sites have a RomanAvatar in the same component tree:

- Client entry row: `src/screens/client/MoreScreen.tsx` renders `RomanAvatar` for the Roman row and uses Roman row copy.
- Coach entry row: `src/screens/coach/SettingsScreen.tsx` renders `RomanAvatar` beside the Roman concierge row copy.
- Chat header/state surfaces: `RomanChatScreen`, `RomanGreeting`, `RomanMessageBubble`, `RomanState`, and `RomanTypingIndicator` render RomanAvatar with Roman-voiced strings.
- D-013/U6 canonical lane is preserved: imports point to `src/components/roman/RomanAvatar.tsx` or relative paths inside `components/roman`; no `components/community/RomanAvatar` import remains.

### 4. R0 grep battery on added lines

CLEAN.

- No added-line matches for `TODO`, `FIXME`, `HACK`, `console.log`, `as any`, `as unknown as`, `@ts-ignore`, `Coming soon`, `We're working on it`, `Oops`, `Sorry`, or swallowed `.catch(() => undefined/null)` patterns.
- Pictograph/emoji grep on added lines returned no matches.
- Hex grep on added lines returned only allowed Roman token definitions/comments in `src/theme/tokens.ts` for `romanAccent: '#C9A961'` and `romanInk: '#1A1A18'`.
- Added-line `any` grep returned only natural-language uses of the word `any`, not TypeScript `any` casts.

### 5. R69 schema / generated-code diff

CLEAN. No `.prisma`, `prisma/**`, `_generated/**`, or generated schema files are touched by PR #238.

### 6. U6 RomanAvatar canonical path verification

CLEAN. `src/components/roman/RomanAvatar.tsx` exists, the old community file is removed via rename, and all live imports resolve to the roman lane.

## Test execution note

Local `node_modules/.bin/tsc` and `node_modules/.bin/jest` are absent in this fresh audit worktree, so I did not rerun local TypeScript/Jest. GitHub reports the PR check `Typecheck, lint, test` as successful.

## Ordered finding list

1. **P1 — Merge blocker: PR is dirty against current `origin/main`**  
   **File:** `src/config/featureFlags.ts:141`  
   **Evidence:** `gh pr view` reports `mergeStateStatus: DIRTY`; `git merge-tree --write-tree origin/main HEAD` exits `1` and reports `CONFLICT (content): Merge conflict in src/config/featureFlags.ts`. Current `origin/main` added `communityAiTriage: readFlag('EXPO_PUBLIC_FF_COMMUNITY_AI_TRIAGE', false),` after `communityAcks`, while PR #238 added `romanChat: readFlag('EXPO_PUBLIC_FF_ROMAN_CHAT', false),` at the same location.  
   **Recommended fix:** Rebase or merge current `origin/main` into the PR branch and resolve `src/config/featureFlags.ts` by preserving both false-default flags (`romanChat` and `communityAiTriage`). Then rerun CI and re-check mergeability.

VERDICT: NOT CLEAN
