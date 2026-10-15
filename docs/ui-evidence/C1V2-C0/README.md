# C1V2-C0 parts gallery

**These are React Native Web renders, not iPhone or Android device proof.** Native Dynamic Type, VoiceOver and TalkBack, and physical haptics are not shown; check on a TestFlight build before C3 ships the parts on a screen.

The gallery mounts the real `SegmentedRing`, `DayMark` and `PeakStar` from `src/ui/charts/StyleCMarks.tsx` at code commit `4692a7eb7e598ebb9e23f98d35085edc530eabec` (file SHA-256 `62cf78685a5caa3d927a87c5228c8ccea8f39f13633a4086c6f1014290792e4d`) with the real `lightTokens` and `darkTokens`. No screen uses the parts yet. Captions such as "Masthead", "Card", "2/4", "155 x 6 lb", "BEST EVER" and "Rest band: leaf ring only" and the fixture labels are gallery text, not app wording.

## Method

- Harness only (not committed), built from the op-143 esbuild screenshot tools: esbuild bundle through react-native-web; the theme hook returns the light or dark tokens by URL, because ThemeProvider is light-only at launch. Reduce Motion comes from the URL. Haptics and animation starts are counted, not played.
- Viewports: iPhone-size 390 x 844 and Android-size 360 x 800 at 2x, full page. 130% multiplies text size and line height only, honouring `maxFontSizeMultiplier` (DayMark numbers cap at 1.3).
- Clock is paused and stepped, so each frame is exact. Settled frames are taken at 1000 ms.

## Matrix

| Scheme | 390 / 100% | 390 / 130% | 360 / 100% | 360 / 130% |
|---|---|---|---|---|
| Light | [web-light-390-100](web-light-390-100.png) | [web-light-390-130](web-light-390-130.png) | [web-light-360-100](web-light-360-100.png) | [web-light-360-130](web-light-360-130.png) |
| Dark | [web-dark-390-100](web-dark-390-100.png) | [web-dark-390-130](web-dark-390-130.png) | [web-dark-360-100](web-dark-360-100.png) | [web-dark-360-130](web-dark-360-130.png) |

Motion (light, 390, 100%): [draw-in at 40 of 300 ms](web-motion-draw-40ms.png) shows the third segment of the large ring part drawing; [Reduce Motion at 25 of 150 ms](web-motion-reduce-fade-25ms.png) shows the whole segment fading in; [a return](web-motion-return-540ms.png) remounts the gallery at 500 ms with the same events, and 40 ms later the segment is already whole: the seen event mounts drawn, and the PNG is byte-identical to the settled web-light-390-100. [Contact sheet](contact-sheet.png): rows light, dark, motion.

Each page shows, top to bottom: the masthead (`onDark`) with a seven-day strip in every DayMark state (done, missed, done, today, planned, rest, planned), a 120 pt ring whose third segment draws in (its `event`), a 48 pt ring and a decorative star; then the page, a white card and a sage card with the light-ground marks, four history rings (4/4, 2/4 with a missed segment, 0/3, a one-session ring) and labelled stars; last, the rest band (`onBand`) with the leaf ring only, its one supported mark.

## Measurements

[measurements.jsonl](measurements.jsonl) has one line per capture (11): every part's size, role, label and `aria-hidden`, plus checks for parts off screen, page overflow, a DayMark number larger than its mark and clipped text. All 11 captures: no issues, no page errors, 0 haptics from the parts (the Send to Sam tap owns the success haptic) and 1 animation start, the large ring's event; the return capture still counts 1 after its remount. DayMark is 36 x 36 at both text sizes; the decorative star is `aria-hidden`; labelled stars and rings are `img` with their label. The parts are not tappable, so the 44 pt rule does not apply to them.

## Checksums

| File | SHA-256 |
|---|---|
| contact-sheet.png | `90f35ced0d62a743c492e3972000c3525ff9abf35649a3e187892b5ba5bdb428` |
| web-dark-360-100.png | `97607cc5b97b68c86e300093b3356d594187add68e21d5508db03c8319fbf38b` |
| web-dark-360-130.png | `9e5f46663f111838dba1007c66b227b64edfbfba3d0d8462fd97f20072280364` |
| web-dark-390-100.png | `07d333bc96beacf3d9df3e98be6fb83b6bbed26ac10f400cdac9d08a28c9e5e3` |
| web-dark-390-130.png | `98c951a558f9fdda66f86167a9b291d67431c8368a62be27b4c62bba524e565d` |
| web-light-360-100.png | `d9dbd53f86a1a6d38f9193f53c2a65ae9f29a02144f8ebe3ce329c5c47ab5f32` |
| web-light-360-130.png | `4e49d3984ff888b21cb6e972aeab2a475c376652aa699e68e3ac921d2db60006` |
| web-light-390-100.png | `9d97993b51cd981d6ebdb24952e1c5a40f1106d67887060efeb5e28804c3d606` |
| web-light-390-130.png | `515e500520b6ef99536223f1b4510f9c707fec2fdbb413ded5c348123713edd5` |
| web-motion-draw-40ms.png | `c69e3fbe832d3a08ae7ae2b90688ed075e6ec66c0d28d590767e592b4acf843f` |
| web-motion-reduce-fade-25ms.png | `d49a756888d72ed6a34fde68d4b7b14611d6813cbe7c8bf2aba30879b9ca4a82` |
| web-motion-return-540ms.png | `9d97993b51cd981d6ebdb24952e1c5a40f1106d67887060efeb5e28804c3d606` |
| measurements.jsonl | `cc37d9863a0307f1cdcc40715124fe9e0b2953661055e57209665e3b5bcd5388` |
