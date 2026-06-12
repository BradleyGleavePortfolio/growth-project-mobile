# FIXER BRIEF — v3-1 Mobile #235 doctrine fixer R1

You are a FIXER (not a builder). Author: `Dynasia G <dynasia@trygrowthproject.com>`. Title-only commits. No trailers. Model: Opus 4.8 (Sonnet 4.6 forbidden). Read `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md`, `/home/user/workspace/doctrine/DESIGN_INTELLIGENCE_DOC_PLAINTEXT.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`, `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md` first.

## Operator decision driving this fixer
See `/home/user/workspace/OPERATOR_DECISIONS.md` D-007 + D-009. The "Leaderboard" failure is fixed via allowlist EXTENSION (not rename), because the PR-introduced surface is the same Phase-7C opt-in cohort-local leaderboard concept already sanctioned in the codebase. The `fontWeight: '700'` literals are fixed by downgrade (no allowlist applies).

## PR & repo
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #235 — `feature/community-v3-challenges-mobile`
- HEAD: `c4f657a6b0bc6bc03db046382edc9aa720e78fa4`
- Failing tests (run id 27386628491):
  - `quietLuxuryDoctrine.test.ts` "does not use fontWeight 700 or 800" — offenders: `screens/community/CommunityChallengeDetailScreen.tsx`, `components/community/ChallengeProgressSheet.tsx`
  - `quietLuxuryDoctrine.test.ts` "does not reference Leaderboard in shipped screens" — offenders: `screens/community/CommunityChallengeDetailScreen.tsx`, `screens/community/__tests__/CommunityChallengeDetailScreen.test.tsx`

## Isolated worktree
```bash
mkdir -p /home/user/workspace/tgp/fixer-v3-1-mobile-doctrine
cd /home/user/workspace/tgp/fixer-v3-1-mobile-doctrine
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/235/head:pr-235
git checkout pr-235
git log -1 --format='%H %s'   # must equal c4f657a6...
git config user.email "dynasia@trygrowthproject.com"
git config user.name  "Dynasia G"
```
Use `api_credentials=["github"]` on every `gh`/`git` call. NO `browser_task`. NO `github_mcp_direct`.

## Required fixes — EXACTLY these, no scope expansion

### Fix 1 — fontWeight downgrade (quiet-luxury cap is 600)
- `src/screens/community/CommunityChallengeDetailScreen.tsx:743`
  - Change: `lbRank: { fontSize: 14, fontWeight: '700', minWidth: 24 },`
  - To:     `lbRank: { fontSize: 14, fontWeight: '600', minWidth: 24 },`
- `src/components/community/ChallengeProgressSheet.tsx:457`
  - Change: `celebrateTitle: { flex: 1, fontSize: 17, fontWeight: '700' },`
  - To:     `celebrateTitle: { flex: 1, fontSize: 17, fontWeight: '600' },`

(Visual side-effect: `lbRank` becomes a touch lighter; `celebrateTitle` becomes a touch lighter. Both are still emphasis-readable at 600 with the quiet-luxury typescale. This is intentional — the doctrine caps weight at 600.)

### Fix 2 — Extend `ALLOWLIST_LEADERBOARD_REFERENCE`
In `src/__tests__/quietLuxuryDoctrine.test.ts` around line 31-34, the current allowlist is:
```ts
const ALLOWLIST_LEADERBOARD_REFERENCE: Set<string> = new Set([
  path.join(ROOT, 'screens', 'client', 'LeaderboardScreen.tsx'),
  path.join(ROOT, 'screens', 'client', 'LeaderboardSettingsScreen.tsx'),
]);
```
Extend to:
```ts
// Phase 7C introduces opt-in leaderboard screens. v3-1 extends the same
// opt-in cohort-local concept to community challenges (default OFF, opt-in,
// no trophy/podium chrome, no raw health/financial data). Doctrine-compliant
// by all other rules.
const ALLOWLIST_LEADERBOARD_REFERENCE: Set<string> = new Set([
  path.join(ROOT, 'screens', 'client', 'LeaderboardScreen.tsx'),
  path.join(ROOT, 'screens', 'client', 'LeaderboardSettingsScreen.tsx'),
  path.join(ROOT, 'screens', 'community', 'CommunityChallengeDetailScreen.tsx'),
  path.join(ROOT, 'screens', 'community', '__tests__', 'CommunityChallengeDetailScreen.test.tsx'),
]);
```
**Do NOT delete or weaken any other doctrine rule. Do NOT relax `ALLOWLIST_HEAVY_WEIGHT`. Do NOT modify any other test.**

