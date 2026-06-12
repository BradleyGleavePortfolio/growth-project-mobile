# AUDITOR BRIEF — MWB-4 #237 R1 CODE audit

Independent CODE AUDITOR (GPT-5.5, fresh, NOT builder/fixer). Read `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md`, `/tmp/tgp-agent-context/rules/R0_DECACORN_QUALITY.md`, `/tmp/tgp-agent-context/rules/R65_50_FAILURES_SWEEP.md`, `/tmp/tgp-agent-context/specs/AUDITOR_BRIEF_COMMON.md`, `/tmp/tgp-agent-context/specs/MASTER_WORKOUT_BUILDER_SPEC.md` (for MWB feature surface context).

Also read `/home/user/workspace/MWB_4_MOBILE_TIER1_FIXER_REPORT.md` (the tier-1 fixer's notes) and `/home/user/workspace/OPERATOR_DECISIONS.md` D-011 (the operator's call on the pre-existing React-Query GC leak: NOT a blocker for this PR's audit).

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #237 — `feature/mwb-4-mobile-autosave` (Master Workout Builder phase 4 — autosave with offline mirror + 409 conflict resolution)
- HEAD: `c1120e127403446afe89634242eebc100dde7977` (post tier-1 test fix)
- Mobile main: `79c0a9be` (rebased)
- CI status: `Typecheck, lint, test` shows FAILURE — BUT all 2370 tests pass; failure is from a PRE-EXISTING React-Query GC open-handle leak in 5 unrelated test files (proven by original run 27383882280 at HEAD 77cd3b4a, BEFORE this PR existed). Per operator decision D-011, this is NOT a blocker for this PR.

## Worktree
```bash
mkdir -p /home/user/workspace/tgp/audit-mwb-4-r1-code
cd /home/user/workspace/tgp/audit-mwb-4-r1-code
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/237/head:pr-237
git checkout pr-237
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Severity + merge bar
Standard P0+P1+P2 CLEAN. P3 informational.

## Special instruction — pre-existing leak boundary
The "Jest did not exit one second after the test run has completed" CI failure is NOT this PR's responsibility (per D-011). DO NOT flag this as a P0/P1/P2 finding. You MAY flag it as P3 informational with a note that a separate test-infra sweep PR will address it (`forceExit` global mask was REJECTED — Path B surgical fix forthcoming).

If the PR's added lines themselves introduce new open handles (e.g. timers without cleanup), that IS in scope — flag those.

## Focus areas for this audit
This PR implements autosave with offline mirroring + 409 conflict resolution. Apply 50-Failures categories particularly carefully:

- **#3 N+1 / hot path** — autosave fires on every keystroke debounce; ensure debounce is correctly applied, no N+1 server writes.
- **#8 input validation** — Zod validation of the wire payload + 409 conflict response.
- **#12 idempotency** — autosave PATCH must be idempotent (replay-safe).
- **#16 races / #28 race conditions** — concurrent autosave + offline-mirror sync + 409 fast-forward.
- **#17 transactions** — N/A mobile, but verify the offline mirror is updated atomically (single write or rollback).
- **#19 retry + backoff** — confirm retry policy on transient failures.
- **#20 dedupe** — ULID/keying to prevent duplicate saves on flaky network.
- **#28 race conditions** — what happens if a 409 lands while a SECOND autosave is in flight? Verify the screen state stays consistent.
- **#29 abort signals** — autosave network requests should cancel on screen unmount.
- **#30 optimistic-rollback** — failure must NOT discard user edits; only roll back the server-state assumption.
- **#36 Bradley Law** — ZERO swallowed errors on added lines.
- **#41 missing tests on critical branch** — verify 409 conflict + offline-then-online sync + AppState background-flush all have tests.

## R0 grep battery + R69
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E '^\+' \
  | grep -nE 'as any|as unknown as|@ts-ignore|@ts-expect-error|TODO|FIXME|Coming soon|catch *\(([^)]*)\) *\{ *\}|\.catch\(\(\) *=> *(undefined|null)\)' \
  && echo "GREP DIRTY" || echo "GREP CLEAN"
git diff origin/main...HEAD -- '**/*.prisma' && echo "SCHEMA TOUCHED" || echo "SCHEMA CLEAN"
```

## Re-run gates yourself
```bash
npx tsc --noEmit
npm run lint
npx jest --runInBand --testPathPattern "useAutosave|coachWorkoutBuilderAutosave"
# Full suite (will exit-1 due to pre-existing leak — but inspect that tests all pass):
npx jest --runInBand 2>&1 | tee /tmp/full-jest.log
grep -E "Test Suites:|Tests:" /tmp/full-jest.log
```

## Output
Write `/home/user/workspace/MWB_4_237_R1_CODE_AUDIT_REPORT.md` in standard auditor format. Note the pre-existing leak as P3 informational. End with literal `VERDICT: CLEAN | NOT CLEAN`. Do NOT modify code.
