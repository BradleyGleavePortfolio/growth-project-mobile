# FIXER BRIEF — MWB-4 #237 UX combined fixer R1

FIXER (Opus 4.8 ONLY — Sonnet 4.6 FORBIDDEN). NOT builder. NOT auditor. Fix the 1 P1 + 4 P2 from UX audit. Read `/home/user/workspace/MWB_4_237_R1_UX_AUDIT_REPORT.md` first. Read `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md` for quiet-luxury invariants. Read `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md` and apply all 8 categories of 50 AI Coding Failures sweep.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #237, HEAD `c1120e127403446afe89634242eebc100dde7977`
- Author: `Dynasia G <dynasia@trygrowthproject.com>` (title-only commits, NO trailers)

## Worktree (isolated)
```bash
mkdir -p /home/user/workspace/tgp/fixer-mwb-4-mobile-ux
cd /home/user/workspace/tgp/fixer-mwb-4-mobile-ux
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/237/head:pr-237
git checkout pr-237
git config user.name "Dynasia G"
git config user.email "dynasia@trygrowthproject.com"
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Findings to fix (verbatim per audit)

### P1 — a11y: interactive pills missing live region + missing busy state
- `AutosaveStatusPill.tsx` — non-interactive branch (View) has `accessibilityLiveRegion="polite"` (lines ~217-223). Interactive branch (Pressable, lines ~201-214) does NOT.
- No state exposes `accessibilityState`. Specifically `saving` must expose `busy: true`.
- **Fix**: Add `accessibilityLiveRegion="polite"` to the Pressable branch. Add `accessibilityState={{ busy: status === 'saving' }}` to BOTH branches.

### P2 — `saved` confirmation persistent (must be brief)
- `useAutosave.ts` sets `status='saved'` (line ~238) with no settle transition.
- **Fix**: In `useAutosave.ts`, after setting `status='saved'`, schedule a `setTimeout` (e.g. 2500ms) that transitions back to `idle` IFF current status is still `saved` (use a ref to check, clear timer on unmount/dependency change). Add a test that asserts pill hides after the settle delay.

### P2 — Conflict copy can become stale; copy uses `refreshing` even after refetch
- Current copy: `Edited elsewhere — refreshing`.
- **Fix**: Change to `Edited elsewhere — tap to refresh` (calm, action-oriented, no data-loss language). Update interactive a11y hint to match conflict context: `Tap to reload the latest version` (not generic "Tap to retry syncing now"). Keep calm/non-destructive treatment.

### P2 — Offline copy lacks local-preservation reassurance
- Current: `Offline — will sync`.
- **Fix**: Change to `Offline — saved on device, will sync` (or similarly calm). Must reassure local preservation. NO alarm language. Quiet-luxury palette only.

### P2 — Semantic token invariant
- `AutosaveStatusPill.tsx:155` uses `Colors.offlineBanner` (non-semantic).
- Added test mock file `src/__tests__/coachWorkoutBuilderAutosave.test.tsx:61-72` contains raw hex literals.
- **Fix**: Replace `Colors.offlineBanner` with a semantic token (e.g. `tokens.statusWarningForeground` — pick or add an appropriate semantic token in `src/theme/tokens.ts` if needed). For the test mock raw hex, replace literals with imports from `src/theme/tokens.ts` mocks OR add tokens-aware mocks. NO raw hex on added lines.

## Mandatory checks before commit (R0 hectacorn floor)

1. **R0 grep battery on added lines (incl. comments)**:
   ```bash
   git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | \
     grep -vE '^\+\+\+' | \
     grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}' || echo "CLEAN"
   ```
   Result must be `CLEAN` (no raw hex outside tokens.ts).
2. **R69 (Prisma)**: ZERO Prisma schema diff (mobile PR, should be none).
3. **Bradley Law #36**: ZERO swallowed catches. Every catch must log or re-throw.
4. **FACE+VOICE**: N/A (no Roman copy in autosave surface — confirm).
5. **R70 fail-fast**: `npx jest --listTests | head -5 && npx tsc --noEmit` (<30s).
6. **R66 full suite**: `npx jest --runInBand` — full pass before push.
7. **D-011 carve-out**: Pre-existing React-Query GC leak in unrelated suites IS PRE-EXISTING (NOT a regression). Document any failing tests in your report — confirm leak is identical to baseline (suites listed below).

### Pre-existing React-Query leak suites (D-011 — NOT yours to fix here)
- `src/hooks/useWearablePreference.test.tsx`
- `src/screens/client/wearables/__tests__/cards.test.tsx`
- `src/__tests__/coachLtvDashboard.test.tsx`
- `src/components/coach/ai-budget/__tests__/AIBudgetMount.test.tsx`
- `src/screens/day-one/__tests__/day1OnboardingScreens.test.tsx`

If any of those fail with same leak signature, NOT YOUR REGRESSION. Note in report.

## Push + finish
```bash
git add -A
git commit -m "fix(mwb-4): autosave pill a11y live region + busy state, settle saved→idle, copy refinements (P1+P2)"
git push origin HEAD:<the PR-237 branch>
```
Then report:
```
FIX COMPLETE: <new SHA>
Report at /home/user/workspace/MWB_4_237_UX_FIXER_R1_REPORT.md
```

Report must include: changed files, git diff stats, R0 grep battery output, R66 full-suite result with pre-existing leak signature confirmation, before/after copy for each P2.

## Quality gate
P1+P2 ALL CLOSED. Quiet-luxury invariants preserved. Local CI green (modulo pre-existing leak — must be identical signature). NO regressions on other autosave tests.
