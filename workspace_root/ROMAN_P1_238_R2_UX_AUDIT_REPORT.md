# Roman P1 #238 R2 UX Audit Report

Auditor: Independent UX auditor, read-only.  
Repo: `BradleyGleavePortfolio/growth-project-mobile`  
PR: `#238`  
Audited HEAD: `5ded65c194a1e97c10bad27583f164418cc7f7b5`  
Worktree: `/home/user/workspace/tgp/audit-roman-p1-r2-ux`  
Scope: R2 verification of U1–U8 fixes, Roman face+voice invariant, coach-app wiring, Roman §1.4/§1.6 voice rules, and quiet-luxury invariants on PR changes.

## Executive Summary

Not clean. Most in-chat fixes landed, but two required items do not meet the audit brief:

1. **P0 — U7 / FACE+VOICE violation:** the coach Roman entry row is disembodied. It renders Roman-voiced coach copy but uses `Ionicons` sparkles and contains no `RomanAvatar` in the same component tree.
2. **P1 — U6 not landed:** the audit brief requires the primary `RomanAvatar.tsx` to be tokenized and free of raw hex. There is no `src/components/roman/RomanAvatar.tsx` at HEAD, and the actual Roman avatar imported by the Roman chat stack is still `src/components/community/RomanAvatar.tsx`, which contains `#C9A961` and `#1A1A18`.

No code was modified during this audit.

## Blocking Findings

### P0 — Coach Roman entry row is disembodied

**Requirement:** U7 states the coach app's Roman entry point must have a Roman-voiced row **with RomanAvatar**; absent or disembodied is P0. The standing invariant also says every Roman-voiced string render-site must have `<RomanAvatar/>` in the same component tree.

**Evidence:**
- `src/screens/coach/SettingsScreen.tsx:548-567` gates and renders the coach Roman entry row.
- `src/screens/coach/SettingsScreen.tsx:552-557` renders a `TouchableOpacity` with `accessibilityLabel="Open a conversation with Roman"` and `accessibilityHint="Ask for a brief, a client read, or the next step"`.
- `src/screens/coach/SettingsScreen.tsx:559` renders `<Ionicons name="sparkles-outline" ... />` instead of Roman's face.
- `src/screens/coach/SettingsScreen.tsx:561-564` renders `Roman` plus `Ask for a brief, a client read, or the next step.`
- `src/screens/coach/SettingsScreen.tsx:1-30` imports no `RomanAvatar`, and there is no `RomanAvatar` render in this file.

**Impact:** This directly violates the user's face+voice rule and the explicit U7 audit criterion. The coach row is a Roman-voiced coach entry point without Roman's face.

**Required fix:** Replace the sparkles-only identity treatment with `RomanAvatar` in the same row/component tree as the coach Roman copy.

### P1 — U6 tokenization fix did not land for the actual Roman avatar

**Requirement:** U6 says `RomanAvatar.tsx` must contain no `#C9A961`, `#1A1A18`, or other raw hex, and colors must come through `tokens.colors.*`. The brief also says to verify the right file was edited.

**Evidence:**
- There is no `src/components/roman/RomanAvatar.tsx` at HEAD.
- Roman surfaces import the avatar from `src/components/community/RomanAvatar.tsx`: `src/components/roman/RomanGreeting.tsx:16`, `src/screens/roman/RomanChatScreen.tsx:37`, `src/components/roman/RomanMessageBubble.tsx:16`, `src/components/roman/RomanState.tsx:17`, and `src/components/roman/RomanTypingIndicator.tsx:18`.
- `src/components/community/RomanAvatar.tsx:60` defines `const ROMAN_ACCENT = '#C9A961';`.
- `src/components/community/RomanAvatar.tsx:61` defines `const ROMAN_INK = '#1A1A18';`.
- `src/components/community/RomanAvatar.tsx:100`, `src/components/community/RomanAvatar.tsx:141`, `src/components/community/RomanAvatar.tsx:149` use those raw-hex constants in rendered avatar styles/text.

**Impact:** The added PR lines do not introduce raw hex, but the actual avatar used by the Roman lane still violates the U6 requirement. The required tokenization did not land where the Roman surfaces actually render the avatar.

**Required fix:** Add or move the primary Roman avatar into the Roman component lane and route avatar colors through design tokens, or token-gate the currently imported avatar so it contains no raw hex.

## Fix Verification Table

