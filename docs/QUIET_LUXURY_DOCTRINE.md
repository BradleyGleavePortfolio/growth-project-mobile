# Quiet-Luxury Doctrine

This is the standing rule set for the shipped surface of the mobile app. It exists so the next contributor — human or otherwise — does not regress the work that pulled the app out of its early MVP visual register.

If a change in this repo would violate one of the rules below, the rule wins. Where the spec genuinely needs to break a rule (one-off marketing moment, partner takeover, etc.), the PR description must call it out explicitly.

## 1. The single source of typography is `src/theme/tokens.ts`

- Display and heading roles use **Cormorant Garamond** (`CormorantGaramond_400Regular` / `_500Medium`).
- UI roles use **Inter** (`Inter_400Regular` / `_500Medium` / `_600SemiBold`).
- The maximum allowed weight on any **display** copy is `500`. Raw `700` and `800` weights are banned in `src/screens/**` and `src/components/**`. The build will surface them; reviewers will reject them.
- `src/constants/theme.ts` and `src/constants/fonts.ts` are legacy shims that defer to `tokens.ts`. Do not reintroduce a heavy hero-scale (`fontWeight: '800'`, `fontSize: 32, fontWeight: '800'`, etc.) into either file.
- New screens should import directly from `theme/tokens` (`typography.h1`, `typography.eyebrow`, etc.). Do not invent a new scale per screen.

## 2. No placeholders, no Coming Soon, no fake features

- "Coming Soon", "In Development", "Planned", and equivalent placeholder labels are not allowed on the shipped surface.
- A tab, card, or screen either renders a real, working feature against a real backend, or it does not ship. Hide the navigation entry until the real implementation lands.
- Do not theatrical-seed local SQLite to make a feature "look real." If a feature only exists per-device, it does not exist.
- `// TODO`, `// FIXME`, and `// XXX` comments are not allowed in shipped paths. If something is incomplete, open an issue and remove the inline note.
- Form `placeholder=` attributes for `TextInput` are fine — those are user-interface affordances, not feature placeholders.

## 3. No celebrations, no confetti, no trophy chrome

- Confetti, particle bursts, scale/spring "pop in" animations, and full-screen celebration overlays are gone. They will not return.
- "First Win", "Identity Locked In", "Welcome to the Inner Circle", "Save Your Trophy" copy is gone. So is the `TrophyShareScreen`, the `FirstWinCelebration` overlay, and the `useFirstWinCelebration` hook. Do not reintroduce them under different names.
- Founding-tier accent (camel hairline, muted gold label) is the only tier-aware visual cue. No glow, no shimmer, no gradient, no animated badges.
- Milestone surfaces use `MilestoneList` (date · note rows). They do not animate beyond a single fade.

## 4. No hype copy, no AI fingerprints, no exclamation marks

- Do not write copy that congratulates the user. No "Crushing it", "Legendary", "Beast Mode", "Amazing", "Awesome", "You're killing it", "Locked in".
- Avoid trailing exclamation marks in UI strings. A period is almost always the right end punctuation.
- No emoji or pictograph leaks in `src/**`. The product palette is the icon set in `Ionicons` — if you reach for `🏆`, `🎉`, `✨`, `💪`, `🔥`, etc., stop. Pick an icon or remove the embellishment.
- Avoid em-dash-heavy "AI fingerprint" prose in copy and comments. Be plain. "Track your day" is better than "Track your day — effortlessly, on your terms."
- Do not paste em-dash lists, `—` bullets, or marketing-cadence sentences into shipped strings.

## 5. Restrained motion, restrained color, restrained chrome

