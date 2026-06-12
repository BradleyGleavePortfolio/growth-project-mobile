## Roman P1 — Mobile Chat (client + coach surfaces)

Feature-flagged behind `EXPO_PUBLIC_FF_ROMAN_CHAT` (default **off**). Ships sessions, streaming replies, and typed states with Roman's FACE+VOICE invariant preserved on every surface rendering Roman copy.

### Round 1 combined-audit fixes

**Code audit (F1–F8)**

| ID | Fix |
|----|-----|
| F1 | Role contract hardened: `RomanWireMessageSchema.strict()` with `ROMAN_WIRE_MESSAGE_ROLES = ['user','roman']`; `toUiRole` maps `roman → assistant`; drift tests cover unknown/missing roles. |
| F2 | Removed fabricated `Idempotency-Key` header, its import, and all related claims; test asserts the header is `undefined`. |
| F3 | Emoji lint regex rebuilt as `new RegExp([...].join('|'), 'u')` with the `u` flag and single-element char classes. |
| F5 | `useRomanChat` rollback bug fixed: optimistic message rolls back **only** on send failure, never on a refresh failure; typed `RomanSendOutcome` (`'sent' | 'send-failed' | 'noop'`). |
| F6 | `parseSseChunks` throws a typed `RomanWireError` on non-JSON / malformed frames instead of silently dropping them. |
| F7 | Interrupted-reply copy moved into `romanVoice.ts` as `ROMAN_INTERRUPTED_NOTE`. |
| F8 | `featureFlags.ts`: `romanChat` reduced to a single additive flag line with a one-line doc comment. |

**UX audit (U1–U8)**

| ID | Fix |
|----|-----|
| U1 | Surface- and first-open-aware greeting (`romanGreeting`) with distinct client/coach registers. |
| U2 | Visible 48dp "Send again" retry control with honest failure copy; draft edits clear the prior send error. |
| U3 | Scroll-to-latest on send, receive, keyboard show, and content-size change. |
| U4 | `announceForAccessibility` deduplicated by message id. |
| U5 | Roman-voiced state strings centralised in `romanVoice.ts` (loading-older footer carries the avatar). |
| U6 | User bubble uses `withAlpha(forest)` background + border and `ink` text instead of a solid accent fill; no raw hex in the Roman lane. |
| U7 | Coach- and client-specific entry-row copy. |
| U8 | Composer grows dynamically with a height cap (min 48dp, max = 30% of window height, floor 120dp) then scrolls. |

### Verification

- `npx tsc --noEmit` — **0 errors**.
- `npx eslint src/` — **0 errors** (82 pre-existing warnings, none in the Roman lane).
- `npx jest --runInBand` — **212 suites / 2459 tests, all green**.
- R65 sweep on the diff vs `main` — clean: zero `.catch(() => undefined)`, empty catch, `as any`, `as unknown as`, `@ts-ignore`, TODO/FIXME, "Coming soon", raw hex, or pictograph emoji in added lines (including comments). The two `eslint-disable` comments in the diff are pre-existing in the original PR (`romanApi.test.ts`, `RomanTypingIndicator.tsx`) and were not authored or modified by this round.

### Parity & invariants

- Chat wired in both client `MoreStack` and coach `SettingsStack`.
- FACE+VOICE invariant: every surface rendering Roman copy renders `RomanAvatar` alongside.
- `RomanAvatar` token work in `src/components/community/` was intentionally left untouched (out of the Roman lane); U6's accent-fill concern was addressed within `src/components/roman/**` only.