| Item | Result | Evidence |
|---|---:|---|
| U1 — surface-aware first-open greeting | PASS | Greeting copy is centralized in `src/components/roman/romanVoice.ts:23-31` and `src/components/roman/romanVoice.ts:53-75`. First-open returns the Roman self-introduction at `romanVoice.ts:56-58`; coach returning copy branches at `romanVoice.ts:61-66`; client returning copy branches at `romanVoice.ts:69-74`. First-open state is derived in `src/screens/roman/useRomanChat.ts:111-119`. The empty state renders `RomanGreeting` with `surface`, `isFirstOpen`, and `firstName` at `src/screens/roman/RomanChatScreen.tsx:203-210`. `RomanGreeting` renders `RomanAvatar` with the greeting at `src/components/roman/RomanGreeting.tsx:41-51`. |
| U2 — 48dp retry + §1.6 failure copy | PASS | Failure copy is centralized as `ROMAN_SEND_FAILED` at `src/components/roman/romanVoice.ts:159-160` and uses brief, non-apologetic next-step tone. Send failure rollback and error state are in `src/screens/roman/useRomanChat.ts:181-198`. Draft edits clear send error through `src/screens/roman/RomanChatScreen.tsx:136-143` and `src/screens/roman/useRomanChat.ts:241`. The retry row renders a RomanAvatar plus copy and a `TouchableOpacity` at `src/screens/roman/RomanChatScreen.tsx:239-257`. The retry style has `minHeight: 48` and `minWidth: 48` at `src/screens/roman/RomanChatScreen.tsx:325-334`. |
| U3 — scroll-to-latest on send, receive, keyboard open | PASS | `listRef` and `scrollToLatest` are defined at `src/screens/roman/RomanChatScreen.tsx:89-98`. The messages/sending effect covers send/receive changes at `RomanChatScreen.tsx:100-104`. Keyboard open is handled through `Keyboard.addListener('keyboardDidShow', scrollToLatest)` at `RomanChatScreen.tsx:106-109`. `FlatList` also calls `onContentSizeChange={scrollToLatest}` at `RomanChatScreen.tsx:213-223`. |
| U4 — incoming Roman message announcement, deduped | PASS | `lastAnnouncedId` is defined at `src/screens/roman/RomanChatScreen.tsx:92`. The effect finds the latest assistant message, skips repeat IDs, stores the announced ID, and calls `AccessibilityInfo.announceForAccessibility` at `RomanChatScreen.tsx:111-125`. The prefix is centralized at `src/components/roman/romanVoice.ts:171`. |
| U5 — Roman-voiced state strings | PASS for in-chat states | State copy is centralized in `src/components/roman/romanVoice.ts:82-171`. `RomanGreeting` renders the empty/greeting copy with avatar at `src/components/roman/RomanGreeting.tsx:41-51`. `RomanState` renders unavailable/offline/error copy with avatar at `src/components/roman/RomanState.tsx:60-67`. Loading older renders `ROMAN_LOADING_OLDER` with avatar at `src/screens/roman/RomanChatScreen.tsx:225-229`. Send error renders Roman copy with avatar at `src/screens/roman/RomanChatScreen.tsx:240-244`. Interruption note renders inside the assistant bubble with avatar at `src/components/roman/RomanMessageBubble.tsx:35-46`. |
| U6 — tokens not raw hex in RomanAvatar | FAIL | No `src/components/roman/RomanAvatar.tsx` exists. Roman surfaces import `src/components/community/RomanAvatar.tsx`, which still contains raw hex at `src/components/community/RomanAvatar.tsx:60-61` and uses those constants at `src/components/community/RomanAvatar.tsx:100`, `src/components/community/RomanAvatar.tsx:141`, and `src/components/community/RomanAvatar.tsx:149`. |
| U7 — coach entry-row copy with RomanAvatar | FAIL / P0 | Coach navigation wiring exists at `src/navigation/CoachNavigator.tsx:397-402`, and the coach settings entry row exists at `src/screens/coach/SettingsScreen.tsx:548-567`. However, the row renders sparkles via `Ionicons` at `SettingsScreen.tsx:559` and no `RomanAvatar` anywhere in the component, while rendering Roman coach copy at `SettingsScreen.tsx:561-564`. |
| U8 — composer growth with height cap | PASS | `COMPOSER_MIN_HEIGHT`, `COMPOSER_MAX_HEIGHT_FRACTION`, and `COMPOSER_MAX_HEIGHT_FLOOR` are defined at `src/components/roman/RomanComposer.tsx:34-43`. The max height and clamped input height are computed at `RomanComposer.tsx:67-78`. `onContentSizeChange` updates content height at `RomanComposer.tsx:80-84`, and the input uses dynamic `height` plus `maxHeight` at `RomanComposer.tsx:95-99`. |

## FACE+VOICE Site-by-Site Audit

