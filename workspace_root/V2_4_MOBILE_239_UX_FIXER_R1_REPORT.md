# UX FIXER REPORT — v2-4 mobile #239 R1
Fixes:
  1. AiTriageCard.tsx loading → accessibilityRole=progressbar (P1)
  2. Status union + InboxTriageBanner typed `empty` state (P2)
  3. Typography/spacing tokens applied at 6 sites (P2)

## Detail

### P1 — loading a11y semantics
`src/components/community/AiTriageCard.tsx` — the loading container's
`accessibilityRole="summary"` was changed to `accessibilityRole="progressbar"`
(explicit indeterminate progress). The existing
`accessibilityLabel="AI triage is preparing your inbox summary."` was preserved.
The loading test was strengthened to pin `accessibilityRole === 'progressbar'`.

### P2 — typed state machine missing `empty`
- Added `'empty'` to the `Status` union (`type Status = 'loading' | 'error' | 'empty' | 'ready'`).
- `InboxTriageBanner` in `CoachCommunityInboxScreen.tsx` now derives `status="empty"`
  explicitly when `triage.data?.is_empty === true`, ahead of the `ready` branch.
- The in-card all-zero / missing-data guard is retained as DEFENSIVE validation
  (`status === 'empty' || !triage || triage.is_empty || total === 0`) so a `ready`
  payload with nothing to show can never render a fabricated summary; it is no
  longer the primary state path.
- Added a test that exercises the typed `status="empty"` path with no payload;
  the existing `is_empty`/all-zero defensive tests remain.

### P2 — semantic tokens (typography + micro-layout)
- Imported `typography` from `src/theme/tokens` (alongside existing `spacing`, `radius`).
- `eyebrow` → `...typography.eyebrow`; `title` → `...typography.bodyMd`;
  `bodyText` / `chevron` / `retryLabel` / `categoryLabel` / `categoryCount`
  → `...typography.bodySmall` (with explicit `fontWeight: '600'` retained where the
  original emphasised the value).
- Raw left-rule width `borderLeftWidth: 3` → tokenized local constant
  `ACCENT_RULE_WIDTH = spacing.xs - 1` (on the 4px grid).
- Ad-hoc `headerText` `gap: 2` → `spacing.xs / 2`.
- No new tokens were added to `src/theme/tokens.ts` (existing semantic tokens covered every site).

Local tsc: pass (0 errors)
Local lint: pass (0 errors, warnings only, all pre-existing and outside edited files)
Local jest targeted: PASS (AiTriageCard.test.tsx + coachCommunityInboxAiTriageFlagOff.test.tsx — 15/15)
Local jest full: PASS (2355/2355 tests, 212/212 suites, 5/5 snapshots)
Pushed: 3e4a92899ec8091db49798ff153a50668415ffbe
CI: green — "Typecheck, lint, test" / CI workflow concluded SUCCESS on headRefOid 3e4a928 (run 27404238038). No regression.
R0 grep: CLEAN (no `as any`, no `as unknown as`, no `@ts-ignore`, no TODO/FIXME, no swallowed catch, no raw hex, no pictograph emoji on added lines)
FACE+VOICE: N/A (system-voice card, no Roman attribution — confirmed not added; `Roman` absent from the diff)

FIX COMPLETE: 3e4a92899ec8091db49798ff153a50668415ffbe
