# Roman P1 Mobile R1 UX Audit Report

**Repo / PR:** BradleyGleavePortfolio/growth-project-mobile PR #238 (`feat/roman-p1-mobile-chat`)  
**Auditor:** Fresh R1 UX audit  
**Worktree audited:** `/home/user/workspace/tgp/audit-roman-p1-ux`  
**HEAD verified:** `d72c02c7e7c75878b1944a029cf0acfa69d700d7`  
**Verdict:** NEEDS_REVISION

## Summary

The implementation is well-contained behind `EXPO_PUBLIC_FF_ROMAN_CHAT`, reuses the bundled Roman face, and covers several typed states. However, this is a flagship Roman surface and it does not yet meet the personality/UX bar. The highest-risk gaps are: the same returning-user greeting is used for first-open and coach contexts; failed-send copy promises Roman will retry when the app does not retry and there is no explicit retry affordance; and the chat does not implement scroll-to-latest behavior. There are also polish/a11y issues around live announcements, generic state strings, accent fills, raw hex, and dynamic type.

## Findings

### P1 — First-open and coach empty-state voice are not surface-correct

**Evidence**
- `src/components/roman/romanVoice.ts:19-35` defines the empty-chat greeting from §2.2 returning-user copy and returns `Welcome back, ${name}. Everything is in order. Where shall we begin?` for any named user.
- `src/components/roman/romanVoice.ts:29-33` uses `Good day. Everything is in order. Where shall we begin?` when no first name exists, not the §2.1 first-launch self-introduction (`My name is Roman...`).
- `src/screens/roman/RomanChatScreen.tsx:62-76` receives `surface`, but `src/screens/roman/RomanChatScreen.tsx:140-143` passes only `firstName` into `RomanGreeting`; the greeting never varies for `client` vs `coach`.
- `src/components/roman/RomanGreeting.tsx:20-28` has no `surface`, `isFirstOpen`, or `coachName` prop.

**Why this matters**
- The brief explicitly calls for a first-open greeting moment, and the identity spec §2.1 makes Roman's introduction the defining first impression.
- The same copy is also used on the coach surface, so a coach opening Roman gets generic client/returning-user language instead of coach-fit Roman language. This fails the “both surfaces” requirement.

**Fix sketch**
- Extend the chat state to know whether the session was newly created or whether the message history is empty because of first open.
- Add `surface` and a name form into `RomanGreeting`.
- Use §2.1-style copy for first-open client/coach: `Good day. My name is Roman. I will be looking after things here. Whenever you need me, I am present.`
- Use surface-specific returning copy after that: client can keep §2.2; coach should use a coach-register line derived from §2.3, e.g. `Good morning, {coachName}. I am ready. What needs attention?`

---

### P1 — Failed-send UX has no explicit retry affordance and the Roman copy is misleading

**Evidence**
- `src/components/roman/romanVoice.ts:47-52` defines failed-send copy as `That request did not complete. I will try again.`
- `src/screens/roman/useRomanChat.ts:169-182` catches send failure, rolls back the optimistic message, sets `sendError`, and returns `false`; it does not retry automatically.
- `src/screens/roman/RomanChatScreen.tsx:166-172` renders only an avatar and error text for `sendErrorCopy`.
- `src/screens/roman/RomanChatScreen.tsx:175-181` leaves the composer in place, but there is no visible “Retry” control tied to the failed send.
- `src/screens/roman/useRomanChat.ts:189-202` exposes `clearSendError`, but `RomanChatScreen` does not use it, so the failed-send copy can remain stale while the user edits.

**Why this matters**
- Roman says he will try again, but the app waits for the user to press Send again. That violates failure-tone trust: Roman must state the fact and the actual remedy.
- The brief requires a failed-send retry affordance that is visible, not buried.

