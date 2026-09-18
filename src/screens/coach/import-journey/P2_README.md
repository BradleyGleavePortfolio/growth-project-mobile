# P2 — private progress and recovery presentation

## WIP checkpoint — halted 18 September 2026

**Incomplete, independently unreviewed and not release-ready.** Work stopped on
user direction; this branch preserves the current controlled presentation and tests.
Stacked on P1 commit `003a9774083812a465fbc78a99aaba5ca16ccfa5`, not main.
The last completed local run passed 101 focused tests in 7 suites, scoped ESLint
and project typecheck on Node22.13.0. Actual RNWeb evidence completed 91 cases;
it is synthetic and not native/device/screen-reader acceptance. Earlier own-test
failures were corrected before that run; no further test run is authorized here.
A trailing whitespace finding remains in the P1 dictionary-test scoping line.
Next operator: inspect this exact WIP diff and obtain focused independent review
before any repair/integration/publication beyond this draft. No launch clearance.

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
Counts are outside live announcements. Heading and actual phase changes use polite
live regions; background count/status updates never request heading focus.
`focusOnMount` is explicit-entry-only, false by default. Native focus delivery,
VoiceOver/TalkBack order and repeated-announcement behavior remain device holds.
Roman is neutral48 and static; off removes face and first-person completion speech.
There is no new P2 honorific: P1's explicit sir preference behavior remains unchanged.

## Verification and limits

Focused command (one worker):

```sh
npm test -- --runInBand src/screens/coach/import-journey/__tests__
npx --no-install eslint src/screens/coach/import-journey --ext .ts,.tsx
npm run typecheck
```

P1 forbidden-side-effect guards and their negative control are reused. Test-only
supplied-observation traversal is under `__tests__`, never imported by production.
The separate external RNWeb fixture harness has a persistent synthetic/not-connected
label and a checker that exits nonzero on recorded geometry/page/interaction errors;
its deliberate checker-negative-control must exit1. No product CI was changed.

RNWeb screenshots/measurements are actual TSX through a web renderer with injected
theme and zero safe-area insets, not native Yoga/device proof. CSS2x text is not
OS200% font scale. Native layout, real screen readers, device keyboard/safe-area,
landscape/RTL/pseudo-localization and production-provider behavior remain unverified.
Source existence does not fix current production migration or authorize integration.
