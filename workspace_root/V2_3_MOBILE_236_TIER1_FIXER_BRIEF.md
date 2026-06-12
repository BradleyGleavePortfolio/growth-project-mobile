# FIXER BRIEF — v2-3 Mobile #236 tier-1 TS2352 cast fixer R1

You are a FIXER (not a builder). Author: `Dynasia G <dynasia@trygrowthproject.com>`. Title-only commits. No trailers. Model: Opus 4.8 (Sonnet 4.6 forbidden). Read `/home/user/workspace/doctrine/FIFTY_FAILURES_PLAINTEXT.md` and `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md` first.

## Operator decision driving this fixer
See `/home/user/workspace/OPERATOR_DECISIONS.md` D-008. Thin tier-1 fix only — fix the cast at the indicated site. Do NOT expand scope.

## PR & repo
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #236 — `feature/community-v2-3-...` (verify branch name from `gh pr view 236 --json headRefName`)
- HEAD: `1c0cb3ae2ae437f3dcc218ba70bfccf2156af2ec`
- Failure (run id 27387563542):
```
src/hooks/__tests__/useReducedMotion.test.tsx(46,27): error TS2352:
  Conversion of type '(event: string, cb: (e: boolean) => void) => { remove: jest.Mock<any, any, any>; }'
  to type '{ (eventName: AccessibilityChangeEventName, handler: AccessibilityChangeEventHandler): EmitterSubscription;
            (eventName: "announcementFinished", handler: AccessibilityAnnouncementFinishedEventHandler): EmitterSubscription; }'
  may be a mistake because neither type sufficiently overlaps with the other.
  If this was intentional, convert the expression to 'unknown' first.
```

## Isolated worktree
```bash
mkdir -p /home/user/workspace/tgp/fixer-v2-3-mobile-tier1
cd /home/user/workspace/tgp/fixer-v2-3-mobile-tier1
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/236/head:pr-236
git checkout pr-236
git log -1 --format='%H %s'   # must equal 1c0cb3ae...
git config user.email "dynasia@trygrowthproject.com"
git config user.name  "Dynasia G"
```
Use `api_credentials=["github"]` on every `gh`/`git` call. NO `browser_task`. NO `github_mcp_direct`.

## The fix (EXACTLY one site)

Open `src/hooks/__tests__/useReducedMotion.test.tsx` and inspect line 46. It will look something like:
```ts
AccessibilityInfo.addEventListener = mockAddEventListener as <something>;
```
The TS error says the test-shim signature is incompatible with the overloaded `AccessibilityInfo.addEventListener` type. TS's own error message gives the canonical fix: route via `unknown` first.

**Apply the minimal, idiomatic two-step cast:**
```ts
AccessibilityInfo.addEventListener =
  mockAddEventListener as unknown as typeof AccessibilityInfo.addEventListener;
```

Rationale: This is the recognised escape hatch for test-time mock signature mismatches across overloaded React Native APIs. It does NOT silence a real type error in production code — it only narrows the test-shim assignment. This is acceptable in test files per the 50-Failures doctrine (test infra ≠ shipped code).

**Do NOT introduce `as any`**. Use `as unknown as <specific type>` exactly as written above. The R0 grep battery permits `as unknown as` ONLY when paired with a specific target type (which this is).

## R0 grep battery (post-fix sanity)
```bash
git diff origin/main...HEAD -- 'src/**/*.ts' 'src/**/*.tsx' | grep -E '^\+' \
  | grep -nE 'as any|@ts-ignore|@ts-expect-error|TODO|FIXME|catch *\(([^)]*)\) *\{ *\}|\.catch\(\(\) *=> *(undefined|null)\)' \
  && echo "GREP DIRTY" || echo "GREP CLEAN"
```
Confirm CLEAN (your single `as unknown as typeof X` is not in the forbidden list).

## Verify
```bash
npx tsc --noEmit                                    # MUST pass
npm run lint                                        # warnings ok
npx jest --runInBand src/hooks/__tests__/useReducedMotion.test.tsx
npx jest --runInBand                                # full suite
```

If `npx tsc --noEmit` still fails elsewhere (i.e. there's a SECOND TS error revealed by green-lighting this one), STOP and report — do NOT chase.

## Commit + push
```bash
git add src/hooks/__tests__/useReducedMotion.test.tsx
git commit -m "fix(community-v2-3-mobile): cast mock addEventListener via unknown to satisfy overloaded RN AccessibilityInfo signature"
git push origin HEAD
sleep 60
gh pr view 236 --repo BradleyGleavePortfolio/growth-project-mobile --json headRefOid,statusCheckRollup
```

## Rebase awareness
PR #236 was reported `mergeStateStatus: DIRTY` at start of this session. If `git push` requires rebase against current `origin/main`:
- ATTEMPT a rebase: `git fetch origin main && git rebase origin/main`
- If conflicts touch files OTHER than the one line you edited, STOP and report — that's a v2-3 rebase fixer scope, not this tier-1 brief.
- If only your edited line conflicts trivially, resolve preserving the `as unknown as typeof AccessibilityInfo.addEventListener` form.

## Output
Write `/home/user/workspace/V2_3_MOBILE_236_TIER1_FIXER_REPORT.md`:
```
# FIXER REPORT — v2-3 mobile #236 tier-1 R1
Edit: src/hooks/__tests__/useReducedMotion.test.tsx:46 (added `as unknown as` two-step cast)

Local tsc: pass
Local lint: pass (N warnings)
Local jest useReducedMotion: PASS
Local jest full: PASS (N/N)

Pushed: <sha>
CI: <green / red + reasoning>

R0 grep battery: CLEAN
FIX COMPLETE: <sha>
```

## Rules of engagement
- R31, R66, R70 apply.
- NO `browser_task`, NO `github_mcp_direct`.
- If you find code-quality issues beyond the typecheck failure, leave them for the R2 auditor — do NOT silently expand scope.
