# UX AUDIT — Community v2-4 AI inbox triage (mobile, PR #239)
VERDICT: NOT CLEAN

## P0 findings
- None.

## P1 findings
- [src/components/community/AiTriageCard.tsx:96] [src/components/community/AiTriageCard.tsx:100] [src/components/community/AiTriageCard.tsx:101] Loading renders with `accessibilityRole="summary"` and a label, but it does not expose `accessibilityRole="progressbar"` or `accessibilityState={{ busy: true }}` as required for the loading state. Concrete fix: mark the loading container as `accessibilityRole="progressbar"` or keep the summary role and add `accessibilityState={{ busy: true }}`.

## P2 findings
- [src/components/community/AiTriageCard.tsx:42] [src/components/community/AiTriageCard.tsx:153] [src/components/community/AiTriageCard.tsx:159] The render-state contract is not the claimed typed `loading | error | empty | ready` contract; `Status` omits `empty` and derives empty inside `ready`. Concrete fix: add `empty` to `Status`, pass it explicitly from `InboxTriageBanner`, and keep the all-zero guard as defensive validation rather than the primary state machine.
- [src/components/community/AiTriageCard.tsx:251] [src/components/community/AiTriageCard.tsx:256] [src/components/community/AiTriageCard.tsx:258] [src/components/community/AiTriageCard.tsx:269] [src/components/community/AiTriageCard.tsx:272] [src/components/community/AiTriageCard.tsx:282] The new card uses raw layout/typography numbers instead of the existing semantic typography/spacing/rule tokens, which violates the “semantic tokens only / no magic numbers” invariant. Concrete fix: import `typography` from `src/theme/tokens.ts`, spread `typography.eyebrow`, `typography.bodySmall`, and an appropriate heading/body token, and replace ad-hoc rule/gap metrics with named tokens or a tokenized local constant.

## P3 (non-blocking)
- [package.json:10] Local Jest verification could not be executed in this worktree because the configured `test` script calls `jest`, but the binary is not installed in the isolated checkout. This is not a code UX blocker, but CI should run `src/components/community/__tests__/AiTriageCard.test.tsx` and `src/screens/community/__tests__/coachCommunityInboxAiTriageFlagOff.test.tsx` before merge.

## Verification of quiet-luxury invariants
- Emoji: none found on added UI lines; added card copy is text-only and the eyebrow is plain `AI triage` [src/components/community/AiTriageCard.tsx:91].
- Raw hex outside tokens: none found on added UI lines; card colors are read from `semanticColors` [src/components/community/AiTriageCard.tsx:104] [src/components/community/AiTriageCard.tsx:105] [src/components/community/AiTriageCard.tsx:125] [src/components/community/AiTriageCard.tsx:126].
- Font weight ≤600: ok; visible card weights are `600` or below [src/components/community/AiTriageCard.tsx:257] [src/components/community/AiTriageCard.tsx:273] [src/components/community/AiTriageCard.tsx:277] [src/components/community/AiTriageCard.tsx:295] [src/components/community/AiTriageCard.tsx:314].
- Tap targets ≥48dp: ok for interactive controls introduced by this card; the collapsible header and retry control both use `minHeight: 48` [src/components/community/AiTriageCard.tsx:265] [src/components/community/AiTriageCard.tsx:286].
- Reduced-motion safe: ok; the card introduces no animation path, only static text and a collapse/expand render toggle [src/components/community/AiTriageCard.tsx:83] [src/components/community/AiTriageCard.tsx:215].
- AI disclosure: present and unambiguous; the visible eyebrow is `AI triage`, and screen-reader labels also begin with AI triage wording [src/components/community/AiTriageCard.tsx:91] [src/components/community/AiTriageCard.tsx:101] [src/components/community/AiTriageCard.tsx:164] [src/components/community/AiTriageCard.tsx:179].
- Token compliance: not clean; colors/radius/spacing mostly use tokens, but raw type and micro-layout numbers remain in the new component [src/components/community/AiTriageCard.tsx:251] [src/components/community/AiTriageCard.tsx:256] [src/components/community/AiTriageCard.tsx:258] [src/components/community/AiTriageCard.tsx:269] [src/components/community/AiTriageCard.tsx:282].

## State coverage
- loading: a11y label exists, no emoji or motion, but loading semantics are broken because the container is `summary` rather than `progressbar`/busy [src/components/community/AiTriageCard.tsx:96] [src/components/community/AiTriageCard.tsx:100] [src/components/community/AiTriageCard.tsx:101].
- error: a11y label and neutral copy are ok, and retry is labelled with disabled state when retrying [src/components/community/AiTriageCard.tsx:121] [src/components/community/AiTriageCard.tsx:122] [src/components/community/AiTriageCard.tsx:130] [src/components/community/AiTriageCard.tsx:139] [src/components/community/AiTriageCard.tsx:140].
- empty: tone is calm and non-celebratory, with an explicit AI label, but it is reached through `status="ready"` rather than a typed `empty` state [src/components/community/AiTriageCard.tsx:141] [src/components/community/__tests__/AiTriageCard.test.tsx:141] [src/components/community/AiTriageCard.tsx:164] [src/components/community/AiTriageCard.tsx:173].
- ready: five buckets are rendered from `TRIAGE_CATEGORIES`, each row gets a bucket-level accessibility label, and the all-five test is present [src/components/community/AiTriageCard.tsx:217] [src/components/community/AiTriageCard.tsx:222] [src/components/community/__tests__/AiTriageCard.test.tsx:169] [src/components/community/__tests__/AiTriageCard.test.tsx:170].

## Roman voice gate
- Roman attribution on this card: NONE EXPECTED — confirmed; the AI card imports no Roman component, uses the `AI triage` eyebrow, and the only `CoachRomanEmptyState` remains the existing inbox empty-state component outside the card [src/components/community/AiTriageCard.tsx:91] [src/screens/community/CoachCommunityInboxScreen.tsx:59] [src/screens/community/CoachCommunityInboxScreen.tsx:302].
- First-person AI copy: none found in the card; copy stays third-person/system-voice with “AI triage is preparing,” “Triage is unavailable,” and “Nothing to triage right now” [src/components/community/AiTriageCard.tsx:101] [src/components/community/AiTriageCard.tsx:131] [src/components/community/AiTriageCard.tsx:173].

## Coach app design parity
- Flag-off path is protected by the module-scope `TRIAGE_ENABLED` gate and the dedicated flag-off test asserts no triage card in populated and empty branches plus no triage hook/network read [src/screens/community/CoachCommunityInboxScreen.tsx:78] [src/screens/community/__tests__/coachCommunityInboxAiTriageFlagOff.test.tsx:140] [src/screens/community/__tests__/coachCommunityInboxAiTriageFlagOff.test.tsx:153] [src/screens/community/__tests__/coachCommunityInboxAiTriageFlagOff.test.tsx:168].
- Placement is correct: the card is mounted in the empty branch above the Roman empty state and as the populated list header [src/screens/community/CoachCommunityInboxScreen.tsx:297] [src/screens/community/CoachCommunityInboxScreen.tsx:302] [src/screens/community/CoachCommunityInboxScreen.tsx:337].

VERDICT: NOT CLEAN
