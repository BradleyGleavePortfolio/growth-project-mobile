# Roman P1 PR #238 — R3 Final UX Audit

Repo: `BradleyGleavePortfolio/growth-project-mobile`  
Worktree: `/home/user/workspace/tgp/audit-roman-p1-238-r3-ux`  
PR head audited: `55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7`  
Role: UX auditor. No code modifications made.

## Prior materials read first

- `/home/user/workspace/ROMAN_P1_238_CODE_FIXER_R2_REPORT.md`
- `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md`
- `/home/user/workspace/doctrine/roman_identity_spec.md`

## Scope inspected

Changed PR files and Roman P1 surfaces:

- `src/screens/roman/RomanChatScreen.tsx`
- `src/screens/roman/useRomanChat.ts`
- `src/components/roman/RomanAvatar.tsx`
- `src/components/roman/RomanComposer.tsx`
- `src/components/roman/RomanGreeting.tsx`
- `src/components/roman/RomanMessageBubble.tsx`
- `src/components/roman/RomanState.tsx`
- `src/components/roman/RomanTypingIndicator.tsx`
- `src/components/roman/romanVoice.ts`
- `src/screens/client/MoreScreen.tsx`
- `src/screens/coach/SettingsScreen.tsx`
- `src/__tests__/quietLuxuryDoctrine.test.ts`
- `src/components/roman/__tests__/romanVoice.test.ts`
- `src/navigation/__tests__/romanFlagOff.test.ts`
- `src/components/community/coach/__tests__/romanFaceAndConfirm.test.tsx`

## Verification notes

- Commit check passed: `git log -1 --format=%H` returned `55fc3b7037ad1cc3d22ed741fbbf45a8b0be5fe7`.
- Static quiet-luxury guard check passed: no `fontWeight: '700'`, `fontWeight: '800'`, placeholder copy, or pictograph emoji in scanned `src/screens` / `src/components` surface files.
- Added-line raw color check passed outside `src/theme/tokens.ts`: no added raw `#hex`, `rgb(...)`, or `rgba(...)` in PR-added component/screen lines.
- Added-line heavy typography check passed: no added `fontWeight: '700'`, `fontWeight: '800'`, or `fontWeight: 'bold'`.
- FACE+VOICE static verification passed for current render-sites: client `MoreScreen`, coach `SettingsScreen`, Roman greeting, state, typing, assistant bubbles, send-error, loading-older row, and header all include `RomanAvatar` in the same component tree.
- Roman voice sweep passed by inspection: client-side Roman copy has no emoji, hype/slang, exclamation spam, "Sorry", "Oops", "Coming soon", or clinical/medical-advice posture.
- Targeted Jest command could not run in this fresh clone because `./node_modules/.bin/jest` is absent. I did not install dependencies because this audit was no-code-change/no-worktree-mutation except for this report. The equivalent static checks above were run directly.

## Findings

### P1-1 — Loading states are visually present but not exposed as loading/busy/progress to assistive tech

**Files / lines**

- `src/screens/roman/RomanChatScreen.tsx:60-67` — `LoadingSkeleton` returns a plain `View` with three skeleton blocks and no `accessibilityRole="progressbar"`, `accessibilityLabel`, or `accessibilityState={{ busy: true }}`.
- `src/screens/roman/RomanChatScreen.tsx:166-170` — the full-screen `phase === 'loading'` branch renders `{header}` plus `<LoadingSkeleton />` only.
- `src/screens/roman/RomanChatScreen.tsx:223-230` — the `loadingOlder` footer renders Roman avatar + text but no progress/busy semantics.
- `src/ui/skeletons/Skeleton.tsx:67-72` — each skeleton block is explicitly hidden from assistive tech via `accessibilityElementsHidden` and `importantForAccessibility="no-hide-descendants"`, so the Roman loading screen currently has no accessible loading announcement.

**Evidence**

The UX brief requires busy/progressbar semantics on loading states. The Roman initial-load state and older-message loading footer are only visual. Screen-reader users do not get an explicit loading state, and the skeleton primitives are hidden from accessibility.

**Fix**

Add an accessible loading container, e.g. `accessibilityRole="progressbar"`, `accessibilityLabel="Loading Roman"`, and/or `accessibilityState={{ busy: true }}` to `LoadingSkeleton` or the loading branch. Add busy/progress semantics to the `loadingOlder` footer, preserving the visible Roman-avatar attribution.

### P1-2 — Error and rollback announcements are not live regions

**Files / lines**

