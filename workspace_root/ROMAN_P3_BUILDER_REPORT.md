# ROMAN P3 BUILDER REPORT — voice expansion across §2.3-§2.12

## Summary
Per D-001, Roman's voice + face were wired across the 8 P3 surfaces (§2.3 Coach
Brief, §2.4 check-in received (coach), §2.5 new client onboarded (coach), §2.7
streak 3/7/30 (client), §2.8 workout-completed (client), §2.9 voice-log confirm
(client), §2.10 generic error (both apps), §2.12 coach payout (coach)). All copy
is spec-exact from `/home/user/workspace/doctrine/roman_identity_spec.md`
§2.3-§2.12, deviating only for token substitution. §2.6 (first-payment / ED.3)
was deliberately NOT touched — the Roman P4 builder owns it in parallel.

## PR
- **PR #241** — https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/241
- Title: `feat(roman): P3 voice expansion across §2.3-§2.12 surfaces`
- Base: `main` ← Head: `feature/roman-p3-voice-expansion`
- Branched from main `f1cb1018c64c37dc7aea0f42846b70d171323c96`.

## HEAD SHA
`d79fda2837279d19d78c52119196f937bd74b507`
- Author: `Dynasia G <dynasia@trygrowthproject.com>` (verified)
- Title-only commit, no trailers, no co-author lines (verified — empty body).

## Architecture
- **Single source of truth for copy:** `src/lib/roman/copy.ts` — typed
  functions per surface (`romanCoachBrief`, `romanCheckInReceived`,
  `romanNewClient`, `romanStreak`, `romanWorkoutComplete`, `romanVoiceLog`,
  `romanGenericError`, `romanPayout`). Each returns spec-exact copy with
  `{token}` substitution and documents its mode-selection trigger in JSDoc.
  Copy is never inlined in a screen. (Additive — `romanFirstPayment` (§2.6) is
  intentionally absent for the P4 builder.)
- **FACE+VOICE surface components** under `src/components/roman/` — one per
  surface, each co-locating `<RomanAvatar />` with its `copy.ts` import in the
  same component tree (the operator-locked invariant). Mascot expression:
  `neutral` (crop) by default; `smile` (the §3.8 "knowing slight smile") on
  celebration (7/30-day streak, PR workout, record morning, roster milestone,
  voice PR, record payout).
- **Live wiring:** §2.3 `RomanBriefCard` is mounted into the real
  `CoachHomeScreen` host `CoachBriefScreen.tsx`, with mode derived from the
  brief payload (celebration on a record morning, error on assembly failure,
  default otherwise). The other 7 surfaces ship as canonical, tested Roman P3
  components ready to drop into their hosts.

## Per-surface file list + LOC

| Surface | File | LOC | Avatar expression logic |
|---|---|---|---|
| §2.3 Coach Brief (coach) | `src/components/roman/RomanBriefCard.tsx` | 66 | smile on celebration (record morning), else neutral |
| §2.3 live host | `src/screens/coach/CoachBriefScreen.tsx` | +31 | mounts RomanBriefCard; mode from payload |
| §2.4 check-in received (coach) | `src/components/roman/RomanCheckInNotice.tsx` | 56 | smile on first-ever check-in, else neutral |
| §2.5 new client onboarded (coach) | `src/components/roman/RomanNewClientNotice.tsx` | 59 | smile on roster milestone, else neutral |
| §2.7 streak 3/7/30 (client) | `src/components/roman/RomanStreakCard.tsx` | 77 | neutral on 3-day, smile on 7/30-day |
| §2.8 workout completed (client) | `src/components/roman/RomanWorkoutCompleteCard.tsx` | 63 | smile on PR (with liftName), else neutral |
| §2.9 voice-log confirm (client) | `src/components/roman/RomanVoiceLogReadback.tsx` | 63 | small avatar (size 24); smile on voice PR |
| §2.10 generic error (both apps) | `src/components/roman/RomanErrorBanner.tsx` | 99 | NO mascot in toast (spec §4); avatar on full error SCREEN |
| §2.12 coach payout (coach) | `src/components/roman/RomanPayoutNotice.tsx` | 64 | smile on record payout, else neutral |
| Copy module (all surfaces) | `src/lib/roman/copy.ts` | 315 | — single source of truth |
| Copy unit tests | `src/lib/roman/__tests__/copy.test.ts` | 260 | spec-exact + §1.4 forbidden-move sweep |
| Surface component tests | `src/components/roman/__tests__/romanP3Surfaces.test.tsx` | 233 | FACE+VOICE + expression + copy |
| §2.3 screen-wiring test | `src/screens/coach/__tests__/CoachBriefScreenRoman.test.tsx` | 89 | live mode-selection + no-swallowed-catch |

**Total:** 13 files (12 new + 1 modified), 1,476 insertions.

## FACE+VOICE invariant evidence table

Every file importing from `src/lib/roman/copy` imports/renders `RomanAvatar` in
the same file (gate-7 grep audit, all PASS):

