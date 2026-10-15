# C4LOCKM real-screen render evidence

**These are fixture-backed React Native Web renders, not iPhone or Android device proof.** Native navigation chrome, OS calendar presentation, screen-reader behavior and physical haptics are not shown; native/TestFlight verification remains a release step.

The captures mount the real `CalendarSessionScreen` from code head `23f0fb362c9bf56a4cfafcbbe3bcf49ed8e0d9c6` for [mobile PR #713](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/713), with the real React Query hooks, scheduling adapter, theme, shared primitives, Cormorant and Inter fonts.

Screen source SHA-256: `7a19582e2f5b8f8fe2926c266234c679f894f82761ce4ad447676338baab5b79`.

## Fixture and capture method

- Clock: `2030-10-07T16:00:00.000Z`; device timezone: America/Los_Angeles; fixture coach: Bradley, America/New_York.
- All three fixtures are live, confirmed, 20-minute sessions with no call link or recap. Locked: start +23 hours, both change flags false. Started: start -6 minutes, both flags false. Changeable: start +25 hours, both flags true.
- Local fixture transport replaces only the API transport; identity, error reporting and OS calendar access are isolated. Every non-local browser request is blocked. No customer or production data is used.
- Viewports: iPhone-size 390 x 844 and Android-size 360 x 800, captured at 2x pixel density. The 130% captures multiply text font size, line height and letter spacing only; viewport and layout dimensions are unchanged. This is a web approximation, not native Dynamic Type.
- Navigation is an isolated context, not the full app navigator. The captured Message your coach handler emits `Home`, `{ screen: 'Messages' }`; the running screen tests also assert this destination. Static inspection confirms the real CalendarBook and Home > Messages registrations in ClientNavigator; screen tests separately exercise reschedule navigation/submission, confirmed cancel, calendar export and Join in [PR #713](https://github.com/BradleyGleavePortfolio/growth-project-mobile/pull/713).
- The phone-size image is followed by a provenance strip outside the captured viewport. No screen text or style was replaced for the images.

## Matrix

| State | 390 / default | 390 / 130% | 360 / default | 360 / 130% |
|---|---|---|---|---|
| Locked | [top](web-locked-390-100.png) | [top](web-locked-390-130.png) | [top](web-locked-360-100.png) | [top](web-locked-360-130.png), [scrolled](web-locked-360-130-scrolled.png) |
| Started | [top](web-started-390-100.png) | [top](web-started-390-130.png) | [top](web-started-360-100.png) | [top](web-started-360-130.png), [scrolled](web-started-360-130-scrolled.png) |
| Changeable | [top](web-changeable-390-100.png) | [top](web-changeable-390-130.png) | [top](web-changeable-360-100.png) | [top](web-changeable-360-130.png), [scrolled](web-changeable-360-130-scrolled.png) |

[Contact sheet](contact-sheet.png): columns are 390 default, 390 130%, 360 default and 360 130%; rows are locked, started and changeable. The last column uses the scrolled view.

## Contrast and tap targets

The [measurements](measurements.jsonl) record all 12 combinations, fixture inputs, note text/color, control bounds, scroll extents and Message route emission.

- Both existing notes use `textMuted` #6B675F on `bgPrimary` #F5EFE4: calculated contrast **4.9187:1**, above the 4.5:1 body-text requirement; primary ink #1A1A18 on the same background is **15.2293:1**. The notes are 14 px at default and 18.2 px in the 130% web approximation.
- Full action rows measure **342 x 56** at 390 and **312 x 56** at 360 by default; at 130% they grow to **61.59 px** high. No measured target is below 44 x 44.
- No clipped text, horizontal overflow or page errors were detected. At 360/130%, content is 843–844 px high in the 800 px viewport; the existing ScrollView reaches the complete final row, as shown in the additional captures.
- Locked and started show only their respective unchanged note and hide Reschedule/Cancel; changeable shows neither note and retains both actions. Add to calendar and Message your coach remain available.

These observations apply to the fixture-backed web surface only, not to real-device accessibility or platform integration; the corresponding behavior tests passed in [GitHub CI at code head 23f0fb36](https://github.com/BradleyGleavePortfolio/growth-project-mobile/actions/runs/38646476579/job/116134457566).

## Design training application

Read in full: yes. Training 2.2 CALM clarity, 4.2 cognitive load, 4.7 consistency, 5.1 screen protocol and 6.2 master checklist apply: preserve the restrained existing note, show the correct reason, keep the existing next step and validate wrapping/targets without new copy, layout, color, radius, motion or haptic choices.

Ship mobile PR #713 with or before [backend #1010](https://github.com/BradleyGleavePortfolio/growth-project-backend/pull/1010); this evidence does not authorize deployment.