- `src/screens/roman/useRomanChat.ts:182-194` — on send failure, the optimistic user turn is rolled back and `sendError` is set.
- `src/screens/roman/RomanChatScreen.tsx:239-258` — the resulting inline send-error row renders visible copy and a retry button, but the row/text has no `accessibilityLiveRegion`, `accessibilityRole="alert"`, or explicit `AccessibilityInfo.announceForAccessibility` call.
- `src/screens/roman/RomanChatScreen.tsx:175-183` — full-screen unavailable/offline/error phases render `RomanState`.
- `src/components/roman/RomanState.tsx:58-80` — `RomanState` renders error/offline/unavailable copy and retry controls without live-region or alert semantics.

**Evidence**

The UX brief requires live regions on error/rollback announcements. A failed send removes the optimistic message from the visible thread and replaces it with an inline Roman error, but assistive tech is not guaranteed to announce the rollback or remedy. Full-screen error states are likewise static text without live-region/alert semantics.

**Fix**

For send failures, announce the rollback/remedy when `sendError` is set, or mark the inline error row as `accessibilityLiveRegion="assertive"` with an appropriate label. For full-screen `RomanState` failures, add `accessibilityRole="alert"` and `accessibilityLiveRegion="polite"` or `assertive` depending on severity.

### P1-3 — List/listitem semantics are missing on Roman chat and Roman entry-list surfaces

**Files / lines**

- `src/screens/roman/RomanChatScreen.tsx:213-233` — the message thread uses `FlatList` with `testID="roman-message-list"`, but no `accessibilityRole="list"`.
- `src/components/roman/RomanMessageBubble.tsx:33-49` and `src/components/roman/RomanMessageBubble.tsx:53-60` — assistant and user message rows are plain `View`s, not list items.
- `src/screens/client/MoreScreen.tsx:169-198` — the More menu renders a scrollable list of rows, including the Roman row, without list/listitem semantics.
- `src/screens/coach/SettingsScreen.tsx:554-571` — the coach Roman concierge row is a button row inside a section, but the section/row do not expose list/listitem structure.

**Evidence**

The UX brief explicitly requires list/listitem semantics. Current rows expose button roles where applicable, and labels are mostly present, but the navigational/list structure is not communicated as a list to assistive tech.

**Fix**

Add list semantics without losing button semantics. For chat, set the `FlatList` accessible container to `accessibilityRole="list"` and wrap each message row with `accessibilityRole="listitem"`. For More and Settings sections, expose the row collection as a list and either wrap each pressable in a listitem container or use the platform-supported role strategy that preserves the inner button action.

### P2-1 — Reduced motion is respected by the typing indicator, but not by all Roman motion defaults

**Files / lines**

- `src/screens/roman/RomanChatScreen.tsx:94-98` — `scrollToLatest` always calls `scrollToEnd({ animated: true })`.
- `src/screens/roman/RomanChatScreen.tsx:102-109` — the animated scroll runs when messages change, sending state changes, and the keyboard opens.
- `src/ui/skeletons/Skeleton.tsx:52-60` — skeleton placeholders start an infinite opacity animation with `withRepeat(..., -1, true)` and no reduced-motion gate.
- `src/components/roman/RomanTypingIndicator.tsx:37-67` — the typing indicator does handle `AccessibilityInfo.isReduceMotionEnabled()`, showing the intended pattern for this PR.

**Evidence**

The brief requires reduced-motion support and no jarring animation defaults. RomanTypingIndicator is compliant, but RomanChatScreen auto-scroll and the loading skeleton animation are not gated by the same reduced-motion preference.

**Fix**

Read/cache the platform reduced-motion preference at the screen or shared hook level and pass `animated: !reduceMotion` to `scrollToEnd`. Update the skeleton primitive or Roman loading usage so reduced-motion users receive static placeholders instead of an infinite pulse.

## Clean dimensions

- Quiet-luxury typography: clean on added surfaces; no added 700/800/bold weights found, and `src/__tests__/quietLuxuryDoctrine.test.ts` keeps `ALLOWLIST_HEAVY_WEIGHT` empty.
- FACE+VOICE invariant: clean in current render trees for client entry row, coach entry row, greeting, message bubbles, typing, full-screen states, loading-older footer, send-error row, and header.
- Empty/error copy quality: clean for Roman P1 copy; no "Coming soon", "Sorry", "Oops", pictograph emoji, or "We're working on it" in Roman client-side strings.
- Roman identity: clean for client-side strings; copy is composed, non-clinical, non-hype, and does not position Roman as medical/clinical advice.
- Tokens on added lines: clean outside token definitions; colors are routed through `colors`, `semantic`/theme values, or `withAlpha`.

VERDICT: NOT CLEAN