**Fix sketch**
- Either actually auto-retry once when rendering `ROMAN_ERROR_TRANSIENT`, or change copy to match the real UX.
- Add a visible inline retry button beside the Roman error row: `Try again` / `Send again` with `minHeight: 48`.
- Suggested in-character copy if user action is required: `That request did not complete. Send it once more, and I will try again.`
- Wire `clearSendError` on draft edit or successful send so the error does not linger incorrectly.

---

### P1 — Conversation does not scroll to the latest message on send/receive

**Evidence**
- `src/screens/roman/useRomanChat.ts:49-50` documents messages as “Oldest-first for an inverted FlatList,” but the rendered list is not inverted.
- `src/screens/roman/RomanChatScreen.tsx:145-161` renders `FlatList` without `inverted`, without a `ref`, without `scrollToEnd`, and without `maintainVisibleContentPosition`.
- `src/screens/roman/useRomanChat.ts:155` appends the optimistic user turn to the end of the array, and `src/screens/roman/useRomanChat.ts:163-166` replaces the list after Roman replies, but no screen effect scrolls to those new bottom items.

**Why this matters**
- A chat surface must keep the newest turn visible after send and after Roman responds, especially with the keyboard open. The current code can strand the user above the latest Roman reply.

**Fix sketch**
- Add a `FlatList` ref and call `scrollToEnd({ animated: true })` after optimistic send and after message count changes.
- Also scroll after keyboard show using `Keyboard.addListener` or use `maintainVisibleContentPosition` if the list is inverted.
- Align the implementation and comments: either actually use `inverted` with newest-first data, or keep oldest-first and always scroll to end.

---

### P2 — Incoming Roman messages are not announced as live updates

**Evidence**
- `src/components/roman/RomanTypingIndicator.tsx:66-73` correctly marks the typing row with `accessibilityLiveRegion="polite"`.
- `src/components/roman/RomanMessageBubble.tsx:33-41` renders assistant messages with an accessibility label but no live region or announcement hook.
- `src/screens/roman/RomanChatScreen.tsx:145-161` does not add any equivalent announcement when the `messages` array receives a new assistant turn.

**Why this matters**
- The brief requires a live-region or equivalent for incoming Roman messages. Screen-reader users may hear “Roman is typing” but not hear Roman’s actual reply when it arrives.

**Fix sketch**
- On new assistant message, call `AccessibilityInfo.announceForAccessibility('Roman said: ...')` with dedupe by message id.
- Alternatively add a platform-appropriate live region on the assistant row and test VoiceOver/TalkBack behavior.

---

### P2 — Generic/disembodied in-thread state strings appear on a Roman surface

**Evidence**
- `src/screens/roman/RomanChatScreen.tsx:153-158` renders `Gathering earlier messages.` as a footer note with no Roman face.
- `src/components/roman/RomanMessageBubble.tsx:42-45` renders `This reply was cut short. Send again to continue.` inside the assistant bubble area, beneath Roman’s avatar, but the line is generic system copy rather than Roman-voiced copy.

**Why this matters**
- The brief says generic copy on a Roman surface is a finding, and Roman’s voice must not become disembodied.
- The interrupted-reply note is visually attributed to Roman but does not sound like Roman.

**Fix sketch**
- For older-message loading, either make it non-verbal skeleton UI or render a Roman row with avatar and copy like `I am gathering the earlier messages.`
- For interrupted replies, use a Roman line such as `This reply was interrupted. Send it again, and I will continue.` or style it as an explicit non-Roman system note outside the Roman bubble.

---

### P2 — Accent is used as filled UI, and RomanAvatar introduces raw hex outside tokens

**Evidence**
- `src/components/roman/RomanMessageBubble.tsx:96-105` uses `colors.forest` as a filled user bubble and `colors.bone` text.
- `src/components/roman/RomanComposer.tsx:113-123` uses `colors.forest` and `colors.stone` as filled send-button states.
- `src/components/roman/RomanState.tsx:102-114` uses `colors.forest` as a filled retry button.
- `src/components/community/RomanAvatar.tsx:59-61` declares raw hex constants `#C9A961` and `#1A1A18` inside the component.

