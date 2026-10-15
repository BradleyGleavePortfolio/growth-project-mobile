# C1V2-C0 parts gallery

**These are React Native Web renders, not iPhone or Android device proof.** Native Dynamic Type, VoiceOver and TalkBack, and physical haptics are not shown; check on a TestFlight build before C3 ships the parts on a screen.

The gallery mounts the real `SegmentedRing`, `DayMark` and `PeakStar` from `src/ui/charts/StyleCMarks.tsx` at code commit `b3c1946a62eeae933193b7c5a05ea5fbc376f513` (file SHA-256 `d0197907ea58b05a50647cbeb3507c748f20fabe60981e8be1bb01ee43059ca8`) with the real `lightTokens` and `darkTokens`. No screen uses the parts yet. Captions such as "Masthead", "Card", "2/4", "155 x 6 lb" and "BEST EVER" and the fixture labels are gallery text, not app wording.

## Method

- Harness only (not committed): esbuild bundle through react-native-web; the theme hook returns the light or dark tokens by URL, because ThemeProvider is light-only at launch. Reduce Motion comes from the URL; the haptic is counted, not played.
- Viewports: iPhone-size 390 x 844 and Android-size 360 x 800 at 2x, full page. 130% multiplies text size and line height only, honouring `maxFontSizeMultiplier` (DayMark numbers cap at 1.3).
- Clock is paused and stepped, so each frame is exact. Settled frames are taken at 1000 ms.

## Matrix

| Scheme | 390 / 100% | 390 / 130% | 360 / 100% | 360 / 130% |
|---|---|---|---|---|
| Light | [web-light-390-100](web-light-390-100.png) | [web-light-390-130](web-light-390-130.png) | [web-light-360-100](web-light-360-100.png) | [web-light-360-130](web-light-360-130.png) |
| Dark | [web-dark-390-100](web-dark-390-100.png) | [web-dark-390-130](web-dark-390-130.png) | [web-dark-360-100](web-dark-360-100.png) | [web-dark-360-130](web-dark-360-130.png) |

Motion (light, 390, 100%): [draw-in at 40 of 300 ms](web-motion-draw-40ms.png) shows the third segment of the large ring part drawn; [Reduce Motion at 25 of 150 ms](web-motion-reduce-fade-25ms.png) shows the whole segment fading in. [Contact sheet](contact-sheet.png): rows light, dark, motion.

Each page shows, top to bottom: the masthead (`onDark`) with a seven-day strip in every DayMark state (done, missed, done, today, planned, rest, planned), a 120 pt ring whose third segment draws in, a 48 pt ring and a decorative star; then the page, a card, a sage card and the forest band with the light-ground marks, four history rings (4/4, 2/4 with a missed segment, 0/3, a one-session ring) and labelled stars.

FIX718: the last row's ring on the forest band is no longer a supported pairing (its planned arc is 2.89:1, under 3:1); the parts take `onDark` on the masthead only. The fix round changed no drawn pixel on any supported pairing (event-keyed motion, no haptic in the parts, internal test IDs removed), so these renders stand.

## Measurements

[measurements.jsonl](measurements.jsonl) has one line per capture (10): every part's size, role, label and `aria-hidden`, plus checks for parts off screen, page overflow, a DayMark number larger than its mark and clipped text. All 10 captures: no issues, no page errors, one success haptic per page (the drawing ring, before FIX718 moved the haptic to the Send handler). DayMark is 36 x 36 at both text sizes; the decorative star is `aria-hidden`; labelled stars and rings are `img` with their label. The parts are not tappable, so the 44 pt rule does not apply to them.
