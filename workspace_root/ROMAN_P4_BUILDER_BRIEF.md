# BUILDER BRIEF — Roman P4 (ED.3 First Payment Wow + ED.4 Progress Chart animation)

## Authority
- D-001: Roman P4 = mobile ED.3 + ED.4 showpieces.
  - **ED.3** = First Payment Wow Screen (coach app — particle burst, MMKV once-only gate, Supabase realtime trigger, mascot "knowing slight smile").
  - **ED.4** = Progress Chart animation (client app — Victory Native XL draw-in + haptic scrubber + auto-PR flag detection + Roman commentary on PR detection).
- Roman canonical: `/home/user/workspace/doctrine/roman_identity_spec.md` §2.6 (First payment) — full warmth, celebration variant carries the one permitted exclamation.
- FACE+VOICE invariant: every Roman copy render-site MUST have RomanAvatar in same tree.

## Worktree
- Path: `/home/user/workspace/tgp/builder-roman-p4`
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- Branch FROM main `f1cb1018c64c37dc7aea0f42846b70d171323c96`: `feature/roman-p4-ed3-ed4-showpieces`
- Setup: clone fresh, `git checkout -b feature/roman-p4-ed3-ed4-showpieces origin/main`. Run `npm ci`.

## ED.3 — First Payment Wow Screen (coach app)

### Surface
- Create `src/screens/coach/ed/FirstPaymentWowScreen.tsx`. This is a full-screen modal/sheet that overlays when the first payment fires.

### Trigger
- Supabase realtime channel subscription on a coach's `payments` table (or equivalent). Listen for `INSERT` events where this is the coach's FIRST payment.
- "First" = check MMKV key `roman.ed3.first-payment-seen.${coachId}`. If unset, show + set on dismiss.
- MMKV provider: use existing app MMKV setup (likely `react-native-mmkv` via `src/lib/storage/mmkv.ts` — find by grep). If absent, use the repo's existing storage abstraction.

### Animation
- **Particle burst**: use `react-native-reanimated` worklets — 20-40 particles emanating from screen center, each with random angle/distance/duration/easing, fade out at edges. Reuse Skia or Reanimated 3 patterns. If `@shopify/react-native-skia` is in deps, prefer Skia for performance. Otherwise pure Reanimated.
- **Mascot**: `<RomanAvatar size="xl" expression="slight_smile" />` centered, with subtle scale-in (1.0 → 1.05 → 1.0) over 1.2s using Reanimated spring.

### Copy (spec §2.6)
- Default: `"{coachName}, your first payment has arrived: {amount} from {clientName}. This is the part where the work becomes a living. Well earned."`
- Celebration (use this on ED.3 — it's THE moment): `"{coachName} — your first payment has arrived. {amount}, from {clientName}. I have seen a great many first payments, and they never stop meaning something. Congratulations!"`
- Error variant per spec.

### Dismiss / gate
- Single "Continue" button (Roman-tone label: `"I understand"` or `"Thank you, Roman"`).
- On dismiss: set MMKV key, navigate back to coach home.
- Once-only enforcement — re-opens NEVER trigger this screen again for the same coachId.

### Realtime
- Use the existing Supabase client in the repo (likely `src/api/supabase.ts` or similar). Add a subscription channel in `src/screens/coach/CoachAppShell.tsx` or top-level coach layout that listens for the INSERT and navigates to ED.3.

## ED.4 — Progress Chart animation (client app)

### Surface
- Locate or create the client progress chart screen — likely `src/screens/client/progress/ProgressChartScreen.tsx` (find by grep).

### Library
- Use **Victory Native XL** (`victory-native`) if already in deps. Verify via `package.json`. If not, prefer falling back to existing chart library (read repo to pick). Do NOT add a heavyweight new chart dep without justification — note in report if a swap is needed.

### Features
- **Draw-in animation**: chart line draws from left to right over ~1.5s on mount using path interpolation. Use Victory Native XL's animate prop or Skia path interpolation.
- **Haptic scrubber**: when user drags a tracking dot along the chart line, fire `Haptics.selectionAsync()` (or `expo-haptics` equivalent) on each data-point crossover.
- **Auto-PR flag detection**: when chart contains a personal-record data point (use repo's existing PR detection logic; if absent, derive from `Math.max` over historical values), render a small flag/star icon at that point with a glow ring.
- **Roman commentary on PR detection**: when chart loads and a PR is present, show inline Roman text at the bottom (or as toast on the PR point): `"A personal best on {liftName} — {weight} pounds. Noted with admiration."` Use `<RomanAvatar size="sm" expression="slight_smile" />` next to the copy.

## Cross-cutting

### Roman copy module
Extend `src/lib/roman/copy.ts` (or create if Roman P3 hasn't merged yet):
```ts
export function romanFirstPayment(args: { coachName: string; amount: string; clientName: string; mode: 'default'|'celebration'|'error' }): string
export function romanPRDetected(args: { liftName: string; weight: number }): string
```

### Coordination with P3 builder
P3 builder is being dispatched in parallel and will also create/touch `src/lib/roman/copy.ts`. If both PRs land on copy.ts, conflict resolution is UNION (each function is independent).
- P3 owns: §2.3, §2.4, §2.5, §2.7, §2.8, §2.9, §2.10, §2.12
- P4 owns: §2.6 (First Payment) + PR-detected commentary (new function not in spec)
NO overlap on functions. Edit additively only.

### FACE+VOICE invariant
Every Roman copy site must have RomanAvatar in the same component tree.

## Constraints
- Author: `Dynasia G <dynasia@trygrowthproject.com>`
- Title-only commits, no trailers.
- Model: Opus 4.8 (you). Sonnet 4.6 FORBIDDEN.
- R0 grep clean.
- Bradley Law #36 — no swallowed catches.
- R66 full jest exit 0.
- R69 — NO schema changes.
- Use bash + gh + git with api_credentials=["github"]. NO browser_task. NO github_mcp_direct.

## Test plan
- Unit tests for `romanFirstPayment` + `romanPRDetected` — exact spec strings.
- Component test for FirstPaymentWowScreen — MMKV gate (renders once, second open is no-op), RomanAvatar present, copy correct.
- Component test for progress chart — PR detection renders flag + Roman commentary, haptic fires on scrubber.
- Realtime subscription test — Supabase channel mocked, INSERT event triggers navigation.

## Verification gates (all must pass before push)
1. `npm ci` exit 0
2. `npx tsc --noEmit` exit 0
3. `npm run lint` exit 0
4. Targeted: copy.ts + 2 surface test files + realtime test exit 0
5. Full: `npx jest --runInBand` exit 0
6. R0 grep clean

## Push + PR
- `git push -u origin feature/roman-p4-ed3-ed4-showpieces`
- `gh pr create --base main --title "feat(roman): P4 ED.3 First Payment Wow + ED.4 Progress Chart animations" --body "..."`
- CI workflow 265423898 auto-dispatches on push. NOTE: GitHub runner outage active; local gates are source of truth.

## Report
Write `/home/user/workspace/ROMAN_P4_BUILDER_REPORT.md`:
- PR number + URL
- HEAD SHA
- ED.3 + ED.4 feature lists
- Particle/animation tech choices made (Skia vs Reanimated, etc.)
- MMKV gate evidence (test pass)
- FACE+VOICE invariant evidence
- Gate evidence
- `BUILD COMPLETE: <pr_number> <sha>` final line.
