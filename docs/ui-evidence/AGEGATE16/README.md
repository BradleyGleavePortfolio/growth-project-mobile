# AGEGATE16 render evidence (age step)

**These are fixture-backed React Native Web renders, not iPhone or Android device proof.** Native wheel scrolling, the system "Couldn't save" alert, screen-reader behavior and physical haptics are not shown; device (TestFlight) checks remain a release step.

The captures mount the real code at commit `24eec5104466ad9a4de0aad5cb64d4a94e93551a` (`AgeCheckScreen.tsx` SHA-256 `c7e000f677792bc0d04c66564bc87b755644dad1afee3b04c57903a7721a78fb`), with the real `QuestionScreen`, wheels, theme, shared primitives, Cormorant and Inter fonts. Only the API client, user cache, logger and haptics are fixture stubs; every non-local request is blocked.

## States

| State | How it is drawn | 390 / default | 390 / 130% | 360 / default | 360 / 130% |
|---|---|---|---|---|---|
| Asked (default wheels) | `AgeCheckScreen` as mounted by RootNavigator `'age_check'` | [png](ask-iphone390-100.png) | [png](ask-iphone390-130.png) | [png](ask-android360-100.png) | [png](ask-android360-130.png) |
| Under-16 date on the wheels | `QuestionScreen` with the age step's own screen (B2 without its chapter eyebrow) and a date 14 years back preset, because web wheels cannot be dragged | [png](under16-wheels-iphone390-100.png) | [png](under16-wheels-iphone390-130.png) | [png](under16-wheels-android360-100.png) | [png](under16-wheels-android360-130.png) |
| Under-16 stop (prototype 45) | the same, after a real click on Continue | [png](under16-stop-iphone390-100.png) | [png](under16-stop-iphone390-130.png) | [png](under16-stop-android360-100.png) | [png](under16-stop-android360-130.png) |

[Contact sheet](contact-sheet.png): rows are asked, under-16 wheels and under-16 stop; columns are 390 default, 390 130%, 360 default and 360 130%.

- Viewports: 390 x 844 and 360 x 800 at 2x. The 130% captures multiply text size, line height and letter spacing only; this approximates native Dynamic Type.
- Measured in every capture: no clipped text, Continue and "Change my date of birth" fully on screen, Continue 342 x 54 (390) and 312 x 54 (360), "Change my date of birth" the same, Back 44 x 44, no page errors.
- The failed-save state is the existing system alert ("Couldn't save" with the Edit profile message); React Native Web does not draw native alerts, so it is covered by `AgeCheckScreen.test.tsx` instead.
