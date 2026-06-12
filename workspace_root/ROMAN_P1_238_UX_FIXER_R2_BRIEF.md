# FIXER BRIEF — Roman P1 #238 UX combined fixer R2

FIXER (Opus 4.8 ONLY — Sonnet 4.6 FORBIDDEN). NOT builder. NOT auditor. Fix the P0 + P1 from R2 UX audit. Read `/home/user/workspace/ROMAN_P1_238_R2_UX_AUDIT_REPORT.md` first. Read `/home/user/workspace/doctrine/roman_identity_spec.md`. Read `/tmp/tgp-agent-context/quality-references/FIXER_BRIEF_TEMPLATE_50FAILURES_AWARE.md`.

## Context
- Repo: `BradleyGleavePortfolio/growth-project-mobile`
- PR: #238, HEAD `5ded65c194a1e97c10bad27583f164418cc7f7b5`
- Author: `Dynasia G <dynasia@trygrowthproject.com>` (title-only commits, NO trailers)
- Cross-cutting rule: **"Roman's voice ALWAYS appears WITH HIS FACE"** + "wire him up for COACH SCREENS TOO" — applies to BOTH coach and client entry rows.

## Worktree (isolated)
```bash
mkdir -p /home/user/workspace/tgp/fixer-roman-p1-r2-ux
cd /home/user/workspace/tgp/fixer-roman-p1-r2-ux
git clone https://github.com/BradleyGleavePortfolio/growth-project-mobile.git .
git fetch origin pull/238/head:pr-238
git checkout pr-238
git config user.name "Dynasia G"
git config user.email "dynasia@trygrowthproject.com"
npm ci
```
`api_credentials=["github"]`. NO browser, NO github_mcp_direct.

## Findings to fix (verbatim per audit + D-012/D-013)

### P0 — Coach Roman entry row is disembodied (FACE+VOICE violation)
- File: `src/screens/coach/SettingsScreen.tsx:548-567`
- Currently: `TouchableOpacity` with `<Ionicons name="sparkles-outline" />` at line 559, Roman copy at 561-564, NO `RomanAvatar` in component tree.
- **Fix**: Import `RomanAvatar` from canonical Roman lane (after D-013 move: `src/components/roman/RomanAvatar.tsx`). Replace the Ionicons sparkles render at line 559 with `<RomanAvatar size="sm" />` (or appropriate size prop — pick the existing size enum that visually matches a settings row icon). Preserve all existing a11y props (`accessibilityRole`, `accessibilityLabel`, `accessibilityHint`).

### P0 — Client Roman entry row ALSO disembodied (D-012 — user cross-cutting rule)
- File: `src/screens/client/MoreScreen.tsx:129-137`
- Currently: sparkles icon only, no RomanAvatar.
- **Fix**: Same treatment — import `RomanAvatar` from canonical Roman lane and render in place of (or alongside) the sparkles icon. Roman row gets Roman's face.

### P1 — U6 RomanAvatar tokenization (D-013 Path A — move to canonical Roman lane)
- File: `src/components/community/RomanAvatar.tsx` has raw hex `#C9A961` (line 60), `#1A1A18` (line 61), used at lines 100, 141, 149.
- Import sites: `src/components/roman/RomanGreeting.tsx:16`, `src/screens/roman/RomanChatScreen.tsx:37`, `src/components/roman/RomanMessageBubble.tsx:16`, `src/components/roman/RomanState.tsx:17`, `src/components/roman/RomanTypingIndicator.tsx:18`.
- **Fix Path A (CHOSEN per D-013)**:
  1. `git mv src/components/community/RomanAvatar.tsx src/components/roman/RomanAvatar.tsx`
  2. Replace `const ROMAN_ACCENT = '#C9A961';` with `tokens.colors.romanAccent` (or appropriate semantic token name — check `src/theme/tokens.ts` for existing Roman color tokens; if none exist, ADD them in `tokens.ts` with semantic names like `romanAccent`, `romanInk`).
  3. Replace `const ROMAN_INK = '#1A1A18';` with `tokens.colors.romanInk` (or equivalent).
  4. Update all 5 import sites (Roman lane) AND the new 2 import sites (Settings + More) to import from `src/components/roman/RomanAvatar`.
  5. Run `grep -r "components/community/RomanAvatar" src/` — must return ZERO matches.
  6. Run `grep -r "#C9A961\|#1A1A18" src/components/roman/RomanAvatar.tsx` — must return ZERO matches.

## Mandatory checks before commit (R0 hectacorn floor)

1. **R0 grep battery on added lines (incl. comments)**:
   ```bash
   git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep -E '^\+' | \
     grep -vE '^\+\+\+' | \
     grep -E 'as any|as unknown as|@ts-ignore|TODO|FIXME|Coming soon|catch.*\{\s*\}|0x[A-Fa-f0-9]+|#[A-Fa-f0-9]{3,6}' || echo "CLEAN"
   ```
   Result must be `CLEAN`. The only `#` hex permitted on added lines is in `src/theme/tokens.ts` itself (if you add new Roman tokens there).
2. **FACE+VOICE invariant**: After fixes, run:
   ```bash
   # Every file rendering Roman voice strings must import RomanAvatar
   grep -rln "romanVoice\|ROMAN_GREETING\|ROMAN_SEND_FAILED\|ROMAN_LOADING_OLDER\|ROMAN_TYPING_LABEL\|ROMAN_INTERRUPTED_NOTE" src/ | while read f; do
     if ! grep -q "RomanAvatar" "$f"; then
       echo "FACE+VOICE VIOLATION: $f renders Roman voice but no RomanAvatar import"
     fi
   done
   ```
   Plus manual check: `src/screens/coach/SettingsScreen.tsx` AND `src/screens/client/MoreScreen.tsx` both render `<RomanAvatar />` in the Roman entry row.
3. **R69 (Prisma)**: ZERO Prisma schema diff (mobile PR).
4. **Bradley Law #36**: ZERO swallowed catches.
5. **R70 fail-fast**: `npx tsc --noEmit` <30s.
6. **R66 full suite**: `npx jest --runInBand` — full pass before push.

## Push + finish
```bash
git add -A
git commit -m "fix(roman): face+voice on coach+client entry rows, tokenize RomanAvatar in roman/ lane (P0+P1)"
git push origin HEAD:<the PR-238 branch>
```
Then report:
```
FIX COMPLETE: <new SHA>
Report at /home/user/workspace/ROMAN_P1_238_UX_FIXER_R2_REPORT.md
```

Report must include:
- All changed files + git diff stats
- Output of FACE+VOICE invariant check (must be empty)
- Output of R0 grep battery (must be CLEAN)
- Output of `grep -rn "#C9A961\|#1A1A18" src/` — must be empty OR only in `src/theme/tokens.ts`
- Output of `grep -rn "components/community/RomanAvatar" src/` — must be EMPTY
- R66 full suite result with pre-existing leak signature confirmation (D-011)
- Before/after for the two entry rows (paste 3-line snippets)

## Quality gate
P0 + P1 ALL CLOSED. Roman's face appears on EVERY Roman-voiced surface, including BOTH coach Settings and client More entry rows. Canonical RomanAvatar lives at `src/components/roman/RomanAvatar.tsx`. No raw hex. Local CI green (modulo pre-existing leak per D-011).
