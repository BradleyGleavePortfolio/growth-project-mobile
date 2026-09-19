# P2 — private progress and recovery presentation

## Bounded repair status — 19 September 2026 UTC

**Implemented and locally tested; fresh independent finding closure pending.**
This is not independent acceptance, merge eligibility or release readiness.
The original WIP remains at `f687ee6f12b702eee1ca6cfa446973a6b49b2aa6`,
stacked on P1 `003a9774083812a465fbc78a99aaba5ca16ccfa5`, not main.

- A82-P2-001: explicit zero in the ordinary unconfirmed result now selects the
  neutral unavailable presentation, suppressing result quantities, the contradictory
  positive-unconfirmed claim and native actions. Positive/missing counts retain
  their existing behavior. No transfer, completion or proven-zero inference.
- A82-P2-002: P2-local iOS queued announcements now cover meaningful heading,
  current-phase and stop-status changes. No imperative initial-entry announcement,
  duplicate unchanged message, count/time-only announcement or background refocus.
- N01–N03: unavailable copy is cause-neutral; placeholder tests enumerate every
  token and assert fully formatted output; the existing trailing space is removed.
- Tested locally: 121 tests / 8 feature suites, scoped ESLint and project typecheck,
  Node 22.13.0 with the unchanged exact lock. Regressions were written first:
  29 failures / 92 passes before implementation. The first post-fix run exposed
  five test-isolation failures from RN preset mock call histories; clearing those
  histories between cases produced the passing run, without weakening assertions.
- Unknown/not run here: real VoiceOver/TalkBack, native layout/builds, external
  RNWeb harness, CI and connected imports. Historical WIP RNWeb results are not
  adopted as repair-head evidence. No integration or publication authorization.

Controlled leaf views only. No production registration, service, storage, provider,
polling, timer, authority cache, IDs, URLs, source-opening, Start, retry or routing.
P2 extends the English dictionary without changing existing P1 text. P1 screens,
shared primitives and interaction tests are preserved; the original P1-only copy
test now scopes its same assertions to its original five dictionary groups.

## Caller contract — display inputs are not proof

`ImportProgressView` accepts explicitly supplied current/stale/unavailable
observations, a current or last-observed phase, receipt count, actual observation
time and stop-not-requested/pending/offline presentation. A current observation
requires an accepted nonterminal run from a future authoritative adapter. Checking
means native mapping/readback, not receipt validation. No phase history is inferred.
The stale headline/body makes retained phase/count/time last-observed information,
not proof that the run is alive. Offline always displays unconfirmed status.

`ImportResultView` distinguishes unconfirmed, unavailable, blocked, interrupted,
failed, timedOut, cancelled, transferOnly, verifiedSubset, complete and provenZero.
These names are local view choices, not proposed wire enums or lifecycle state.
A callback never settles, transitions, persists or confirms any of them.

- Receipt and unconfirmed-client counts are independent quantities. They are never
  added, subtracted, converted to unique clients, coverage or native usability.
- Each displayed quantity must be a nonnegative safe integer. Missing, string,
  negative, fractional, non-finite and unsafe-integer values are omitted, not zero.
  Invalid quantities in proof-bearing views suppress their success claim.
- A native summary requires positive verified client count, the fixed reviewed
  `selectedClientRecords` scope, and separately supplied relationship/readback
  assertions. This UI checks shape/consistency only; **it does not verify them**.
  A future accepted adapter must establish intent attribution, same-account
  authorization, native identity, relationships and actual usable readback.
- Complete additionally requires explicitly supplied complete source coverage,
  verified required families and zero unconfirmed clients. Missing/invalid
  native count, unknown scope or contradictory data yields unavailable, not ready.
  An omitted receipt quantity is still unknown; complete proof must come from
  the independent required authority, never receipt arithmetic.
- Proven zero requires complete coverage of the reviewed scope, checked-source
  count0, receipt count0 and unconfirmed count0, with no native summary. Unknown or
  unreadable source is not zero. It never shows “Your records are ready.”
- Transfer-only requires positive confirmed receipts and explicit zero unconfirmed
  clients; it does not enable native destinations or claim usable records.
