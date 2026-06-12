# Roman P1 Mobile Chat — Combined Fixer R1 Report

**PR:** #238 — `feat(roman): P1 mobile chat — sessions, streaming replies, typed states (EXPO_PUBLIC_FF_ROMAN_CHAT off)`
**Repo:** BradleyGleavePortfolio/growth-project-mobile
**Branch:** `feat/roman-p1-mobile-chat`
**Original HEAD:** `d72c02c7`
**Final HEAD (after fix + rebase + amend + force-push):** `5ded65c194a1e97c10bad27583f164418cc7f7b5`
**Rebased onto mobile main:** `79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136`
**Author + committer:** `Dynasia G <dynasia@trygrowthproject.com>` (single, title-only commit)
**CI:** GREEN — "Typecheck, lint, test" pass (7m47s) on `5ded65c`

---

## 1. Per-finding fix table

### Code audit findings (F1–F8)

| ID | Finding | Fix applied | File(s) |
|----|---------|-------------|---------|
| **F1** | Role contract from wire (`roman`) not strictly parsed/mapped to UI (`assistant`) | Added `ROMAN_WIRE_MESSAGE_ROLES = ['user','roman']`; `RomanWireMessageSchema` with `.strict()`; `toUiRole` maps `roman → assistant`; `toMessage`/`RomanMessage`/`RomanPage` interfaces; `listMessages` maps every wire row via `toMessage`. Drift tests assert unknown/missing roles reject. | `src/api/romanApi.ts`, `src/api/__tests__/romanApi.test.ts` |
| **F2** | Fabricated `Idempotency-Key` header + claims | Removed the header, its import, and all related claims/comments. Test asserts `opts.headers['Idempotency-Key']` is `undefined`. | `src/api/romanApi.ts`, `src/api/__tests__/romanApi.test.ts` |
| **F3** | Emoji lint regex without `u` flag | Rewrote `EMOJI_RE` as `new RegExp([...single-element char classes...].join('|'), 'u')`. | `src/components/roman/__tests__/romanVoice.test.ts` |
| **F5** | `useRomanChat` rolled back optimistic message on refresh failure (not just send failure) | Introduced typed `RomanSendOutcome` (`'sent' \| 'send-failed' \| 'noop'`); rollback occurs **only** on send failure; on success the local assistant message is appended and a refresh failure does not discard the user's turn. | `src/screens/roman/useRomanChat.ts` |
| **F6** | SSE malformed/non-JSON frame silently dropped | `parseSseChunks` now **throws** a typed `RomanWireError` on non-JSON / malformed frames. Test expects the throw. | `src/api/romanApi.ts`, `src/api/__tests__/romanApi.test.ts` |
| **F7** | Interrupted-reply copy inlined in component | Moved to `romanVoice.ts` as `ROMAN_INTERRUPTED_NOTE`; bubble references the constant. | `src/components/roman/romanVoice.ts`, `src/components/roman/RomanMessageBubble.tsx` |
| **F8** | `featureFlags.ts` `romanChat` block bloated | Reduced to a single additive flag line with a one-line `/** ... */` doc comment: `romanChat: readFlag('EXPO_PUBLIC_FF_ROMAN_CHAT', false)`. | `src/config/featureFlags.ts` |

### UX audit findings (U1–U8)

| ID | Finding | Fix applied | File(s) |
|----|---------|-------------|---------|
| **U1** | Greeting not surface/first-open aware | New `romanGreeting({surface, isFirstOpen, firstName})` with 4 registers (first-open intro both surfaces §2.1; returning named client §2.2; nameless client §2.1; coach §2.3 "Good morning, {name}. I am ready. What needs attention?"). `useRomanChat` exposes `isFirstOpen`; screen passes `surface`/`isFirstOpen`/`firstName`. | `src/components/roman/romanVoice.ts`, `src/components/roman/RomanGreeting.tsx`, `src/screens/roman/RomanChatScreen.tsx`, `src/screens/roman/useRomanChat.ts` |
| **U2** | No visible/honest retry on send failure | Visible "Send again" control, `minHeight: 48` using `withAlpha(forest)` tokens + `radius.lg`; honest `ROMAN_SEND_FAILED` copy; `onChangeDraft` calls `clearSendError`; `onSend` checks `outcome === 'sent'`. | `src/screens/roman/RomanChatScreen.tsx`, `src/components/roman/romanVoice.ts` |
| **U3** | List did not scroll to latest | `listRef` + `scrollToLatest` on `messages.length`, `sending`, `keyboardDidShow`, and `onContentSizeChange`. | `src/screens/roman/RomanChatScreen.tsx` |
| **U4** | Accessibility announcements duplicated | `AccessibilityInfo.announceForAccessibility` deduped via `lastAnnouncedId` ref. | `src/screens/roman/RomanChatScreen.tsx` |
| **U5** | State strings not Roman-voiced / centralised | Roman-voiced `ROMAN_LOADING_OLDER` footer (with avatar) + `sendErrorCopy` use `ROMAN_SEND_FAILED`; strings live in `romanVoice.ts`. | `src/screens/roman/RomanChatScreen.tsx`, `src/components/roman/romanVoice.ts` |
| **U6** | User bubble used solid accent fill / raw hex | User bubble now `withAlpha(colors.forest, 0.08)` bg + `0.35` border, text `colors.ink`. No raw hex in the Roman lane. (RomanAvatar token work in `community/` is out of lane — see §5.) | `src/components/roman/RomanMessageBubble.tsx` |
| **U7** | Entry-row copy generic | Client: "Open a conversation with Roman". Coach: "Ask for a brief, a client read, or the next step." + updated accessibility hint. | `src/screens/client/MoreScreen.tsx`, `src/screens/coach/SettingsScreen.tsx` |
| **U8** | Composer fixed height | Dynamic growth: `useWindowDimensions`, `COMPOSER_MIN_HEIGHT = 48`, `COMPOSER_MAX_HEIGHT_FRACTION = 0.3`, `COMPOSER_MAX_HEIGHT_FLOOR = 120`; `onContentSizeChange` tracks height; `scrollEnabled` after max. | `src/components/roman/RomanComposer.tsx` |