**Why this matters**
- Product plan §5.1 says accents should be used sparingly for outlines/text, never as fills.
- The audit brief also calls out “no raw hex” as part of premium polish. Raw component-local color values bypass the token system.

**Fix sketch**
- Move Roman avatar accent/ink into semantic tokens, e.g. `colors.romanAccent` and `colors.ink`.
- Use `bg-elevated` / `colors.cream` style bubbles with subtle borders or accent text rather than filled accent blocks.
- For primary actions, use neutral elevated fills with accent border/text, or explicitly add a design-system CTA exception if the product doctrine is intentionally revised.

---

### P2 — Entry-row copy is generic and not audience-specific

**Evidence**
- `src/screens/client/MoreScreen.tsx:129-134` defines the client entry as label `Roman` and description `Your concierge — ask Roman anything`.
- `src/screens/coach/SettingsScreen.tsx:548-565` renders the coach entry under `Concierge` with the same `Your concierge — ask Roman anything` sublabel.
- `src/screens/coach/SettingsScreen.tsx:556-557` uses accessibility copy `Open a conversation with Roman` / `Opens the Roman concierge chat`, again not coach-specific.

**Why this matters**
- The identity spec says Roman is not “your AI”; he is Roman, shared across client and coach contexts.
- “Ask Roman anything” is broad, generic assistant copy. On the coach surface it does not fit the operational/practice-management register defined by the sample coach contexts.

**Fix sketch**
- Client row: `Roman` / `Open a conversation with Roman`.
- Coach row: `Roman` / `Ask for a brief, a client read, or the next step.`
- Keep the row placement gated exactly as-is, but tune copy per surface.

---

### P2 — Composer growth is capped in a way that can fail dynamic type / long drafting

**Evidence**
- `src/components/roman/RomanComposer.tsx:55-64` enables `multiline`, but `src/components/roman/RomanComposer.tsx:102-112` caps the input at a fixed `maxHeight: 120`.
- `src/components/roman/RomanComposer.tsx:50-52` renders over-cap validation as a single text line above the composer.

**Why this matters**
- The brief calls for composer growth and dynamic type tolerance. A fixed 120dp cap can become cramped with larger font scales and multi-line drafts.

**Fix sketch**
- Track content height and cap relative to viewport/keyboard space, not a fixed 120dp.
- Add `scrollEnabled` only after the composer reaches a dynamic max.
- Test large accessibility font sizes with long drafts and the over-cap line visible.

## Positive notes

- Feature flag default is off, and both route registrations are gated: `src/config/featureFlags.ts:128-139`, `src/navigation/ClientNavigator.tsx:469-477`, `src/navigation/CoachNavigator.tsx:397-403`.
- Roman’s face is present for greeting, assistant bubbles, typing, send-error row, and full error states: `src/components/roman/RomanGreeting.tsx:29-42`, `src/components/roman/RomanMessageBubble.tsx:31-47`, `src/components/roman/RomanTypingIndicator.tsx:66-87`, `src/screens/roman/RomanChatScreen.tsx:166-172`, `src/components/roman/RomanState.tsx:58-79`.
- Reduced-motion typing support exists via `AccessibilityInfo.isReduceMotionEnabled()`: `src/components/roman/RomanTypingIndicator.tsx:31-64`.
- Send and retry controls meet the 48dp target in the chat components: `src/components/roman/RomanComposer.tsx:113-121`, `src/components/roman/RomanState.tsx:102-110`.

## Required revision checklist

1. Add surface-aware and first-open-aware Roman greeting copy.
2. Fix failed-send copy and add a visible retry affordance or true auto-retry.
3. Implement scroll-to-latest on send, receive, and keyboard open.
4. Announce incoming Roman messages for assistive tech.
5. Replace generic in-thread state strings or give them proper Roman face+voice treatment.
6. Remove accent fills/raw hex from the Roman surface or formalize tokenized exceptions.
7. Make entry-row copy client/coach-specific.
8. Test composer growth under large dynamic type.

