# Onboarding screens

Two flows live here. Only one is active at a time, and `RootNavigator` decides which one a new client sees.

- **Lean (4 screens, < 90 s)** — `LeanQ1`, `LeanQ2`, `LeanQ3`, `LeanQ4`. Default for new accounts. Optimised for time-to-first-win, not data completeness. Drives the activation funnel tracked in PostHog. `LeanQ4` is the optional body-metric capture step — height + current weight, imperial / metric toggle, both fields independently skippable. The legacy 10-step flow is **not** reintroduced; LeanQ4 exists so Home renders without macro blanks for users who do enter their weight.
- **Long (10 steps)** — `OnboardingStep1`–`OnboardingStep10` plus `OnboardingResults`. Kept intact for the legacy `OnboardingNavigator`, used by accounts whose `onboarding_complete` flag predates the lean flow. Not reachable from a fresh signup today.

Both flows write to the same AsyncStorage key (`onboarding_data`) via `utils/onboardingStore.ts`. Whatever the user enters is sent to the backend as a single `PUT /profile` payload at the end.

## Purpose

- Capture just enough about a new client to populate calorie / macro targets and route them to a sensible Home tab on first open.
- Do it without making the screen feel like a form. The lean flow uses three large tap-only choices per screen with a brand serif headline.
- Emit the analytics events that the activation dashboard depends on: `onboarding_started`, `onboarding_step_completed`, `onboarding_skipped`, `onboarding_completed`.
- End by setting `onboarding_complete=true` in AsyncStorage and emitting `authEvents.emit()` so `RootNavigator` re-bootstraps and the user lands on Home.

## Key files

| File | What it does |
| --- | --- |
| `LeanQ1GoalScreen.tsx` | Goal — lose / build / maintain. First screen, fires `onboarding_started`. |
| `LeanQ2ExperienceScreen.tsx` | Self-rated experience level. |
| `LeanQ3IntentScreen.tsx` | Intent — what they want from the app (track, learn, accountability). Routes onward to `LeanQ4` (formerly the final screen; no longer marks the flow complete itself). |
| `LeanQ4MetricsScreen.tsx` | Body-metric capture: height + current weight, imperial / metric toggle, both fields skippable. Persists `currentWeight` (kg) and `heightCm` to the onboarding store. Final screen — calls `markOnboardingComplete` when the user continues or skips. |
| `OnboardingStep1.tsx`–`OnboardingStep10.tsx` | Long-flow steps: name & sex, dob, weights, activity, goal, eating habits, diet type, restrictions, gym/fitness level, snacks. |
| `OnboardingResults.tsx` | TDEE / target preview that closes the long flow. |

The visual chrome lives in `components/OnboardingLayout.tsx` (header, progress, continue button). Each lean screen draws its own layout because the lean flow does not show progress dots in the same shape — only a 3-dot indicator.

## Data flow

```
LeanQ1 ─► saveOnboardingData({ primaryGoal })           ┐
LeanQ2 ─► saveOnboardingData({ fitnessLevel })          ├─ AsyncStorage('onboarding_data')
LeanQ3 ─► saveOnboardingData({ intent })                │
LeanQ4 ─► saveOnboardingData({ heightCm?, currentWeight? }) ┘   // both optional, imperial→metric conversion
        ─► AsyncStorage.setItem('onboarding_complete', 'true')
        ─► AsyncStorage.setItem('lean_onboarding_intent', intent)
        ─► authEvents.emit()           // root re-bootstraps
        ─► RootNavigator routes to ClientNavigator (Home)
```

The backend is updated lazily on the first authenticated screen that calls `profileApi.update`, not from inside the onboarding flow itself. This keeps onboarding fully offline-tolerant — a user with flaky network still finishes the flow.

## App-store / deep-link dependencies

None. Onboarding is post-auth and is not addressable from a deep link. The only navigation in is `RootNavigator` deciding `authState === 'onboarding'`.

## Security and tenancy

- Nothing the user enters here is sensitive. Names, weights, and goals are stored locally in AsyncStorage and synced when the next authenticated request runs.
- The flow never touches the JWT or refresh token. It runs entirely between the auth check and the first profile sync.
- A returning user with a stored profile (`profileDone === true` from the backend) skips this flow even if the local `onboarding_complete` flag is missing — `RootNavigator` reconciles the two sources before deciding.

## Environment variables

None. The screens are env-free; the `profileApi.update` call inherits whatever `EXPO_PUBLIC_API_URL` the rest of the app uses.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| User finishes lean flow but lands back on Q1 next launch | `markOnboardingComplete` succeeded in AsyncStorage but the root listener missed the emit | Pull-to-refresh / restart app — `RootNavigator.bootstrapAuth` re-reads the flag. |
| Long-flow step writes are missing on Results screen | AsyncStorage write race during quick tapping | The Results screen reads `getOnboardingData()` once on mount; harmless because the next profile-sync uses the latest stored snapshot. |
| Stuck on lean flow after a 10-step legacy account upgraded | Backend `profile.onboarding_completed = true` but no local `onboarding_complete` | `RootNavigator` writes the local flag once it reads the backend response, then re-bootstraps. |

## Tests

The flows are covered indirectly by the smoke matrix (`docs/RELEASE_SMOKE.md`). The 4-screen lean navigator has explicit guards in `src/screens/onboarding/__tests__/leanOnboardingFlow.test.ts` — it asserts the route list, the LeanQ3 → LeanQ4 transition, that LeanQ4 writes the optional metrics to the onboarding store, and the imperial → metric conversion arithmetic. Unit tests live for the underlying helpers in `utils/onboardingStore.ts` (read/write round-trip).

```bash
npm test
```

## Release notes

- Reviewers reaching this flow will see the lean 4-screen version. They can tap through it in under 90 seconds, with `LeanQ4` either skipped wholesale or filled in either unit system. The analytics events fire silently. No screenshots in the listing should show the long flow — it is not the new-user experience.
- The "Skip" affordance on `LeanQ1` writes `lean_onboarding_intent: 'explore'` and bypasses the rest of the flow. This is intentional — Play guidelines disallow forcing data entry before letting a user explore the app.
- `LeanQ4` skips both fields independently. A user who fills neither is fine — Home renders **Log to see** prompts in the macro grid (see `src/screens/client/__tests__/homeMacroDisplay.test.ts`). A user who fills weight but skips height is also fine; the missing field is sent as `null` and the backend recomputes targets when it can.
- If the activation funnel ever needs to be replaced by a different first-run experience, the change is a one-line route swap in `navigation/RootNavigator.tsx` (`LeanOnboardingNavigator` → something else); the legacy `OnboardingNavigator` is preserved as a known-good fallback.
