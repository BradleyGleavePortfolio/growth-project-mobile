# Onboarding screens

Two flows live here. Only one is active at a time, and `RootNavigator` decides which one a new client sees.

- **Lean (3 questions, < 60 s)** — `LeanQ1`, `LeanQ2`, `LeanQ3`. Default for new accounts. Optimised for time-to-first-win, not data completeness. Drives the activation funnel tracked in PostHog.
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
| `LeanQ3IntentScreen.tsx` | Intent — what they want from the app (track, learn, accountability). Final screen calls `markOnboardingComplete`. |
| `OnboardingStep1.tsx`–`OnboardingStep10.tsx` | Long-flow steps: name & sex, dob, weights, activity, goal, eating habits, diet type, restrictions, gym/fitness level, snacks. |
| `OnboardingResults.tsx` | TDEE / target preview that closes the long flow. |

The visual chrome lives in `components/OnboardingLayout.tsx` (header, progress, continue button). Each lean screen draws its own layout because the lean flow does not show progress dots in the same shape — only a 3-dot indicator.

## Data flow

```
LeanQ1 ─► saveOnboardingData({ primaryGoal })           ┐
LeanQ2 ─► saveOnboardingData({ fitnessLevel })          ├─ AsyncStorage('onboarding_data')
LeanQ3 ─► saveOnboardingData({ ... })                   ┘
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

The flows are covered indirectly by the smoke matrix (`docs/RELEASE_SMOKE.md`). There are no jest tests for these screens because the value proposition is the layout and the analytics fan-out, both of which are better validated on a real build. Unit tests live for the underlying helpers in `utils/onboardingStore.ts` (read/write round-trip).

```bash
npm test
```

## Release notes

- Reviewers reaching this flow will see the lean 3-question version. They can tap through it in under 30 seconds; the analytics events fire silently. No screenshots in the listing should show the long flow — it is not the new-user experience.
- The "Skip" affordance on `LeanQ1` writes `lean_onboarding_intent: 'explore'` and bypasses the rest of the flow. This is intentional — Play guidelines disallow forcing data entry before letting a user explore the app.
- If the activation funnel ever needs to be replaced by a different first-run experience, the change is a one-line route swap in `navigation/RootNavigator.tsx` (`LeanOnboardingNavigator` → something else); the legacy `OnboardingNavigator` is preserved as a known-good fallback.
