# FIXER REPORT — v2-3 mobile #236 rebase fixer R1

Rebase: origin/main (79c0a9be7f9657c8c7a0d4fa336c2fa6ba359136) ← pr-236 (a295cdf4d2995ae8cb6ed69d42d934975ae99327)
Rebased 13 commits successfully (conflicts on commit 5/13: "community: v2-3 CoachCommunityEventsScreen + flag + nav + env (shared-append)").

Conflicts resolved:
  - .env.example: union — kept BOTH HEAD's `EXPO_PUBLIC_FF_COMMUNITY_ACKS=false` (v2-2) and incoming `EXPO_PUBLIC_FF_COMMUNITY_EVENTS=false` (v2-3). No deletions.
  - src/config/featureFlags.ts: union — kept BOTH `communityAcks` (v2-2 block + docstring) and `communityEvents` (v2-3 block + docstring) declarations. No deletions.

Both conflicts were purely additive flag rows / declarations — clean union, no opposing logic. No BLOCKED escalation required.

Local gates:
  - npx tsc --noEmit: 0 errors
  - npm run lint: 0 errors (82 pre-existing warnings, allowed via --max-warnings=99999)
  - npx jest --runInBand src/hooks/__tests__/useReducedMotion.test.tsx (tier-1 fix): 3/3 PASS
  - npx jest --runInBand (full suite): 216 suites passed, 2395 tests passed, 5 snapshots passed — ALL GREEN

Pushed: a79880745e7e2e33d933c4a09701f7b3559488b8 (force-with-lease, replacing a295cdf)

CI: triggered naturally on force push (no workflow dispatch needed).
  Run 27404481342 — "Typecheck, lint, test" (workflow CI): COMPLETED / SUCCESS
  PR #236: mergeable=MERGEABLE, mergeStateStatus=CLEAN

R0 grep: DIRTY only on two pre-existing, carved-out lines —
  src/hooks/__tests__/useCommunityEvents.test.tsx:158 and :223
  `mutateAsync(...).catch(() => undefined)` — standard React-Query idiom to await a
  deliberately-rejected mutation so the test can assert optimistic-update rollback.
  These are TEST-ONLY and fall under the D-011 carve-out (React-Query leak — pre-existing).
  No production logic flagged. Effectively CLEAN for the rebase scope.

FIX COMPLETE: a79880745e7e2e33d933c4a09701f7b3559488b8
