# FIRSTWIN-MEAL — saved-log follow-up states

Phone-size **React Native Web fixtures, not device proof** for [PR #716](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/716).

## Provenance

- Render source: `e34c08a9e28282dcf7144caf5e05284de45df2c4`, after the clean merge of main `6a7fddd603d7bfce741b91425ed782caef40b76e`.
- Original behaviour head: `e0b870c01b70f12e7f0c0fab9b022733b50485b9`; this evidence round makes no application-source or test changes.
- The real Day1WinScreen, LogScreen, ProgressScreen, HabitsScreen, food components, theme and client store are bundled from that worktree. The 63 bundled source-input hashes, plus RootNavigator/ClientNavigator as composition references (not mounted), are in `source-manifest.sha256`.
- Adapted from `handoffs/op-143/screenshot-tools/esbuild-harness/` and its capture/contact-sheet patterns. Shared mobile dependencies, real Inter/Cormorant fonts and Ionicons glyphs.
- Fictional in-memory API responses only; external network blocked. Fixed fictional day: 14 October 2026. The note paragraphs are synthetic response data, not new shipped wording.
- PNGs are RGB, losslessly optimised, at 390 × 844 (iPhone viewport) and 360 × 800 (Android viewport), with 100% and 130% text. Contact sheets are reduced previews; individual PNGs preserve the viewport dimensions.

## Contact sheets

| Viewport | 100% text | 130% text |
|---|---|---|
| iPhone 390 × 844 | [Contact sheet](contact-sheet-iphone-100.png) | [Contact sheet](contact-sheet-iphone-130.png) |
| Android 360 × 800 | [Contact sheet](contact-sheet-android-100.png) | [Contact sheet](contact-sheet-android-130.png) |

188 captures and four contact sheets; zero captured page-runtime errors. Every capture carries a harness-only “WEB FIXTURE · NOT DEVICE PROOF” footer, not app copy. Each measurement row names its PNG, flow, viewport, text scale, fixture identity, visible controls, detected horizontal clipping, note calls, writes and logger mounts.

## State map

Filenames: `<iphone|android>-<100|130>-<coached|coachless>-<meal|weight|habit>-<state>.png`.

| State / journey | Capture suffixes |
|---|---|
| Existing selection, including scrolled footer at 130% | `01-selection`, `02-selection-footer` |
| Dinner search and portion before a saved meal | `03-dinner-search`, `04-portion` |
| Saved-note loading for meal, weight and habit | `05-note-loading` |
| First failure, real alert title/message in a labelled web shell | `06-failure-alert-fixture`, `07-first-failure` |
| Card tap retries only the already-saved action | `08-retry-loading` |
| Two failures expose the existing escape action; scrolled into view | `09-continue-anyway` |
| Successful note for each saved action | `10-note-success` |
| Continue reveals the same Dinner/search and existing success line | `11-retained-dinner-search` |
| A second food does not request another first-win note | `12-second-food-no-note` |
| Done returns to the log and the saved Dinner foods | `13-done-feedback`, `14-dinner-saved-foods` |
| Escape controls return to the same saved meal | `continue-anyway-returned-dinner`, `skip-returned-dinner` |
| Manual entry, note and returned inline feedback | `manual-entry`, `manual-note-success`, `manual-retained-feedback` |
| Repeat past meal, note and returned inline feedback | `repeat-ready`, `repeat-note-success`, `repeat-retained-feedback` |
| Weight entry and returned saved weigh-in | `weight-entry`, `weight-return` |
| Habit before tick and returned completed habit | `habit-before-tick`, `habit-return` |

The coached meal fixture exercises failure/retry/recovery; the coachless meal fixture exercises immediate note success with exactly one note request. Weight and habit fixtures also exercise failure/retry before returning. Fixture identities do not prove entitlement differences.

## What this evidence does not prove

This harness reproduces RootNavigator's retained/hide/suspend composition; it does **not** bootstrap the real RootNavigator, ClientNavigator, auth or package purchase flow. Package offer is disabled in the fixture. These are viewport layouts, not native iOS/Android rendering.

130% text is a React Native Web approximation: the wrapper scales text/input sizes and line heights, including newly mounted states, while respecting text opt-outs/caps. Web safe-area behaviour, focus outline, image fallback and modal rendering are not native device behaviour.

Native Alert is unavailable on web; the labelled shell displays the unmodified title/message supplied by the real screen, without claiming native dialog layout. Keyboard, haptics, OS back/deep links, native sheet dismissal/resume, actual API writes and TestFlight require device verification.

The existing Skip target and food-search layout are not changed by this round. Measurements may report existing small controls or horizontal overflow at large text; this evidence does not claim an accessibility or device sign-off.