- Ordinary unconfirmed plus explicit zero unconfirmed clients is contradictory:
  display unavailable and suppress result quantities, not transfer-only or success.
  Missing count remains unknown; a positive count retains the unconfirmed copy.
- Unavailable hides stale result quantities/native actions rather than relabelling
  them failed. Supplied last-observed timestamp can remain; no render time is used.
- Blocked reasons use only approved local keys (`denied`, `scopeUnknown`, `changed`,
  `unknown`); unknown runtime strings fall back to the approved generic sentence.
  No raw exceptions, arbitrary scope prose, client names or support references.

The initial reviewed scope is deliberately limited to selected client records.
There is no speculative model for other families, whole-account completion,
per-client IDs, retry policy, native routes or future backend contracts.

## Action and accessibility ownership

An optional action requires `enabled: true` **and** a callback; otherwise it is
omitted. Native destination actions additionally require the corresponding
verified-subset/complete presentation. Stop-pending disables the separately
supplied Stop action with visible waiting-for-confirmation copy. Offline/stale
have no Stop action; Check current result is only a read-intent callback. Back and
Return to coaching call the same return callback, never Stop. Future hardware and
gesture integration is host-owned. No callback emits success feedback.

The P2 shell reuses existing P1 action/portrait/focus primitives without refactoring.
Counts and observation times are outside automatic announcements. Android retains
polite heading/phase/stop live regions; RN documents live regions as Android-only
([RN 0.85 View](https://reactnative.dev/docs/0.85/view)).
On iOS, a meaningful message change calls
`AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true })`,
which requests queuing behind existing speech rather than the default interruption
([RN 0.85 AccessibilityInfo](https://reactnative.dev/docs/0.85/accessibilityinfo)).
Progress combines the heading, current phase (or status-unconfirmed explanation)
and any pending/offline Stop explanation into one localized message. Retained
stale phases are excluded. Results announce heading changes only.
Consecutive identical messages and all initial mounts are skipped by the iOS
announcement path, leaving explicit-entry focus to the existing primitive.
`focusOnMount` is explicit-entry-only, false by default; toggling it on a mounted
view does not request focus. Background status/count updates never request focus.
Mocked tests prove request policy, not native speech delivery, ordering, timing,
interruption behavior or duplicate-free device output; these remain device holds.
Roman is neutral48 and static; off removes face and first-person completion speech.
There is no new P2 honorific: P1's explicit sir preference behavior remains unchanged.

## Verification and limits

Executed repair commands (Jest single-worker; checks serialize with the shared
heavy-validation lock; 4096 MB heap):

```sh
export PATH=/home/user/.npm/_npx/1bd81ab945294a66/node_modules/node/bin:$PATH
export NODE_OPTIONS=--max-old-space-size=4096
flock /home/user/workspace/agent82/heavy-validation.lock npm test -- --runInBand src/screens/coach/import-journey/__tests__
flock /home/user/workspace/agent82/heavy-validation.lock node node_modules/eslint/bin/eslint.js src/screens/coach/import-journey --ext .ts,.tsx
flock /home/user/workspace/agent82/heavy-validation.lock npm run typecheck
```

P1 forbidden-side-effect guards and their negative control are reused. Test-only
supplied-observation traversal is under `__tests__`, never imported by production.
New tests cover direct zero and 22-to-zero rerenders, iOS change/deduplication/
initial-entry policy, Android/web non-duplication, proof-shape/action rejection and
unknown runtime phases/outcomes. No product CI was changed.

RNWeb screenshots/measurements are actual TSX through a web renderer with injected
theme and zero safe-area insets, not native Yoga/device proof. CSS2x text is not
OS200% font scale. Native layout, real screen readers, device keyboard/safe-area,
landscape/RTL/pseudo-localization and production-provider behavior remain unverified.
Native acceptance still needs iOS/Android 320/375/430-class widths, OS200% text,
landscape/notched safe areas, dark/RTL/expanded copy, long headings and maximum
safe-integer counts, final-action reachability, focus order, hardware/gesture return,
and real VoiceOver/TalkBack delivery/queue/duplicate checks.
Source existence does not fix current production migration or authorize integration.
