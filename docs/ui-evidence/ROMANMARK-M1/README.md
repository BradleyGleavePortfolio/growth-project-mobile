# ROMANMARK-M1 component evidence

**Web renders are not iPhone or Android device proof.** These previews mount the actual shared MessageBubble, RomanDraftMark and RomanDraftSheet from application source `2583e9710845899028b39960f8f79555ac53e857`, with fixture names Sam and Jordan, the existing portrait and bundled fonts. The implementation and approved wording are described in [PR 731](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/731).

The op-143 esbuild harness supplies a light semantic theme, enabled preview flag, safe-area inset and silent haptics; no API is called. Font size and line height are multiplied by 1.3 for the 130% previews. Native focus handoff is deliberately a no-op in this web harness, not evidence of VoiceOver or TalkBack behavior.

## Preview matrix

Every row has client and coach versions, each at iPhone 390 × 844 and Android 360 × 800, at 100% and 130% text: 48 PNGs in total ([measurements](measurements.jsonl)).

| Variant | State | Filename pattern |
|---|---|---|
| thread | Mark before interaction | `{side}_thread_{device}_{scale}_mark.png` |
| thread | First tap: italic underlined line | `{side}_thread_{device}_{scale}_line.png` |
| thread | Second tap: explanation | `{side}_thread_{device}_{scale}_sheet.png` |
| thread | Same explanation with Reduce Motion | `{side}_thread_{device}_{scale}_sheet_reduced.png` |
| run | Three drafted messages, one mark each, then a typed message | `{side}_run_{device}_{scale}_mark.png` |
| long | Long drafted text, then a typed message | `{side}_long_{device}_{scale}_mark.png` |

[Two-step contact sheet](contact-two-step.png) and [runs, long text and Reduce Motion contact sheet](contact-stress-motion.png): columns 390/100%, 390/130%, 360/100%, 360/130%; client rows followed by coach rows.

## Measured geometry

The [measurement records](measurements.jsonl) contain 48 measured marks: all graphics are 24 × 24 pt and all targets 44 × 44 pt, with the target's bottom 18 pt below the bubble, the ring's top 8 pt above it, and its center 6 pt inside the inner edge. Targets stay inside the padded native parent. There are no reported intersections with message text, another bubble or another mark target, no offscreen targets, no clipped text and no browser errors. Each visible ring center resolves to its actual Pressable in the web hit test.

The source tests cover both screen adapters, excluded message kinds, the two taps, forwarded long press, spoken labels, all sheet dismissals and 250/150 ms motion. Device builds still need native hit-testing, VoiceOver/TalkBack focus, Android back, swipe, Dynamic Type and physical haptic verification before release; the default-off flag is not enabled by these previews ([PR 731](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/731)).
