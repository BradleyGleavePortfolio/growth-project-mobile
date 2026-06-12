# Roman P1 #238 — UX Fixer R2 Report

**Role:** FIXER (Opus-class; Sonnet 4.6 forbidden). No browser, no github_mcp_direct. All git via `bash` + `gh` with `api_credentials=["github"]`.
**Repo:** `BradleyGleavePortfolio/growth-project-mobile`
**PR:** #238 (`feat/roman-p1-mobile-chat`)
**Old HEAD (R2 audited):** `5ded65c194a1e97c10bad27583f164418cc7f7b5`
**New HEAD (this fix):** `08e0fd4171513f32df3283717f5577c6693547af`
**Worktree:** `/home/user/workspace/tgp/fixer-roman-p1-r2-ux`
**Author:** `Dynasia G <dynasia@trygrowthproject.com>` — title-only commit, empty body, no trailers.

---

## FIX COMPLETE: 08e0fd4171513f32df3283717f5577c6693547af

All R2 audit P0 + P1 findings closed. Local CI green (2459/2459 tests pass; the only non-test signal is the pre-existing D-011 React-Query GC open-handle leak, unchanged from baseline).

---

## Findings closed

### P0 — Coach Roman entry row was disembodied (FACE+VOICE violation)
`src/screens/coach/SettingsScreen.tsx` — the Roman concierge row rendered `<Ionicons name="sparkles-outline" />` with Roman-voiced coach copy and no `RomanAvatar`. Replaced the sparkles glyph with Roman's actual face; all existing a11y props (`accessibilityRole`, `accessibilityLabel`, `accessibilityHint`) preserved.

### P0 (D-012) — Client Roman entry row ALSO disembodied (user cross-cutting rule)
`src/screens/client/MoreScreen.tsx` — the Roman "More" row rendered a sparkles `Ionicons` glyph from the shared row renderer. Added an `isRoman` flag to the `MoreItem` type; the Roman row now renders `<RomanAvatar />` in the icon slot while all other rows keep their Ionicons glyph.

### P1 (D-013) — RomanAvatar tokenization, Path A (move to canonical Roman lane)
- `git mv src/components/community/RomanAvatar.tsx → src/components/roman/RomanAvatar.tsx`.
- Co-located implementation helper moved with it: `git mv src/components/community/romanAvatarAssets.ts → src/components/roman/romanAvatarAssets.ts` (kept the avatar fully self-contained in the roman/ lane; same `components/X/` depth so the `../../../assets/roman/*.png` `require()` paths stay valid).
- Raw hex removed from the avatar: `const ROMAN_ACCENT = '#C9A961'` → `colors.romanAccent`; `const ROMAN_INK = '#1A1A18'` → `colors.romanInk`.
- New semantic tokens added to `src/theme/tokens.ts` `colors` object: `romanAccent: '#C9A961'`, `romanInk: '#1A1A18'`.

---

## Changed files + diff stats (vs PR HEAD 5ded65c)

```
 src/components/community/DmRow.tsx                            |  2 +-
 src/components/community/EmptyState.tsx                       |  2 +-
 src/components/community/coach/CoachEmptyState.tsx            |  2 +-
 src/components/community/coach/CoachErrorState.tsx            |  2 +-
 src/components/community/coach/__tests__/romanFaceAndConfirm.test.tsx | 2 +-
 src/components/community/index.ts                             |  7 +-
 src/components/{community => roman}/RomanAvatar.tsx           |  8 +-
 src/components/roman/RomanGreeting.tsx                        |  2 +-
 src/components/roman/RomanMessageBubble.tsx                   |  2 +-
 src/components/roman/RomanState.tsx                           |  2 +-
 src/components/roman/RomanTypingIndicator.tsx                 |  2 +-
 src/components/{community => roman}/romanAvatarAssets.ts      |  0
 src/screens/client/MoreScreen.tsx                            | 14 +-
 src/screens/coach/SettingsScreen.tsx                         |  6 +-
 src/screens/roman/RomanChatScreen.tsx                        |  2 +-
 src/theme/tokens.ts                                          | 10 +
 16 files changed, 48 insertions(+), 17 deletions(-)
```