---

## 2. Gate output excerpts

### `npx tsc --noEmit`
```
=== TSC EXIT: 0 ===
```
**0 errors.** (Pre-existing expo-notifications TS1010 was permitted but did not surface.)

### `npx eslint src/`
```
✖ 82 problems (0 errors, 82 warnings)
=== ESLINT EXIT: 0 ===
```
**0 errors, 82 pre-existing warnings.** Confirmed none in the Roman lane (`src/components/roman/**`, `src/screens/roman/**`, `src/api/romanApi*`, `src/config/featureFlags.ts`, `src/screens/client/MoreScreen.tsx`, `src/screens/coach/SettingsScreen.tsx`).

### `npx jest --runInBand`
```
Test Suites: 212 passed, 212 total
Tests:       2459 passed, 2459 total
Snapshots:   5 passed, 5 total
=== JEST EXIT: 0 ===
```
**All green.** Roman suites verified individually: `romanApi.test.ts`, `romanVoice.test.ts`, `romanFlagOff.test.ts`, `romanFaceAndConfirm.test.tsx` — 139 tests pass.

---

## 3. R65 sweep on diff (`origin/main..HEAD`, added lines incl. comments)

Diff: 18 files changed, **2496 insertions(+), 1 deletion(-)**. Scanned 2496 added lines.

| Pattern | Result |
|---------|--------|
| `.catch(() => undefined)` | PASS — none |
| empty catch block | PASS — none |
| `as any` | PASS — none |
| `as unknown as` | PASS — none |
| `@ts-ignore` | PASS — none |
| `TODO` / `FIXME` | PASS — none |
| `"Coming soon"` | PASS — none |
| `sonnet` | PASS — none |
| `.skip` / `.only` / `xit` / `xdescribe` | PASS — none |
| raw hex (`#[0-9A-Fa-f]{3,8}`) | PASS — none in added lines |
| pictograph emoji | PASS — none (strict Misc-Symbols/Emoticons/Transport/Supplemental scan) |
| Co-authored-by / Generated-by / 🤖 in commit msg | PASS — clean, title-only |

**`eslint-disable` note:** Two `eslint-disable` comments appear in the `main..HEAD` diff because the entire PR is new vs `main`:
- `src/api/__tests__/romanApi.test.ts:49` (`@typescript-eslint/no-var-requires`)
- `src/components/roman/RomanTypingIndicator.tsx:80` (`react/no-array-index-key`)

Both are **pre-existing in the original PR HEAD `d72c02c7`** (verified via `git show d72c02c7:<file>`). `RomanTypingIndicator.tsx` is **byte-identical** between `d72c02c7` and `5ded65c` (0 diff lines) — never touched by this round. The romanApi.test.ts comment is **not inside any fixer hunk** (`git diff d72c02c7..HEAD` shows it as unchanged context). Neither was authored or modified by the fixer, so R65 (which targets fixer-authored added lines) is satisfied.

**Non-ASCII review:** all non-ASCII chars in added lines are typographic, not pictographs — `→` (arrows in comments), `─` (box-drawing dividers in comments), `§` (spec references), `–`/`—` (dashes), `…` (ellipsis), `é` (in "clichés"). No emoji-presentation pictographs.

---

## 4. Rebase & push

- Rebased `feat/roman-p1-mobile-chat` onto mobile `main` (`79c0a9b`).
- Conflicts resolved in `.env.example` (kept **both** `EXPO_PUBLIC_FF_COMMUNITY_ACKS=false` from main and `EXPO_PUBLIC_FF_ROMAN_CHAT=false` from PR) and `featureFlags.ts` (kept both flag lines).
- Squashed into a **single, title-only** commit; author + committer both `Dynasia G <dynasia@trygrowthproject.com>`.
- Force-pushed: `+ d72c02c...5ded65c feat/roman-p1-mobile-chat -> feat/roman-p1-mobile-chat (forced update)` via `git push --force-with-lease`.
- Remote HEAD verified: `5ded65c194a1e97c10bad27583f164418cc7f7b5`.

---

## 5. Lane boundary (documented)

U6 also mentioned tokenizing raw hex (`#C9A961` / `#1A1A18`) in `src/components/community/RomanAvatar.tsx`. That file is **out of the allowed Roman lane** (`community/`); the code audit confirmed "zero community edits" as a PASS condition. It was **not edited**. U6's accent-fill concern was addressed entirely within `src/components/roman/**` (the user bubble). FACE+VOICE invariant and client/coach parity are preserved.

---

## 6. PR body update

PR #238 body updated via REST (`gh api --method PATCH repos/.../pulls/238 -F body=@...`, **not** `gh pr edit`). New body length 3135 chars; `updated_at` `2026-06-12T07:13:47Z`.

---

## 7. CI confirmation

```
Typecheck, lint, test    pass    7m47s
run 27400725498  head_sha 5ded65c194a1e97c10bad27583f164418cc7f7b5
steps: Install deps ✓  Validate app config ✓  Lint ✓  Typecheck ✓  Test ✓
```
**CI GREEN.**

---

## Final SHA: `5ded65c194a1e97c10bad27583f164418cc7f7b5`
