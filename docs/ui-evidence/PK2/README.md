# PK2 render evidence (Money AI pool, m#686)

**These are fixture-backed React Native Web renders, not iPhone or Android device proof.** Screen-reader behaviour, native Dynamic Type and physical haptics are not shown; device (TestFlight) checks remain a release step.

The captures mount the real code at commit `9707d5e20797211c3bf35cb385df17d244c0eb8c` (`MoneyAIPool.tsx` SHA-256 `5f096c93bb6916913527212141adf3a16f9a89519bcb10882d0585d348e4795d`, `MoneyScreen.tsx` SHA-256 `b5fbfc32da6c06c5c5cf2afddc90fa59ed5a50990a4f891bab42e4f2491aed45`), with the real theme, shared primitives, React Query, native stack, Cormorant and Inter fonts. Only the API client, Sentry, purchase surfaces, network status, haptics, CSV file, coach inbox and auth events are fixture stubs; every non-local request is blocked.

## States

| State | How it is drawn | 390 / default | 390 / 130% | 360 / default | 360 / 130% |
|---|---|---|---|---|---|
| Sold, Stripe live (default) | `MoneyScreen` as mounted for `CoachMoney`, budget $42 of $125 | [png](default-iphone390-100.png) | [png](default-iphone390-130.png) | [png](default-android360-100.png) | [png](default-android360-130.png) |
| Before Stripe is connected | the same with Connect status `not_started`; the buy entry turns quiet so Continue with Stripe stays the one filled button | [png](prestripe-iphone390-100.png) | [png](prestripe-iphone390-130.png) | [png](prestripe-android360-100.png) | [png](prestripe-android360-130.png) |
| Credit packs not sold in this build | `creditPacksHidden()` true; the pool shows usage with no buy entry | [png](notsold-iphone390-100.png) | [png](notsold-iphone390-130.png) | [png](notsold-android360-100.png) | [png](notsold-android360-130.png) |
| Sub-coach (billing run by the head coach) | summary returns `sub_coach_billing_blocked`; the pool still shows | [png](headcoach-iphone390-100.png) | [png](headcoach-iphone390-130.png) | [png](headcoach-android360-100.png) | [png](headcoach-android360-130.png) |
| Budget loading | budget request never answers | [png](loading-iphone390-100.png) | [png](loading-iphone390-130.png) | [png](loading-android360-100.png) | [png](loading-android360-130.png) |
| Budget failed to load | budget request returns 503 | [png](error-iphone390-100.png) | [png](error-iphone390-130.png) | [png](error-android360-100.png) | [png](error-android360-130.png) |
| Budget used up | $130 of $125; the bar is full | [png](full-iphone390-100.png) | [png](full-iphone390-130.png) | [png](full-android360-100.png) | [png](full-android360-130.png) |

Page end, showing the footer now ends at Packages (main's second Buy more credits row is gone): [default 390](default-iphone390-100-footer.png), [default 360](default-android360-100-footer.png), [not sold 390](notsold-iphone390-100-footer.png), [not sold 360](notsold-android360-100-footer.png).

[Contact sheet](contact-sheet.png): rows are default, before Stripe, not sold, sub-coach, loading, error and used up; columns are 390 default, 390 130%, 360 default and 360 130%.

- Viewports: 390 x 844 and 360 x 800 at 2x. The 130% captures multiply text size and line height only; this approximates native Dynamic Type.
- Measured in every capture: exactly one `money-buy-credits` in each sold state and none when packs are not sold; filled button 54 high, quiet link 44 high; no page errors.
- Spoken label: "Buy more AI credits" on the filled button; "Buy more credits" on the quiet link before Stripe (the shared quiet link has no separate label; see the PR body, Found, not fixed).
- The only clipped text is main's existing one-line attention title at 130% and at 360, not PK2 code. The loading skeleton is cream on a cream card (shared `Skeleton.tsx`; see Found, not fixed).