- Corners are rounded, soft and premium, never a near-square rectangle (owner ruling 17:07 on 8 October 2026: "I want nice rounded corners, luxurious, not rectangles"; decision 133-4). Use the semantic radius tokens in `src/theme/tokens.ts`, never a literal: `radius.button` 12 and `radius.input` 12, `radius.card` 16, `radius.sheet` 24 on bottom-sheet and modal top corners, `radius.chip` (pill) for chips, `radius.control` 6 for boxes under 28 pt such as a checkbox.
- The legacy keys `radius.sm` / `md` / `lg` / `xl` / `2xl` (0 / 2 / 4 / 4 / 4) are deprecated for new code and move to the semantic keys screen by screen.
- Backgrounds: `bone` (`#F5EFE4`) is the global background. Cards sit on `cream` or `surface`. Never use `#000`; ink (`#1A1A18`) is the dark.
- Single accent: forest (`#2C4A36`). Avoid neon greens (`#52B788`, `#2D6A4F`), terra-cottas, steel blues, and the rest of the legacy palette.
- Shadows are capped at `shadows.lg` (12px radius, 8% opacity). No drop shadows above that.
- Motion durations live in `motion.duration`. Default to `base = 400ms` with `decel` easing. Springs and `accelerate` easing are gone. Screen-level motion stays at 300 ms or less and respects Reduce Motion.

## 6. No global chrome, no floating widgets

- The floating "GP" chat widget is gone. Do not reintroduce a global FAB, toaster, banner, or floating button on shipped screens. The dedicated AI surface is `AIGuideScreen`, reachable from the More tab.
- Banners that are not `OfflineBanner` should ship behind a real, tested condition or not at all.

## 7. Single onboarding, single splash

- The lean 3-question flow (`LeanQ1`–`LeanQ3`) is the only onboarding path for new accounts in general builds. When `featureFlags.consultationOnboarding` is on (the `clinic` EAS profile), the consultation in `src/screens/consultation/` replaces it entirely; it follows this doctrine (see its README). The legacy 10-step flow is preserved for existing users only and is not reachable from a fresh signup.
- `AppSplash` is the only splash component. The earlier `SplashScreen.tsx` duplicate has been removed.

## 8. Every PR updates the corresponding README

Every PR must update the README / module documentation that describes the surface it changes. This is a hard rule, not a nice-to-have. Docs that drift past one or two PRs are docs that get ignored, and the cost of an out-of-date `src/screens/client/README.md` is a contributor reading a file that confidently describes a `FloatingChatWidget` that was deleted three releases ago.

Concretely, when a PR:

- adds or removes a screen, route, or component → update `src/screens/<role>/README.md`, `src/components/README.md`, and `src/navigation/README.md` to match.
- changes a navigator's tab list, route param shape, or stack → update `src/navigation/README.md` and the root `README.md` Navigation section.
- adds an external dependency the screen calls (a new backend endpoint, a new env var, a new hosted file) → record it in the dependencies / env-var section of the relevant README, and in `PLAY_STORE_READINESS.md` if it gates a release.
- removes a previously-documented surface → either rewrite the entry to describe the replacement, or move it to a "Removed surfaces" section so the next contributor knows it is intentional.
- introduces or changes a doctrine-relevant rule → update this file *and* link it from the affected README.

If a change is genuinely doc-free (CI-only, a one-line lint fix, a typo) the PR description must say so explicitly. The default is: **docs change with the code, in the same PR**. The PR template (`.github/pull_request_template.md`) carries the checklist.

The reviewer checklist below applies to UI changes; the doc rule above applies to *every* PR.