### Fix 3 — R0 grep battery on added lines (you must re-sweep after edits)
Run inside worktree against the diff vs `origin/main`:
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E '^\+' \
  | grep -nE 'as any|as unknown as|@ts-ignore|@ts-expect-error|TODO|FIXME|Coming soon|catch *\(([^)]*)\) *\{ *\}|catch *\(([^)]*)\) *=> *(undefined|null)|\.catch\(\(\) *=> *(undefined|null)\)' \
  && echo "GREP DIRTY — investigate" || echo "GREP CLEAN"
```
If you find any pre-existing pattern on added lines NOT from your edits, leave it for the auditor to flag (do NOT expand scope). If your two edits introduced any of these patterns, fix them. (They shouldn't.)

### Fix 4 — FACE+VOICE check
This PR does NOT introduce Roman copy (challenges feature is system-voice, not Roman). Confirm by:
```bash
git diff origin/main...HEAD -- 'src/**/*.tsx' | grep -E '^\+' | grep -iE 'roman|hey coach|hey there' | head -20
```
Expected: no Roman-attributed strings. If you find any → STOP and report (do not silently let it through).

## Verify — full test suite (R66)
```bash
npx tsc --noEmit                            # MUST be clean
npm run lint                                # warnings ok, no errors
npx jest --runInBand src/__tests__/quietLuxuryDoctrine.test.ts  # MUST pass all assertions
npx jest --runInBand                        # full suite — MUST be all green
```
If ANY suite fails outside the two assertions you targeted, STOP and report. Do NOT broaden scope to chase other red.

## Commit + push
Use Dynasia's identity. Title-only message, no trailers.
```bash
git add src/screens/community/CommunityChallengeDetailScreen.tsx \
        src/components/community/ChallengeProgressSheet.tsx \
        src/__tests__/quietLuxuryDoctrine.test.ts
git commit -m "fix(community-v3-1-mobile): downgrade fontWeight to quiet-luxury cap + allowlist v3-1 challenge screen for cohort leaderboard family"
git push origin HEAD:feature/community-v3-challenges-mobile
```
Then poll CI:
```bash
sleep 60
gh pr view 235 --repo BradleyGleavePortfolio/growth-project-mobile --json headRefOid,statusCheckRollup
```

## Output
Write a report to `/home/user/workspace/V3_1_MOBILE_235_DOCTRINE_FIXER_REPORT.md`:
```
# FIXER REPORT — v3-1 mobile #235 doctrine R1
Edits:
  1. CommunityChallengeDetailScreen.tsx:743 fontWeight 700→600
  2. ChallengeProgressSheet.tsx:457 fontWeight 700→600
  3. quietLuxuryDoctrine.test.ts ALLOWLIST_LEADERBOARD_REFERENCE extended +2 paths

Local tsc: pass
Local lint: pass (N warnings)
Local jest quietLuxuryDoctrine: PASS
Local jest full: PASS (N/N)

Pushed: <sha>
CI: <green / red + reasoning>

R0 grep battery on added lines: CLEAN | findings
FACE+VOICE invariant: N/A (no Roman copy on added lines)

FIX COMPLETE: <sha>
```
End literally with `FIX COMPLETE: <sha>`.

## Rules of engagement
- R31: builder ≠ auditor ≠ fixer — you are the fixer for this round only.
- R69: ZERO Prisma schema diff (this is mobile; not applicable, confirm).
- R70: fail-fast lane (tsc + lint) before full jest.
- R66: full `npx jest --runInBand` before push.
- NEVER use `browser_task` or `github_mcp_direct`.
- If you discover an issue that exceeds this brief's two assertions, STOP and write a "BLOCKED" note at the bottom of your report — do NOT silently expand scope.
