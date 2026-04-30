# 06 — Accessibility readiness

> Pre-build brief. Defines the concrete bar every new screen in the expansion pack must clear, and where in the codebase it gets enforced.

## WHY

The app today has a partial accessibility story: the bottom-tab bar is icons-only with `accessibilityLabel` props (see `src/navigation/ClientNavigator.tsx`), and `docs/QUIET_LUXURY_DOCTRINE.md` includes WCAG-AA contrast pairings inline. What is **not** written down:

- A line-item bar new screens must clear before merge (labels on every interactive element, hit slop minimums, screen-reader reading order, dynamic-type behaviour, reduce-motion behaviour).
- A repeatable way to verify that bar in CI or QA — not "did the engineer remember".
- Dynamic Type and Reduce Motion handling is not consistently considered.

The expansion features include client-facing surfaces (#92 item 5, weekly check-ins) where users on accessibility settings will land, and coach surfaces (#92 items 6, 8, 12) where a coach in a screen-reader-driven session is plausible. Without an explicit bar, every feature ships with whatever accessibility the engineer happened to think of, which is uneven by definition.

## WHEN

Land this brief before the first expansion-pack feature with a non-trivial form (#92 items 5, 11, 14 all qualify). The bar is small enough to apply retroactively to existing screens too; that is a follow-up.

## WHERE

When implemented:

- `docs/ACCESSIBILITY_BAR.md` (new) — the canonical line-item bar.
- `src/components/patterns/` — primitives ([brief 05](./05-reusable-expansion-ui-patterns.md)) embed the bar once; consumers inherit it.
- `src/__tests__/accessibility/*.test.tsx` (new) — automated checks, scoped to what is automatable.
- `.github/pull_request_template.md` — gains an accessibility checkbox row.
- `docs/QUIET_LUXURY_DOCTRINE.md` — cross-links to the bar; the WCAG matrix already lives there.

## WHO

- **Engineer**: ticks the bar on every new screen in their PR description.
- **Mobile lead**: blocks PR merge if the bar is not ticked or not credibly defended.
- **Operator/QA**: runs the manual accessibility passes during release smoke (matrix in [brief 10](./10-mobile-qa-matrix.md)).

## WHAT

The bar (eight items):

1. **Every interactive element has an `accessibilityLabel`** that reads naturally without surrounding context.
2. **Every interactive element has `accessibilityRole`** matching its semantic intent (`button`, `link`, `header`, `image`, `summary`).
3. **Hit targets are ≥ 44 × 44 logical pixels.** Use `hitSlop` for visually small targets (see `HapticPressable.tsx`).
4. **Contrast meets WCAG AA** for normal-size text (`docs/QUIET_LUXURY_DOCTRINE.md` matrix). Body uses `colors.text.primary` on `background.bone`; muted body uses `colors.text.secondary`. Decorative colours never carry information alone.
5. **Dynamic Type respected** up to iOS extra-large (and Android equivalent). Layouts wrap or scroll; no truncation that hides information.
6. **Reduce Motion respected**: `react-native-reanimated` v4 exposes `useReducedMotion()`. Animations that only convey aesthetic state are downgraded to instant transitions when reduce-motion is on.
7. **Screen-reader reading order** is logical without relying on visual layout. Order is implicitly the JSX order; verify with VoiceOver / TalkBack.
8. **Forms have labels**, errors are announced (`accessibilityLiveRegion="polite"` on the error region), and focus moves to the first error on submit failure.

The bar is **not**:

- Localisation (separate concern).
- Keyboard-navigation polish (keyboard is rare on mobile; covered for tablets later).
- Custom haptic alternative for sound (out of scope).

## HOW

1. Write `docs/ACCESSIBILITY_BAR.md` with one short paragraph per bar item, including a code snippet showing the right shape.
2. Add an axe-RN-style automatable subset:
   - A render test that scans for `Pressable`/`TouchableOpacity` without `accessibilityLabel` and fails.
   - A test that ensures every primitive in `src/components/patterns/` exposes the right `accessibilityRole`.
3. Update `.github/pull_request_template.md` with an accessibility checklist row.
4. Refactor existing primitives to embed the bar once: `ListRow`, `Card`, `StatusBanner` get sensible defaults that make every consumer accessibility-correct without thinking.
5. Add a `npm run accessibility:audit` script that greps `src/screens/` and flags any `<Pressable` or `<TouchableOpacity` without `accessibilityLabel` or `accessibilityRole`. Advisory at first, blocking after one release cycle.

## Expo / EAS considerations

- Dynamic Type support requires `allowFontScaling` (default `true` on RN) — leave it default, don't disable. Where layouts break at large sizes, use `<ScrollView>` not fixed heights.
- Reduce Motion needs `react-native-reanimated`'s `useReducedMotion()`. Already a dependency.
- VoiceOver (iOS) and TalkBack (Android) are tested via OS settings; no SDK config.
- No bundle-size impact.
- No native module additions.

## Acceptance criteria

- `docs/ACCESSIBILITY_BAR.md` exists and lists all eight items with examples.
- All primitives in `src/components/patterns/` pass the automated subset.
- The PR template has an accessibility checkbox row.
- `npm run accessibility:audit` runs on `src/screens/` without crashing and reports findings.
- One existing screen (proposed: `HomeScreen`) is brought to full bar compliance as the canonical example.

## Rollout strategy

- **Phase 1**: ship the bar doc + the audit script (advisory).
- **Phase 2**: refactor primitives so consumers inherit the bar.
- **Phase 3**: bring `HomeScreen` to full compliance as the canonical reference.
- **Phase 4**: bar becomes blocking — PR template enforced, audit script blocks CI.
- Rollback: each phase reverts independently.

## Tests

- Automated:
  - Primitive render tests assert `accessibilityRole` on every interactive child.
  - Audit script test fixture: a screen with a missing label fails the audit.
- Manual (per release):
  - VoiceOver pass on iOS for the home flow + one expansion feature.
  - TalkBack pass on Android for the same flows.
  - Dynamic Type at largest setting — no truncation, no clipped buttons.
  - Reduce Motion on — animations are instant or absent, navigation still works.
- Logged in `docs/RELEASE_SMOKE.md`.

## Risks

- **Engineer fatigue from the audit**: mitigated by inheriting the bar through primitives, so consumers don't repeat themselves.
- **Manual passes get skipped under deadline**: mitigated by the QA matrix ([brief 10](./10-mobile-qa-matrix.md)) elevating the pass to a release gate.
- **Dynamic Type breaks at extreme sizes**: design constraint; mitigation is to use scroll-on-overflow rather than truncate. Documented in the bar doc.
- **Cultural resistance** ("we don't have screen-reader users"): acknowledged. The bar exists because we cannot detect screen-reader users with confidence, and because the cost of getting accessibility right at primitive level is small.

## Dependencies

- [`05-reusable-expansion-ui-patterns.md`](./05-reusable-expansion-ui-patterns.md) is the embedding surface — the bar primarily applies through primitives.
- [`07-loading-error-empty-states.md`](./07-loading-error-empty-states.md) — error states must announce.
- `docs/QUIET_LUXURY_DOCTRINE.md` — contrast matrix and typography rules.
- No backend dependency.

## Operator handoff

- **Owning surface(s)**: `docs/ACCESSIBILITY_BAR.md`, `src/components/patterns/`, `scripts/accessibility-audit.js`.
- **Out-of-band steps**: none in the repo. The team commits to running VoiceOver + TalkBack passes per `docs/RELEASE_SMOKE.md` updates.
- **Done means**: a new screen built from primitives is bar-compliant by default; the engineer writing it spends near-zero extra effort on accessibility plumbing, and the audit reports zero findings on that screen.