| Render site | Roman-voiced string(s) | Face present? | Result |
|---|---|---:|---|
| `src/components/roman/RomanGreeting.tsx:41-51` | `romanGreeting(...)`, `ROMAN_GREETING_SUBTITLE` | Yes — `RomanAvatar` at line 41 | PASS |
| `src/components/roman/RomanMessageBubble.tsx:35-46` | Assistant message content, `ROMAN_INTERRUPTED_NOTE` | Yes — `RomanAvatar` at line 35 | PASS |
| `src/components/roman/RomanTypingIndicator.tsx:67-77` | `ROMAN_TYPING_LABEL`, a11y label | Yes — `RomanAvatar` at line 74 | PASS |
| `src/components/roman/RomanState.tsx:58-78` | Unavailable/offline/error title/body | Yes — `RomanAvatar` at line 60 | PASS |
| `src/screens/roman/RomanChatScreen.tsx:225-229` | `ROMAN_LOADING_OLDER` | Yes — `RomanAvatar` at line 226 | PASS |
| `src/screens/roman/RomanChatScreen.tsx:240-244` | `sendErrorCopy` / `ROMAN_SEND_FAILED` / rate-limit copy | Yes — `RomanAvatar` at line 241 | PASS |
| `src/screens/coach/SettingsScreen.tsx:552-567` | Coach Roman entry row: `Roman`, `Ask for a brief, a client read, or the next step.` | No — sparkles icon only | FAIL / P0 |

Note: `src/screens/client/MoreScreen.tsx:129-137` also renders a client Roman entry item with a sparkles icon and no RomanAvatar. I did not treat `Open a conversation with Roman` as Roman-voiced speech; however, if the product interprets every Roman-branded entry row as a face-required Roman surface, the client More row should be updated too.

## Coach-App Roman Wiring Check

- Route registration is present and flag-gated in `src/navigation/CoachNavigator.tsx:397-402`.
- The coach entry point is present and flag-gated in `src/screens/coach/SettingsScreen.tsx:548-567`.
- The coach chat surface is passed into `RomanChatScreen` at `src/navigation/CoachNavigator.tsx:400-401`.
- The coach greeting branch exists in `src/components/roman/romanVoice.ts:61-66`.

Wiring exists, but the entry point fails the required visual identity rule because it is disembodied.

## Roman §1.4 / §1.6 Voice Checks

### §1.4 forbidden moves

The Roman voice strings in `src/components/roman/romanVoice.ts:53-171` avoid the prohibited patterns checked in the brief: no emoji, no `Oops`, no `I'm sorry`, no `Don't worry`, no `No problem`, no hype words, no AI-butler swagger, no startup slang, and no exclamation marks in body copy.

### §1.6 failure tone

Failure copy follows the spec's brief, grounded, non-apologetic pattern:

- `src/components/roman/romanVoice.ts:90` — `That request did not complete. I will try again.`
- `src/components/roman/romanVoice.ts:98-99` — exhausted retry copy gives a next step without apology theatre.
- `src/components/roman/romanVoice.ts:159-160` — send failure copy gives the next action: `Send it once more, and I will try again.`

## Quiet-Luxury Invariants on PR Changes

| Invariant | Result | Evidence |
|---|---:|---|
| No pictograph emoji | PASS | Added-line scan found no pictograph emoji in changed source. Icons are vector icon names, not text emoji. |
| No raw hex outside `src/theme/tokens.ts` | FAIL for required U6 target | Added PR lines do not introduce raw hex, but the active Roman avatar used by these surfaces still contains raw hex at `src/components/community/RomanAvatar.tsx:60-61`. Because U6 explicitly required RomanAvatar tokenization, this is not clean. |
| `fontWeight <= 600` | PASS on changed Roman code | Changed Roman components use weights at or below `600`; composer/send/retry styles do not introduce `700` or `800`. |
| Tap targets >= 48dp | PASS for changed Roman chat controls; acceptable for coach row sizing | Roman retry button has `minHeight: 48` and `minWidth: 48` at `src/screens/roman/RomanChatScreen.tsx:325-334`. Roman composer send button has `minHeight: 48` and `minWidth: 48` at `src/components/roman/RomanComposer.tsx:153-160`. The coach settings row uses vertical padding at `src/screens/coach/settings/styles.ts:82-88`, making the effective row height greater than 48dp. |
| Reduced-motion safe | PASS for new Roman typing animation | `src/components/roman/RomanTypingIndicator.tsx:38-58` checks `AccessibilityInfo.isReduceMotionEnabled()` and avoids animation when reduce motion is enabled. |
| A11y label/role on interactive controls | PASS for changed Roman chat controls and coach row | Coach row has `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint` at `src/screens/coach/SettingsScreen.tsx:552-557`. Roman retry has role/label/state at `src/screens/roman/RomanChatScreen.tsx:246-253`. Composer send button has role/state/label at `src/components/roman/RomanComposer.tsx:108-116`. |

## Required Remediation Before Clean

1. Replace the coach Roman entry row's sparkles-only identity with `RomanAvatar` in the same component tree as the coach Roman copy.
2. Tokenize the actual `RomanAvatar` used by Roman surfaces, or introduce the expected `src/components/roman/RomanAvatar.tsx` and update Roman imports so the primary Roman avatar contains no raw hex.
3. Re-run the face+voice site audit after remediation. If client Roman entry rows are considered Roman-branded voice surfaces, update `src/screens/client/MoreScreen.tsx` to include RomanAvatar as well.

VERDICT: NOT CLEAN