| Surface | Current behaviour / module note |
|---|---|
| Coach load states (`ui/states/QuietStates`: booking inbox, invites, pending AI drafts, risk board, Programs `FailureBox` / `LoadingRow`) | One calm error: a sentence in ink, no red, icon or box, then a forest "Try again" text action (44 pt); Contact support and Sign in again follow as text actions. Copy says "could not load"; "Check your connection" only when the request got no answer; raw server text never shows. One loading look: the shared skeleton with a spoken label. QA-COACH-STATES-131. |
| Coach client Timeline / Weekly (`ClientDetailScreen`, `useClientDetailData`) | Independent loading and error states reuse QuietLoading / QuietError; no empty-data claim while a read is pending or failed. Try again reloads the selected period, and a successful empty response alone shows the existing empty message. Check-in review, weekly disclosure and all period choices stay reachable. COACH-TIMELINE-STATES-132, agent 132. |
| Food log (`LogScreen`, `clientStore`, `components/log`) | A first read for the selected day shows the shared skeleton, not zero totals or empty-meal claims. Changing date clears the prior day's foods, totals and water immediately; a failed new-day read shows retry without old numbers. A same-day refresh retains that day's verified data. A successfully empty day has one instruction, all four meal entry points stay reachable, action labels use sentence case, search failures use a neutral hairline, and the edit sheet uses theme colours and radius 4. Existing search, portion, manual, repeat, edit/move/delete, water quick-add and refresh paths remain. Saved water now has confirmed 44 pt Remove controls in unfilled hairline rows; request failures keep the verified entries and total. |
| Fasting (`FastingScreen`, Shortcuts start in `WidgetsScreen`, `utils/fastingAlert.ts`) | Back-only header on `Fast`. One serif hero in hours and minutes (no ring, no ticking seconds), hairline protocol choices, one forest primary action (Start fast / End fast, never red), QuietBar progress, monochrome history ("Completed" / "Ended early"), stats only after a fast has ended with labels that say which fasts they cover, a run line only for two or more days in a row. The end alert follows Settings > Fasting alerts on both start paths and is cancelled on End fast or when the running fast is removed. "Remove this fast" (confirmed) stays on the running fast and every history row as a 44 pt muted text action. Every action is kept. |
| Habits & check-in (`HabitsScreen`, `habits/styles`) | Built from `src/ui` under the back-only native header: date overline, serif headline, underlined text tabs, the day in one sentence, Add habit as a forest text action, shared skeleton and QuietError retry. Habit rows: outlined check circle, serif name, week dots; check-in: overline sections, radio dots, round steppers; the Add habit sheet has `radius.sheet` corners and the shared PrimaryButton. Save / Update check-in is the one rounded forest button; the inactive-access line and `ProtectedScreen` gate are unchanged. REDO-HABITS-CAL-COMM-133, agent 133. |
| Coach client payments (`ClientPaymentsScreen`, `clientPaymentsCopy`) | Bone page, one Cormorant title, one hairline section per plan with a muted overline; prices use tabular numerals. Plan actions are text actions with 44 pt targets (Cancel plan muted), each confirmed in a native dialog. The refund sheet (radius 4, theme overlay) holds the one filled forest button. State is said in words, never by colour. |
| Coach client archive (`ClientDetailScreen`, `useClientDetailData`) | The roster supplies the real archive state; unknown is never labelled active. The header keeps the goal alongside Active / Archived client. Archive confirms before the existing status endpoint and states that recurring billing is separate; client Your plans directions remain, while coach Payments directions require its server flag. Unarchive and refresh remain. CLIENT-ARCHIVE-COPY-132, agent 132. |

## 10. Build client screens from `src/ui`

- `Screen` (insets from react-native-safe-area-context plus 12 pt under the status bar, a pinned keyboard-aware footer), `ScreenTopBar`, `PrimaryButton` (the one filled forest button, `radius.button`), `TextLink` / `QuietTextButton`, `Headline` / `Lede` / `AccentRule`, `Overline` (`QuietOverline`), `QuietSection`, `QuietRow`, `WheelBand`. Import from `src/ui`.
- Never import `SafeAreaView` from `react-native` (it does nothing on Android edge-to-edge). Serif roles keep lineHeight at least 1.25 x fontSize (`SERIF_MIN_LINE_RATIO`).

## 9. Reviewer checklist (paste into PRs that touch UI)

- [ ] No `fontWeight: '700'` or `'800'` introduced.
- [ ] No "Coming Soon" / "Planned" / "In Development" copy introduced.
- [ ] No new emoji literals in source.
- [ ] No new exclamation marks in user-facing copy.
- [ ] Corners use the semantic radius tokens (button / input 12, card 16, sheet 24, chip pill); no literal radius, no new 0-4 pt button or card.
- [ ] No `SafeAreaView` from `react-native`; the screen uses `Screen` or react-native-safe-area-context.
- [ ] No new floating widgets, FABs, or global banners.
- [ ] No new TODO/FIXME comments.
- [ ] If founding/inner-circle phrasing appears, it is restrained (hairline + label only — no shimmer, no glow, no celebration).
