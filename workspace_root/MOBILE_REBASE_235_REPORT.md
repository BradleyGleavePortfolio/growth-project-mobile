# MOBILE REBASE REPORT — PR #235

**Repo:** `BradleyGleavePortfolio/growth-project-mobile`
**PR:** #235
**Branch:** `feature/community-v3-challenges-mobile`
**Worktree:** `/home/user/workspace/tgp/rebase-235`
**Rebaser:** Opus 4.8

---

## SHAs

| | SHA |
|---|---|
| Original HEAD (pre-rebase) | `fdeab27a4d086dbcf53d3c4ff9ceead00d6af086` |
| origin/main base | `74e0ce89d63c865189f4944a328a0964ac36e780` |
| **New HEAD (post-rebase)** | **`c0236b80b0fa223ce102206f1c6bd819f5d0ec32`** |

Original HEAD verified to equal expected SHA before rebase. Rebase replayed 9 commits onto `origin/main`.

---

## Conflict resolution

**Conflicts:** Exactly ONE, as expected — `src/config/featureFlags.ts`. No other conflicts appeared at any step of the 9-commit replay.

**Resolution: UNION.** Kept main's existing rows (including the v2-4 `communityAiTriage` row that main added) AND the PR-235 v3-1 `communityChallenges` row, preserving all section comment headers. The conflict was a clean append-after-append: main's `communityAiTriage` block on HEAD side, PR-235's `communityChallenges` block on the incoming side. Both were retained in order.

Diff of `featureFlags.ts` vs `origin/main` after rebase = ONLY the v3-1 `communityChallenges` block addition (10 lines):

```
+  // ─── Community v3-1 — opt-in challenges ──────────────────────────────────
+  // Cohort challenges with personal-progress logging and a STRICTLY OPT-IN,
+  // cohort-local leaderboard. Defaults OFF UNCONDITIONALLY (not `isDev`): when
+  // false the CommunityChallengeDetail route MUST NOT register and the screen
+  // is dead code at build time. The backend gate (FEATURE_COMMUNITY_CHALLENGES)
+  // is also OFF in prod, so a dev build that flips this on degrades gracefully.
+  //
+  // env: EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES
+  communityChallenges: readFlag('EXPO_PUBLIC_FF_COMMUNITY_CHALLENGES', false),
```

No new commit was created for the resolution — the union was baked into the replayed `community: v3-1 challenge detail screen + flag/nav wiring` commit (`64d9a9e`).

---

## Verification (full)

| Gate | Command | Result |
|---|---|---|
| Install | `npm ci --cache /home/user/workspace/.npm-cache-mobile` | **exit 0** — 1101 packages added |
| Typecheck | `npx tsc --noEmit` | **exit 0** — no errors |
| Lint | `npm run lint` | **exit 0** — 82 warnings, 0 errors (matches baseline; warnings are pre-existing unused-var / exhaustive-deps) |
| Tests | `npx jest --runInBand` | **exit 0** — 218 suites passed, 2400 tests passed, 5 snapshots passed. "Jest did not exit" notice present (D-011 baseline) with exit code 0 → OK |

### R0 grep (diff vs origin/main, added lines only — 3750 added lines)

| Check | Result |
|---|---|
| TODO / FIXME | CLEAN |
| console.log/warn/error/debug/info | CLEAN |
| any-cast (`as any`, `: any`, `<any>`) | CLEAN |
| swallowed/empty catch blocks | CLEAN |
| pictograph / emoji | CLEAN |

---

## Push + CI dispatch

- `git push --force-with-lease origin pr-235:feature/community-v3-challenges-mobile` → **exit 0** (`fdeab27...c0236b8` forced update)
- `gh api -X POST .../actions/workflows/265423898/dispatches -f ref=feature/community-v3-challenges-mobile` → **exit 0**

---

## PR status (`gh pr view 235`)

```json
{
  "headRefOid": "c0236b80b0fa223ce102206f1c6bd819f5d0ec32",
  "mergeable": "MERGEABLE",
  "mergeStateStatus": "UNSTABLE"
}
```

- **headRefOid** matches the new rebased HEAD ✓
- **mergeable = MERGEABLE** — no merge conflicts ✓
- **mergeStateStatus = UNSTABLE** — solely because the freshly-dispatched CI check ("Typecheck, lint, test") is still `pending`. This is not a conflict state. Local full verification already passed all of typecheck/lint/test, so CI is expected to settle to CLEAN once the run completes. No required check is failing.

---

REBASE COMPLETE: c0236b80b0fa223ce102206f1c6bd819f5d0ec32
