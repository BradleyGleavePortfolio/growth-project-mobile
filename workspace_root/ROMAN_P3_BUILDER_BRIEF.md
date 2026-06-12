# BUILDER BRIEF — Roman P3 (voice expansion across §2.3-§2.12)

## Authority
- D-001: P3 = mobile voice expansion across BOTH client + coach apps. §2.3 Coach Brief, §2.4 client check-in received (coach), §2.5 new client onboarded (coach), §2.7 streak (client), §2.8 workout-completed (client), §2.9 voice-log confirm (client), §2.10 generic error (both apps), §2.12 payout (coach).
- Cross-cutting rule (user verbatim): "we need to make sure his voice always appears WITH HIS FACE as well" + "wire him up for COACH SCREENS TOO!"
- FACE+VOICE invariant: every Roman copy render-site MUST have RomanAvatar in the same component tree.
- Roman canonical voice/copy: `/home/user/workspace/doctrine/roman_identity_spec.md` §2.3-§2.12 (verbatim sample copy where given; deviate ONLY for token substitution).

## Worktree
- Path: `/home/user/workspace/tgp/builder-roman-p3`
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- Branch FROM main `f1cb1018c64c37dc7aea0f42846b70d171323c96`: `feature/roman-p3-voice-expansion`
- Setup: clone fresh, `git checkout -b feature/roman-p3-voice-expansion origin/main`. Run `npm ci`.

## Scope (8 surfaces)

For each surface, wire Roman copy + RomanAvatar in same component tree, with default/celebration/error variant logic per spec. Use existing RomanAvatar canonical from `src/components/community/RomanAvatar.tsx` (or re-export).

### §2.3 Coach Brief delivery (coach app) — morning daily ritual
- Locate the coach home/dashboard surface that shows the daily brief on coach app entry.
- Likely files: `src/screens/coach/CoachHomeScreen.tsx`, `src/screens/coach/CoachDashboardScreen.tsx`, or `src/screens/coach/DailyBriefScreen.tsx` (find by grep).
- Add `<RomanAvatar size="md" expression="neutral" />` next to the brief greeting card.
- Copy variants per spec §2.3 (default / celebration on record morning / error). Token: `{coachName}`, `{clientCount}`.

### §2.4 Client check-in submitted (coach app)
- Likely files: `src/screens/coach/CoachCheckinsScreen.tsx`, `src/screens/coach/CoachInboxScreen.tsx`, or coach notifications surface.
- When new check-in arrives (subscribe-to-event or render new entry), show Roman copy + avatar.
- Copy variants per §2.4. Token: `{clientName}`. Mascot: avatar optional — INCLUDE the avatar (per cross-cutting rule).

### §2.5 New client onboarded (coach app)
- Likely files: `src/screens/coach/CoachClientsScreen.tsx` (new client row), or push-notification handler.
- Copy variants per §2.5. Tokens: `{clientName}`, `{clientCount}`.

### §2.7 Streak milestone (client app) — 3/7/30 day
- Likely files: `src/screens/client/StreakScreen.tsx`, `src/components/client/StreakCard.tsx`, or wherever streak is celebrated.
- Copy variants per §2.7. 3-day = default, 7-day = celebration, 30-day = celebration with permitted one-exclamation.
- Mascot expression: `neutral` on 3-day, `slight_smile` on 7-day/30-day (per spec §3.8).

### §2.8 Workout completed (client app)
- Likely files: `src/screens/client/WorkoutCompleteScreen.tsx`, `src/screens/client/workout/WorkoutSummaryScreen.tsx`.
- Copy variants per §2.8. Token: `{liftName}` for PR celebration. Detect PR via prop or hook (if not already wired, derive from session deltas).
- Mascot: `neutral` default, `slight_smile` on PR.

### §2.9 Voice-log confirmation (client app)
- Likely files: `src/screens/client/voice/VoiceLogScreen.tsx`, `src/hooks/useVoiceLog.ts`, or wherever readback renders.
- Copy variants per §2.9. Tokens: `{weight}`, `{reps}`. Keep readback short.
- Mascot: small avatar (`size="sm"`) — per spec "keep UI minimal".

