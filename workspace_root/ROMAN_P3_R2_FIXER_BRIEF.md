# Roman P3 R2 Fixer Brief — PR #241

## Mission
Fix the 2 NEW findings introduced by Roman P3 builder (P2-CODE-01 expression/copy mismatch + P1-UX-01 missing live regions). Per D-048, **defer all pre-existing tech debt** (P1-CODE-01 Jest baseline, P1-CODE-02 pre-existing swallowed catches, P1-CODE-03 dependency audit) — those are out-of-scope sweep PRs.

## Target
- **Repo**: `BradleyGleavePortfolio/growth-project-mobile`
- **Branch**: `feature/roman-p3-voice-expansion`
- **HEAD to fix on top of**: `d79fda2837279d19d78c52119196f937bd74b507`
- **Worktree**: `/home/user/workspace/tgp/fixer-roman-p3-r2`

## Setup
```bash
cd /tmp/tgp-agent-context-mobile
git fetch origin feature/roman-p3-voice-expansion
git worktree add /home/user/workspace/tgp/fixer-roman-p3-r2 feature/roman-p3-voice-expansion
cd /home/user/workspace/tgp/fixer-roman-p3-r2
npm ci
```
Use `api_credentials=["github"]` for all `gh`/`git` calls.

## Fix #1 — P2-CODE-01 + P2-UX-01: Workout celebration face/copy coherence

**Root cause**: `src/components/roman/RomanWorkoutCompleteCard.tsx:34-38` sets `crop = 'smile'` for `mode === 'celebration'`, but `src/lib/roman/copy.ts:197-204` falls back to default copy if `liftName` is blank. Mismatch → smile face with default copy.

**Fix approach (Option A — derive effectiveMode)**:
- In `RomanWorkoutCompleteCard.tsx`, compute `const isCelebration = mode === 'celebration' && Boolean(liftName?.trim())` once at the top of the component.
- Use `isCelebration` to drive BOTH the avatar `crop` AND the `roman*` call.
- Pass the validated `liftName` only when `isCelebration` is true.

**Test additions** (`src/components/roman/__tests__/romanP3Surfaces.test.tsx` or extend existing): Add cases for:
- `mode="celebration"` + `liftName="Squat"` → smile crop, PR copy.
- `mode="celebration"` + `liftName=""` → neutral crop, default copy.
- `mode="celebration"` + `liftName=undefined` → neutral crop, default copy.

## Fix #2 — P1-UX-01: Missing live regions on dynamic Roman copy

Add `accessibilityLiveRegion="polite"` to the dynamic copy `<Text>` containers in these 7 components:
- `src/components/roman/RomanBriefCard.tsx` (line 39 area)
- `src/components/roman/RomanCheckInNotice.tsx` (line 31 area)
- `src/components/roman/RomanNewClientNotice.tsx` (line 34 area)
- `src/components/roman/RomanPayoutNotice.tsx` (line 39 area)
- `src/components/roman/RomanStreakCard.tsx` (line 52 area)
- `src/components/roman/RomanVoiceLogReadback.tsx` (line 38 area) ← highest priority
- `src/components/roman/RomanWorkoutCompleteCard.tsx` (line 38 area)

Use `accessibilityLiveRegion="polite"` for confirmations. Do NOT change `RomanErrorBanner` — it already uses `accessibilityRole="alert"`.

**Test additions**: For each of the 7 components, add a test asserting the live-region prop is set on the copy container.

## R0 / Bradley Law #36 / R66 / R70

- **R0 grep** on added lines including comments: `grep -nE "(console\\.|TODO|FIXME|@ts-ignore|as any|Math\\.random|Date\\.now|eval|dangerouslySetInnerHTML)" <added-lines>` must be empty.
- **Bradley Law #36**: ZERO swallowed catches in new code. Do NOT touch pre-existing ones (deferred per D-048).
- **R70 fail-fast** (<30s): `npx jest --runInBand src/components/roman/__tests__/romanP3Surfaces.test.tsx src/lib/roman/__tests__/copy.test.ts` — exit 0.
- **R66 full Jest**: `npx jest --runInBand` — exit 0. If memory-killed, run with `NODE_OPTIONS=--max-old-space-size=4096 npx jest --runInBand --silent`.
- **Typecheck**: `npx tsc --noEmit` — exit 0.

## Commit & push
- **Author**: `Dynasia G <dynasia@trygrowthproject.com>`
- **Title only** (no trailers): `fix(roman): P3 R2 — celebration coherence + live regions`
- `git push origin feature/roman-p3-voice-expansion`

## Output
Write `/home/user/workspace/ROMAN_P3_R2_FIXER_REPORT.md` ending with:
```
FIX COMPLETE: <new-HEAD-sha>
```

## DO NOT
- Do NOT touch the 8 pre-existing swallowed catches (deferred per D-048).
- Do NOT bump dependencies.
- Do NOT introduce new copy strings — only the spec strings from `src/lib/roman/copy.ts` are allowed.
- Do NOT add Math.random / Date.now / console.log / TODO / FIXME / @ts-ignore.
- Do NOT modify `RomanErrorBanner` (already correct).
