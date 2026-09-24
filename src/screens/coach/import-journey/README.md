# Roman importer — private P1 presentation

Controlled leaf views only. **Not registered, production-reachable, integrated,
reviewed, or product-accepted.** This directory does not replace the live importer.
The test host is confined to `__tests__/ImportJourney.navigation.test.tsx`.

## Inputs and ownership

- `ImportOfferCard`: `question`, `value`, or compact `resume`; explicit
  `romanEnabled`, optional `addressForm` (neutral by default); separate host
  callbacks. `sir` only changes the question when Roman is enabled. First-person
  action labels are the coach's choices, not Roman's claims. Roman-off removes
  the portrait. No component owns eligibility or a persisted offer decision.
- `ImportSetupView`: `source`, `customSource`, or instructional
  `computerHandoff`. Selection, custom text and feedback are controlled inputs.
  `validation="invalid"` requests feedback after blur; validity/Continue uses
  the unchanged `safeImportLoginUrl`. It is format feedback, not compatibility,
  DNS resolution, origin permission, credential safety or migration authority.
- Selecting a row invokes `onSourceChange(id)` only. The test host switches to
  `customSource` when Custom / Other is selected; a source view with Custom
  selected can Continue back to that input. The host determines Back behavior
  and preserves selection/text. Header Back only calls `onBack`; a future
  authorized host must bind hardware/gesture Back to that same callback.
- Handoff uses the existing catalog's human label (including Custom / Other),
  never the custom URL/path/query. It renders three instructions and Back/Later
  only. No issued link, code, waiting state, saved preference or completion is
  invented. `onLater` does not mean a preference was saved.
- `focusOnMount` defaults false. Set it only for explicit user entry. A controlled
  step/variant change requests heading accessibility focus once; same-state
  rerenders do not. Real VoiceOver/TalkBack behavior still needs device proof.
- `ImportOfferCard` expects a scrollable host. `ImportSetupView` owns a single
  scroll area, keyboard avoidance and safe-area/header spacing. Mount it in a
  `SafeAreaProvider` with no second consuming header/inset wrapper. The app's
  existing font/theme providers remain host responsibilities; this module does
  not mount identity/preferences providers. URL text remains LTR; surrounding
  spacing uses start/end and respects RTL safe-area ordering.

`importJourneyUI.tsx` contains only shared leaf styling, actions, portrait and
heading-focus behavior. It introduces no task/provider/store architecture.
English copy is centralized in `i18n/en.json` with typed lookup and a typed sole
placeholder; initial English-only authoring is not translation coverage. There
are no P1 counters/plurals because run/result presentation is not this slice.

## Reused inputs

[Mobile base a5933fd](https://github.com/BradleyGleavePortfolio/growth-project-mobile/commit/a5933fd6de5616493de75f0db907098b149b955c):
`RomanAvatar` neutral/48 and bundled fallback; `theme/useTheme` semantic colors;
`theme/tokens` spacing, typography, forest/pressed fill and geometry;
`constants/importPlatforms`; `utils/safeImportLoginUrl`; feature-local typed
English lookup convention from `screens/day-one/i18n/strings.ts`.

[Canonical G01–G22](https://github.com/BradleyGleavePortfolio/tgp-agent-context/blob/160928b98c57a6034cd8b7bcfba537e81c63f054/AGENT_RULES.md)
supersedes stale generic quota/review ceremony in mobile doctrine. The approved
P1 mandate deliberately leaves these leaves unreachable and confines module
documentation here; it does not authorize navigator or shared README changes.

## Verification

```sh
npm test -- --runInBand src/screens/coach/import-journey/__tests__
npx --no-install eslint src/screens/coach/import-journey --ext .ts,.tsx
npm run typecheck
git diff --check
```

Tests target controlled callback isolation, all local traversal/actions,
header/hardware Back, catalog names/selection, invalid and valid custom input,
exact copy, explicit voice, monogram fallback, minimum target declarations,
focus styles, actual semantic contrast pairs, and scalable trees under width,
font-scale, RTL and +40% pseudo-copy fixtures. Shared CJS test guards throw on
known API/pairing/auth/storage/analytics/Linking/Clipboard/Share/network calls;
a negative control verifies those guards. The theme hook is injected, not a live
identity/preferences provider. Guards are not a claim about the existing app's
provider initialization or every possible native side effect.

Verification completed on the unchanged committed lock with CI's Node 22.13.0:
focused RNTL/Jest (4 suites, 69 tests), scoped repository ESLint and whole-repo
TypeScript pass. Initial missing-tool/global-ESLint failures were environment
failures, not a broken committed lock; `npm ci --ignore-scripts --no-audit --no-fund`
succeeded without manifest or lock changes. See the external handoff evidence
for exact commands, versions, exits and intermediate builder fixes.

An external test-only harness rendered these actual TSX components using the
installed React Native Web adapter, real fonts/assets, an injected theme hook
and zero safe-area insets. Chromium checks at 320/375/430, light/dark and CSS
1x/2x text found no measured horizontal overflow or sub-48px targets; final
actions remained scroll-reachable. Representative screenshots include RTL and
Roman-off. Local rendered traversal also passes. CSS doubled text is **not**
native OS 200% text, and browser geometry is **not** Yoga/device proof. The hook
skips `findNodeHandle` on web because RNWeb throws for that native-only API;
web heading-focus equivalence is not claimed. Native focus-request policy is
unit-tested with mocked handles, not delivered to a real screen reader.

**Unverified hold:** native 320/375/430 layout, OS 200% text, iOS/Android keyboard
avoidance, notches/landscape, native RTL and pseudo-localization clipping,
VoiceOver/TalkBack order/focus/announcements, and reduced-motion device behavior
remain pending. No emulator or physical-device screenshots are claimed. The
Tier 1 independent review is also pending. This is a private source candidate,
not integrated functionality, product acceptance or release authorization.
