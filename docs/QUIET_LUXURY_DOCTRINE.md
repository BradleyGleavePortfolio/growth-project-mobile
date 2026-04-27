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

- Card corners are `radius.lg = 4`. Modal sheet corners are also `radius.lg = 4` — never `16` / `20` / `24`.
- Chip / pill borders are the only place `radius.pill` is allowed.
- Backgrounds: `bone` (`#F5EFE4`) is the global background. Cards sit on `cream` or `surface`. Never use `#000`; ink (`#1A1A18`) is the dark.
- Single accent: forest (`#2C4A36`). Avoid neon greens (`#52B788`, `#2D6A4F`), terra-cottas, steel blues, and the rest of the legacy palette.
- Shadows are capped at `shadows.lg` (12px radius, 8% opacity). No drop shadows above that.
- Motion durations live in `motion.duration`. Default to `base = 400ms` with `decel` easing. Springs and `accelerate` easing are gone.

## 6. No global chrome, no floating widgets

- The floating "GP" chat widget is gone. Do not reintroduce a global FAB, toaster, banner, or floating button on shipped screens. The dedicated AI surface is `AIGuideScreen`, reachable from the More tab.
- Banners that are not `OfflineBanner` should ship behind a real, tested condition or not at all.

## 7. Single onboarding, single splash

- The lean 3-question flow (`LeanQ1`–`LeanQ3`) is the only onboarding path for new accounts. The legacy 10-step flow is preserved for existing users only and is not reachable from a fresh signup.
- `AppSplash` is the only splash component. The earlier `SplashScreen.tsx` duplicate has been removed.

## 8. Reviewer checklist (paste into PRs that touch UI)

- [ ] No `fontWeight: '700'` or `'800'` introduced.
- [ ] No "Coming Soon" / "Planned" / "In Development" copy introduced.
- [ ] No new emoji literals in source.
- [ ] No new exclamation marks in user-facing copy.
- [ ] No new `radius.xl` / `radius.2xl` values larger than 4.
- [ ] No new floating widgets, FABs, or global banners.
- [ ] No new TODO/FIXME comments.
- [ ] If founding/inner-circle phrasing appears, it is restrained (hairline + label only — no shimmer, no glow, no celebration).
