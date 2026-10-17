# SAFETYWORDS-M render evidence

**These are fixture-backed React Native Web renders, not iPhone or Android device proof.** Native navigation chrome, Dynamic Type, screen-reader behaviour and physical haptics are not shown; checking on a TestFlight / internal build stays a release step.

The captures mount the real `CoachSafetyAlertScreen` and `ActionQueueScreen` (with the real `AlertRow`, `src/ui` primitives, theme, Cormorant and Inter fonts) from code head `95aacf6e04e3511522f6a08ec590a8f993b8d4c0`. Only the API transport, logger and haptics are local stubs; every non-local browser request is blocked. People are fictional (Maya Collins, Jordan Reyes). The urgent card's client message is a described placeholder, not a sample message.

## Matrix

| State | 390 x 844 / 100% | 390 x 844 / 130% | 360 x 800 / 100% | 360 x 800 / 130% |
|---|---|---|---|---|
| Crisis alert screen (`roman_crisis_reply`) | [png](crisis-iphone390-100.png) | [png](crisis-iphone390-130.png) | [png](crisis-android360-100.png) | [png](crisis-android360-130.png) |
| Actions list: crisis card above an urgent card | [png](list-iphone390-100.png) | [png](list-iphone390-130.png) | [png](list-android360-100.png) | [png](list-android360-130.png) |
| Urgent alert screen (C6a line) | [png](urgent-iphone390-100.png) | [png](urgent-iphone390-130.png) | [png](urgent-android360-100.png) | [png](urgent-android360-130.png) |

[Contact sheet](contact-sheet.png): columns 390 100%, 390 130%, 360 100%, 360 130%; rows crisis screen, list, urgent screen.

The 130% captures multiply text size, line height and letter spacing only; the viewport and layout stay at their point size. This is a web approximation of large text, not native Dynamic Type.

## What the measurements show ([measurements.jsonl](measurements.jsonl))

- The crisis screen and the crisis card show no quote block in all 8 crisis captures (`quoteShown: false`).
- The crisis line reads "Roman sent Maya a crisis safety reply. Please check in with them today." on the screen and the card, in full at 130% (the card's line 1 is no longer cut after three lines).
- Message {first name}: 342 x 54 at 390 and 312 x 54 at 360. Back: 44 x 44. Safety cards: 358 or 328 wide, 102 to 223 high (the whole card is the tap target).
- No clipped text, horizontal overflow or page errors in any of the 12 captures.
- The existing Dismiss text control is 75 x 21 (93 x 25 at 130%) plus an 8 pt hit slop on each side, so its touch area is under 44 pt tall. Unchanged by this PR; listed under "Found, not fixed".

The K3 change is the body of a native system dialog (`Alert.alert`), which React Native Web does not draw; its exact text is pinned by `src/screens/coach/programs/__tests__/programsScreens.test.tsx`.