### §2.10 Generic error (BOTH apps)
- Create or extend `src/components/common/RomanErrorBanner.tsx` (or similar).
- Use this in error states across the app — start by wiring it into the existing global error toast/banner.
- Likely existing toast/banner: search for `Toast`, `Snackbar`, `ErrorBanner`, `useError`, etc.
- Copy variants per §2.10. Hard-failure variant on retry exhaustion.
- Mascot: NO mascot in toasts per spec §4 table. EXCEPTION: full error screens DO show avatar. Apply the rule per surface.

### §2.12 Coach payout (coach app)
- Likely files: `src/screens/coach/CoachPayoutsScreen.tsx`, `src/screens/coach/wallet/PayoutHistoryScreen.tsx`, or coach financials surface.
- Copy variants per §2.12. Tokens: `{amount}`, `{bankLast4}`, `{settleDays}`.
- Mascot: avatar optional — INCLUDE.

## Cross-cutting

### Roman copy module
Create `src/lib/roman/copy.ts` (or extend if exists) with typed functions:
```ts
export function romanCoachBrief(args: { coachName: string; clientCount: number; mode: 'default'|'celebration'|'error' }): string
export function romanCheckInReceived(args: { clientName: string; mode: 'default'|'celebration'|'error' }): string
// ...etc for each surface
```
Each function returns spec-exact copy with token substitution. Copy MUST NOT be inlined in screen files — keep a single source of truth.

### Voice mode selection
Each surface decides mode = `default | celebration | error` from local state. Document the trigger in JSDoc on each copy function.

### Quip ceiling
Spec §1.5 says ~1 in 8. P3 does NOT need to globally enforce this — leave a `// TODO(roman-quip-budget)` comment near surfaces with quips. P3 just ships variants per spec.

### FACE+VOICE invariant audit aid
Add a comment like `// FACE+VOICE: <RomanAvatar /> appears at line X` on every Roman copy render-site to ease auditor verification.

## Constraints
- Author: `Dynasia G <dynasia@trygrowthproject.com>`
- Title-only commits, no trailers, no co-author lines.
- Model: Opus 4.8 (you). Sonnet 4.6 FORBIDDEN.
- R0 grep battery on added lines (incl. comments).
- Bradley Law #36 — no swallowed catches.
- R66 full `npx jest --runInBand` exit 0.
- R69 — NO schema changes.
- Use bash + gh + git with api_credentials=["github"]. NO browser_task. NO github_mcp_direct.

## Test plan
- Unit tests for `src/lib/roman/copy.ts` — every function, every mode, asserting exact spec strings.
- Component tests for each surface — RomanAvatar present in tree (FACE+VOICE), correct expression prop, correct copy rendered.
- Snapshot or role tests where useful.

## Verification gates (all must pass before push)
1. `npm ci` exit 0
2. `npx tsc --noEmit` exit 0
3. `npm run lint` exit 0
4. Targeted: copy.ts + 8 surface test files exit 0
5. Full: `npx jest --runInBand` exit 0
6. R0 grep clean
7. Manual FACE+VOICE grep: every `roman` copy import has a sibling `RomanAvatar` import in the same file

## Push + PR
- `git push -u origin feature/roman-p3-voice-expansion`
- `gh pr create --base main --title "feat(roman): P3 voice expansion across §2.3-§2.12 surfaces" --body "..."`
- CI workflow 265423898 auto-dispatches on push. NOTE: There is a current GitHub runner outage on this repo — local gates are source of truth; CI may not run cleanly.

## Report
Write `/home/user/workspace/ROMAN_P3_BUILDER_REPORT.md`:
- PR number + URL
- HEAD SHA
- Per-surface file list + LOC
- FACE+VOICE invariant evidence table (surface → avatar file:line → copy file:line)
- Gate evidence
- `BUILD COMPLETE: <pr_number> <sha>` final line.