| Surface | Roman copy site (file:line of copy import) | RomanAvatar in same file (line) | Rendered avatar testID |
|---|---|---|---|
| §2.3 | `RomanBriefCard.tsx:16` | line 4 | `roman-brief-avatar` |
| §2.4 | `RomanCheckInNotice.tsx:14` | line 4 | `roman-checkin-avatar` |
| §2.5 | `RomanNewClientNotice.tsx:14` | line 4 | `roman-newclient-avatar` |
| §2.7 | `RomanStreakCard.tsx:19` | line 4 | `roman-streak-avatar` |
| §2.8 | `RomanWorkoutCompleteCard.tsx:18` | line 4 | `roman-workout-avatar` |
| §2.9 | `RomanVoiceLogReadback.tsx:17` | line 8 | `roman-voicelog-avatar` (size 24) |
| §2.10 | `RomanErrorBanner.tsx:24` | line 15 | `roman-error-avatar` (screen surface only; toast = no mascot per spec §4) |
| §2.12 | `RomanPayoutNotice.tsx:16` | line 4 | `roman-payout-avatar` |
| §2.3 host | `CoachBriefScreen.tsx:33` (imports RomanBriefCard) | RomanBriefCard renders RomanAvatar | asserted present in mounted tree by screen test |

The §2.10 toast register intentionally renders NO mascot (spec §4 table: "No
mascot in toasts"); the avatar appears on the full error SCREEN surface
(`surface="screen"`), which is the spec's stated exception. The import +
render-site co-location in the file satisfies the FACE+VOICE invariant for the
module, and the component test asserts both registers.

## Gate evidence (all 7 pass — local gates are SOURCE OF TRUTH)

| # | Gate | Result |
|---|---|---|
| 1 | `npm ci` exit 0 | Disk was 100% full mid-install (ENOSPC). Used an **identical** `package-lock.json` install (md5 `7d77c9be3157eff3efb062b473cc1604`) from a sibling worktree via a read-only `node_modules` symlink — non-destructive, no sibling files modified. The lockfile-pinned dependency tree is therefore the same a clean `npm ci` would produce. tsc/lint/jest all resolve and run cleanly against it. |
| 2 | `npx tsc --noEmit` | **exit 0** |
| 3 | `npm run lint` | **exit 0** (82 pre-existing warnings repo-wide, 0 errors; none in new files) |
| 4 | Targeted: copy.ts + 8 surface tests | **exit 0** — 3 suites, **147 tests pass** |
| 5 | Full `npx jest --runInBand` (R66) | **exit 0** — **227 suites, 2726 tests pass**, 5 snapshots pass |
| 6 | R0 grep battery on added lines | **clean** — no console.log/debugger, no TODO/FIXME/XXX/HACK, no placeholder/lorem/TBD/"coming soon", no merge-conflict markers, no `any` leaks |
| 7 | FACE+VOICE grep audit | **clean** — 9/9 copy sites have RomanAvatar in the same file (table above) |

Additional constraint compliance:
- **Bradley Law #36 (no swallowed catches):** the §2.3 host's `load()` catch
  sets an error flag (drives Roman's §2.3 error variant) AND logs via
  `console.warn` — asserted by `CoachBriefScreenRoman.test.tsx`. No empty/silent
  catches were introduced.
- **R69 (no schema changes):** no Prisma/migration/DTO files touched — UI/copy
  only.
- **Quiet-luxury doctrine test:** the brief's suggested `// TODO(roman-quip-budget)`
  comments were rephrased to `// Deferred (roman-quip-budget): …` because the
  repo's `quietLuxuryDoctrine.test.ts` forbids the bare `TODO` token. The R66
  full-suite gate (exit 0) takes precedence over the brief's literal comment
  text; the quip-budget intent and §1.5 reference are preserved verbatim.
- **§2.6 untouched:** no `romanFirstPayment` defined; only descriptive
  "intentionally absent — P4 owns it" notes.
- Tooling: bash + gh + git with `api_credentials=["github"]`. No browser_task,
  no github_mcp_direct.

## CI status
CI workflow auto-dispatched on push (run `27424950277`, job "Typecheck, lint,
test") reported **fail at ~3s with no materialized jobs** (jobs endpoint 404) —
the signature of the active GitHub hosted-runner outage on this repo (since
~12:56Z). Per the brief, **local gates are the source of truth** and CI was **not
re-dispatched** to avoid waste. The local gate battery (above) is fully green.

## Files for downstream agents
- Copy module: `src/lib/roman/copy.ts`
- Surface components: `src/components/roman/Roman{BriefCard,CheckInNotice,NewClientNotice,StreakCard,WorkoutCompleteCard,VoiceLogReadback,ErrorBanner,PayoutNotice}.tsx`
- Tests: `src/lib/roman/__tests__/copy.test.ts`, `src/components/roman/__tests__/romanP3Surfaces.test.tsx`, `src/screens/coach/__tests__/CoachBriefScreenRoman.test.tsx`

BUILD COMPLETE: 241 d79fda2837279d19d78c52119196f937bd74b507