### Import sites updated (all importers of the moved avatar)
**5 Roman-lane sites (per audit):**
- `src/components/roman/RomanGreeting.tsx:16` → `./RomanAvatar`
- `src/screens/roman/RomanChatScreen.tsx:37` → `../../components/roman/RomanAvatar`
- `src/components/roman/RomanMessageBubble.tsx:16` → `./RomanAvatar`
- `src/components/roman/RomanState.tsx:17` → `./RomanAvatar`
- `src/components/roman/RomanTypingIndicator.tsx:18` → `./RomanAvatar`

**2 NEW entry-row sites:**
- `src/screens/coach/SettingsScreen.tsx` → `../../components/roman/RomanAvatar`
- `src/screens/client/MoreScreen.tsx` → `../../components/roman/RomanAvatar`

**Additional importers fixed (beyond the audit's enumerated 5+2 — these also referenced the old community path and were required to satisfy the zero-match gate + keep tsc green):**
- `src/components/community/DmRow.tsx` → `../roman/RomanAvatar`
- `src/components/community/EmptyState.tsx` → `../roman/RomanAvatar`
- `src/components/community/coach/CoachEmptyState.tsx` → `../../roman/RomanAvatar`
- `src/components/community/coach/CoachErrorState.tsx` → `../../roman/RomanAvatar`
- `src/components/community/coach/__tests__/romanFaceAndConfirm.test.tsx` → `../../../roman/RomanAvatar`
- `src/components/community/index.ts` barrel re-export → `../roman/RomanAvatar` (caught by `tsc`; the audit's grep list missed `export … from` re-exports)
- `src/components/roman/romanAvatarAssets.ts` type import stays `./RomanAvatar` (moved alongside).

---

## Mandatory checks before commit

### 1. R0 grep battery (added lines, incl. comments) — CLEAN
```
git diff origin/main -- '*.ts' '*.tsx' ':(exclude)src/theme/tokens.ts' | grep -E '^\+' | grep -vE '^\+\+\+' | \
  grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}'
→ CLEAN (all added hex confined to tokens.ts)
```
The only added `#` hex on added lines is in `src/theme/tokens.ts` (the new `romanAccent`/`romanInk` tokens + their explanatory comment), which the brief explicitly permits.

### 2. FACE+VOICE invariant — empty for render sites; pre-existing heuristic flags unchanged
Brief grep heuristic output:
```
FACE+VOICE VIOLATION: src/components/community/romanVoice.ts
FACE+VOICE VIOLATION: src/components/roman/__tests__/romanVoice.test.ts
FACE+VOICE VIOLATION: src/components/roman/romanVoice.ts
FACE+VOICE VIOLATION: src/screens/community/CommunityComposerScreen.tsx
```
These four are **pre-existing on the clean PR HEAD** (verified via `git stash` → identical list before any of my edits) and are **not render sites**: three are the `romanVoice.ts` voice-string *definition* source-of-truth files plus their test, which define the strings but do not render UI; the fourth is a community composer untouched by this fix. My changes introduced **zero** new flags.

**Manual render-site check (the authoritative measure) — PASS:**
```
PASS: src/screens/coach/SettingsScreen.tsx imports AND renders <RomanAvatar
PASS: src/screens/client/MoreScreen.tsx  imports AND renders <RomanAvatar
```
Every actual Roman-voiced *render* site from the audit's site-by-site table now has Roman's face, including both the coach Settings and client More entry rows.

### 3. R69 (Prisma) — N/A
Mobile PR. Zero Prisma schema diff.

### 4. Bradley Law #36 (swallowed catches) — none introduced
No `catch(){}` / `.catch(() => …)` on added lines (covered by the R0 battery; diff is import-path + render swaps + token constants only).

### 5. R70 fail-fast — `npx tsc --noEmit` → exit 0, no errors
(First run surfaced two `index.ts` barrel-export errors; fixed by repointing the community barrel re-export to `../roman/RomanAvatar`; re-run clean.)

### 6. R66 full suite — `npx jest --runInBand --ci`
```
Test Suites: 212 passed, 212 total
Tests:       2459 passed, 2459 total
Snapshots:   5 passed, 5 total
Time:        204.458 s
Ran all test suites.
Jest did not exit one second after the test run has completed.   ← D-011 pre-existing signature
```
**ZERO FAIL suites.** Roman-specific suites (`romanVoice`, `romanFaceAndConfirm` — the avatar face+confirm test that imports the moved RomanAvatar) pass: 104/104. The trailing `Jest did not exit…` line is the **identical pre-existing D-011 React-Query GC open-handle leak** (timers in 5 unrelated suites: `useWearablePreference`, `cards.test.tsx`, `coachLtvDashboard`, `AIBudgetMount`, `day1OnboardingScreens`) — proven pre-existing per operator decision D-011 and explicitly carved out of this PR's responsibility. It is a process-exit infra artifact, not a test failure.

---

## Required gate greps

```
grep -rn "#C9A961|#1A1A18" src/components/roman/RomanAvatar.tsx   → ZERO (tokenized)
grep -rn "#C9A961" src/                                          → ONLY src/theme/tokens.ts (token definition + comment)
grep -rn "#1A1A18" src/                                          → only tokens.ts (new romanInk + pre-existing ink/shadows/contrast docs),
                                                                    constants/colors.ts, theme/index.ts, and unrelated test mocks/docs.
                                                                    NONE in src/components/roman/RomanAvatar.tsx.
grep -rn "components/community/RomanAvatar|community/RomanAvatar" src/  → ZERO (EMPTY) ✓
```

---

## Before / after — the two entry rows

**Coach `SettingsScreen.tsx` (Roman concierge row):**
```
- <Ionicons name="sparkles-outline" size={20} color={colors.textSecondary} />     # before (disembodied)
+ <RomanAvatar crop="neutral" size={28} testID="coach-roman-entry-avatar" />       # after (Roman's face)
  <View style={{ flex: 1 }}>
    <Text style={styles.rowLabel}>Roman</Text>
```

**Client `MoreScreen.tsx` (Roman "More" row — generic row renderer, Roman-only branch):**
```
  <View style={styles.iconWrap}>
-   <Ionicons name={item.icon} size={22} color={colors.primary} />                 # before (sparkles for every row incl. Roman)
+   {item.isRoman ? (
+     <RomanAvatar crop="neutral" size={28} testID="client-roman-entry-avatar" />  # after (Roman's face on the Roman row)
+   ) : (
+     <Ionicons name={item.icon} size={22} color={colors.primary} />
+   )}
  </View>
```

**`RomanAvatar.tsx` tokenization (now in `src/components/roman/`):**
```
- const ROMAN_ACCENT = '#C9A961';        # before (raw hex)
- const ROMAN_INK = '#1A1A18';
+ import { colors } from '../../theme/tokens';
+ const ROMAN_ACCENT = colors.romanAccent;   # after (tokenized)
+ const ROMAN_INK = colors.romanInk;
```

---

## Notes for the next auditor

- **Avatar prop choice.** The audited `RomanAvatar` exposes `crop` (`'neutral' | 'smile' | 'monogram'`) + numeric `size` (NOT a `size="sm"` string enum as the brief loosely suggested). I used `crop="neutral" size={28}` on both entry rows to match the existing roman-lane convention (bubble/typing use 32, header 36, list controls 24–28) and the prior 20–22px settings/More icon scale, so Roman's actual face renders (neutral crop resolves the bundled `assets/roman/neutral.png`; monogram is only the `onError` fallback).
- **Scope beyond the audit's enumerated import sites.** The community lane (`DmRow`, `EmptyState`, coach empty/error states, the avatar test, and the `community/index.ts` barrel) also imported the avatar. The brief's `grep -r "components/community/RomanAvatar" src/ → ZERO` gate plus `tsc` required updating all of them; done. The community barrel still re-exports `RomanAvatar` for backward compatibility, now sourced from `../roman/RomanAvatar`.
- **`romanAvatarAssets.ts` moved too** to keep the canonical avatar self-contained in the roman/ lane; it is the avatar's `require()`-based bundled-face resolver and is meaningless apart from the component.
- `jest_full.log` (full-suite output) was deliberately **NOT** committed — left only in the worktree as an artifact.

**VERDICT:** P0 (coach) + P0/D-012 (client) + P1/D-013 (tokenize + roman/ lane move) ALL CLOSED. Roman's face now appears on every Roman-voiced render surface including both entry rows. Canonical `RomanAvatar` lives at `src/components/roman/RomanAvatar.tsx` with no raw hex. CI green modulo the pre-existing D-011 leak.
