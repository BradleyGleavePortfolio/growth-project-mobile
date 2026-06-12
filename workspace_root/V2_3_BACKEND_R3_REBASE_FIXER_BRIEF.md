# FIXER BRIEF — V2-3 BACKEND (PR #389) — R3 REBASE FIX

## Role and stakes

You are an Opus 4.8 **fixer** — not a builder, auditor, or original PR author. You are resolving ONE explicit R3 finding (P1) and re-running the full gate. Do NOT introduce new logic, refactor, or "improve" anything outside the conflict resolution. **R31 separation of duties** is in force.

PR #389 (`feature/community-v2-events`, backend) was R3-audited at `a3ec919782ded8f30b7987562c27bd68a7274553`. Verdict was **DIRTY** with a single P1: the branch does not merge cleanly into `origin/main` because `src/community/community.module.ts` conflicts. The audit reasoning is sound; the RSVP fix that landed in R2 is correct; CI is green AT the PR head. The blocker is purely mergeability against moved main.

**NOTE — main has moved AGAIN since the R3 audit**: backend main is now `5e5d3b1127a3` (after PR #390 v3-1 challenges merged). The conflict may now include challenge-module imports too. Rebase against `origin/main` as it stands when you run, not against any historical SHA.

## Required reading (no skim)

1. `/tmp/tgp-agent-context/handoffs/COMMUNITY_V2-3_BACKEND_R3_AUDIT_REPORT.md` — the one finding.
2. `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md` — the canonical fixer template (Bradley Law, §36 absolutism).
3. `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md` — for the regression sweep at the end.

## Setup

- Tooling: `bash` + `gh` with `api_credentials=["github"]`. **NEVER use browser tools or `github_mcp_direct`.**
- Clone fresh to `/home/user/workspace/tgp/fixer-v2-3-backend-rebase`. Don't reuse stale worktrees.
- Verify HEAD at start: `gh pr view 389 --repo BradleyGleavePortfolio/growth-project-backend --json headRefOid` should show `a3ec9197...` (or whatever the latest PR HEAD is — if it has moved, abort and report).

## The fix (single finding)

**P1 — rebase onto moved `origin/main` and resolve `src/community/community.module.ts`**

1. Fetch latest: `git fetch origin main`. Record current `origin/main` SHA.
2. Rebase the PR branch onto `origin/main`. Conflict will land in `src/community/community.module.ts`.
3. Resolve the conflict by **combining** both sets of imports and registrations:
   - **Keep ALL of main's adds**: `AckModule` import + `imports: [AckModule, ...]` (v2-2), plus any `CommunityChallenges*` imports + `controllers`/`providers` registrations + `CommunityChallengesEnabledGuard` (from #390 v3-1).
   - **Keep ALL of the PR's adds**: `CommunityEventsController`, `CommunityEventsService`, `CommunityEventsRepository`, `CommunityEventsScheduler`, `CommunityEventsEnabledGuard` imports + registrations.
   - Module order should follow main's alphabetical/grouping convention if present; otherwise alphabetize by symbol.
   - Do NOT drop any provider, controller, or guard from either side. If you're not 100% sure both sides' entries are preserved, stop and re-inspect both file versions.
4. Verify the merged file by reading both:
   - Pre-rebase main: `gh api "repos/BradleyGleavePortfolio/growth-project-backend/contents/src/community/community.module.ts?ref=<main-sha-at-rebase>"` → decode base64.
   - Pre-rebase PR head: same with `ref=a3ec9197` (or current PR HEAD).
   - The resolved file must contain the UNION of both sides' module-registration content.

## Gates (RUN ALL — R66/R70)

After resolution, in the worktree:

1. **Typecheck**: `npx tsc --noEmit` — 0 errors expected.
2. **Lint**: `npx eslint src/ test/` — 0 errors expected (warnings OK if pre-existing).
3. **Tests**: `npx jest --runInBand --testPathPatterns "community|events|module-graph|openapi"` — all green.
4. **Full fail-fast lane** (R70): `npx jest --runInBand --testPathPatterns "module-graph|openapi-spec|roles-enforced"` < 30s — module wiring sanity check.
5. **Optional full suite**: `npx jest --runInBand` if the above is green and quick enough.
6. **R69 schema invariant**: `git diff origin/main -- prisma/schema.prisma` must be EMPTY.

If ANY of the above fails, fix the regression you introduced in the rebase (NOT in the broader code). If you cannot resolve, stop and report DIRTY.

## R65 50-Failures sweep on the rebase diff

Run the sweep on `git diff origin/main..HEAD`:

- **#36 silent failure**: grep diff for `.catch(() => undefined)`, `catch(e) {}`, `catch(e) { console.log` — must be ZERO in new lines (Bradley Law).
- **#1–13 security**, **#14–20 architecture**, **#28–32 concurrency**, **#33–37 error handling**, **#44–47 data integrity**: spot-check the resolved `community.module.ts` registrations didn't accidentally drop a guard, reorder providers in a way that changes injection order, or drop a `forFeature` entry.
- **R0 grep battery on added lines**: `as any`, `as unknown as`, `@ts-ignore`, TODO/FIXME, "Coming soon", empty `.catch`, pictograph emoji — ZERO in any line you added.

## Push and PR body

- Commit messages: title-only, no body, no Co-authored-by / no Generated-by trailers.
- Author: `Dynasia G <dynasia@trygrowthproject.com>`. Verify with `git log -1 --format='%an <%ae>'`.
- Force-push the rebased branch: `git push --force-with-lease origin feature/community-v2-events`.
- Update PR #389 body via `gh api PATCH /repos/BradleyGleavePortfolio/growth-project-backend/pulls/389` with a note: "R3 rebase fix: resolved community.module.ts conflict against main <new-sha>; combined AckModule + (CommunityChallenges*) + (CommunityEvents*) registrations. All gates green." Do NOT use `gh pr edit`.

## Report and verdict

Write `/home/user/workspace/V2_3_BACKEND_R3_REBASE_FIXER_REPORT.md` with:
- Pre-rebase HEAD + main SHA, post-rebase HEAD + main SHA.
- Per-finding fix table (one row): file:line evidence of the resolved registrations.
- 50-Failures sweep results (one line per category — PASS/FAIL with evidence).
- Gate results (tsc/lint/jest/R69) as actual command output excerpts.
- Confirmation that CI is green at the new HEAD (`gh pr checks 389`).

End your completion message **exactly** as: `FIX COMPLETE: <new-sha>`

## What you must NOT do

- Do NOT modify any file outside `src/community/community.module.ts` for the conflict. If a separate file genuinely needs to change (e.g., test fixture for module-graph), surface it as a finding-extension in your report and proceed minimally.
- Do NOT touch `prisma/schema.prisma` (R69).
- Do NOT add `as unknown as`, `as any`, or eslint-disable. If you need a type assertion, use a precise discriminated narrowing.
- Do NOT silence `.catch` (Bradley Law).
- Do NOT use `gh pr edit` to update the PR body — use REST `gh api PATCH`.
- Do NOT use `github_mcp_direct` or any browser tool.
- Do NOT run the builder steps over again. This is a rebase fixer only.
