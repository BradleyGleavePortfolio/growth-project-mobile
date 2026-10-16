# ROMANMARK-M1 component evidence

**Web renders are not iPhone or Android device proof.** These previews mount the actual MessageBubble, C3 Style B StyleBBubble, StyleBHeader and StyleBDayMark, RomanDraftMark (one frame for every thread bubble) and RomanDraftSheet from application source `5c955af0a031a525f64ffa04f381067dce57dae8` (fix round 1, FIX731), with fixture names Sam and Jordan, the existing portrait and bundled fonts. The implementation and approved wording are described in [PR 731](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/731).

An esbuild harness (react-native-web) supplies a light semantic theme, enabled preview flags, safe-area insets and silent haptics; no API is called. The header and composer outside the bubbles are harness stand-ins, not app screens. Font size and line height are multiplied by 1.3 for the 130% previews. Native focus handoff is deliberately a no-op in this web harness, not evidence of VoiceOver or TalkBack behavior.

## Preview matrix

Three sides: `clientB` (the client thread with C3 Style B on), `client` (the client thread on MessageBubble) and `coach` (the coach thread on MessageBubble), each at iPhone 390 × 844 and Android 360 × 800, at 100% and 130% text: 72 PNGs in total ([measurements](measurements.jsonl)).

| Variant | State | Filename pattern |
|---|---|---|
| thread | Mark before interaction | `{side}_thread_{device}_{scale}_mark.png` |
| thread | First tap: italic underlined line | `{side}_thread_{device}_{scale}_line.png` |
| thread | Tap on the line: explanation | `{side}_thread_{device}_{scale}_sheet.png` |
| thread | Same explanation with Reduce Motion | `{side}_thread_{device}_{scale}_sheet_reduced.png` |
| run | Three drafted messages, one mark each, then a typed message | `{side}_run_{device}_{scale}_mark.png` |
| long | Long drafted text, then the same text typed (equal widths) | `{side}_long_{device}_{scale}_mark.png` |

[Two-step contact sheet](contact-two-step.png) (mark, line, sheet) and [runs, long text and Reduce Motion contact sheet](contact-stress-motion.png): columns 390/100%, 390/130%, 360/100%, 360/130%; clientB rows, then client rows, then coach rows.

## Measured geometry

The [measurement records](measurements.jsonl) contain 96 measured marks: every graphic is 24 × 24 pt and every target 44 × 44 pt, the ring's top 8 pt above its own bubble's bottom edge, the target's bottom 18 pt below it, and the ring's centre 6 pt inside the inner edge. No ring touches thread text, no target overlaps another bubble or another target, no target or text is off screen or clipped, and there are no browser errors. Each ring centre resolves to its own mark in the web hit test. Times: on MessageBubble every bubble, marked or typed, holds exactly one time line inside it; in Style B every bubble, marked or typed, keeps its time outside, under the bubble, as C3 does. The long drafted and long typed bubbles measure the same width (`bubbleWidths`: 78% of the row on MessageBubble, 80% in Style B).

The source tests cover both screen adapters and Style B, excluded message kinds, the mark's tap and second tap, the line's tap, forwarded long press, spoken labels, all sheet dismissals and 250/150 ms motion. Device builds still need native hit-testing, VoiceOver/TalkBack focus, Android back, swipe, Dynamic Type and physical haptic verification before release; the default-off flag is not enabled by these previews ([PR 731](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/731)).
