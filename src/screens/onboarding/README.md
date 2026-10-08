# Onboarding screens

Two flows live here. Only one is active at a time, and `RootNavigator` decides which one a new client sees.

With the consultation flag on, clients whose server onboarding state does not report `consultation_available: false` get `src/screens/consultation/` instead. Coachless clients and clients whose coach has no clinic program set use lean onboarding.

- **Lean (6 screens)** — `LeanQ1`–`LeanQ6`, with one truthful `Step n of 6` label per screen. Q4 collects optional sex, height and current weight; Q5 collects an explicitly chosen birth year and optional target weight; Q6 saves dietary preferences and finishes.
- **Long (10 steps)** — `OnboardingStep1`–`OnboardingStep10` plus `OnboardingResults`. Preserved legacy code, not mounted by RootNavigator.

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
| `LeanQ3IntentScreen.tsx` | Intent — log a workout, track meals or explore. Saves the answer and routes to `LeanQ4`; does not promise an intent-specific Home layout. |
| `LeanQ4MetricsScreen.tsx` | Optional sex for calorie estimates, height (cm), current weight (kg), and imperial / metric controls. Save/skip both continue to Q5. |
| `LeanQ5Screen.tsx` | Optional birth year and target weight. An untouched wheel never writes a birth date; only drafts marked `birthYearChosen` restore a chosen year. Save/skip continue to Q6. |
| `LeanQ6Screen.tsx` | Dietary preferences. Calls `finalizeLeanOnboarding`, sets local completion flags and emits `authEvents`. |
| `OnboardingStep1.tsx`–`OnboardingStep10.tsx` | Long-flow steps: name & sex, dob, weights, activity, goal, eating habits, diet type, restrictions, gym/fitness level, snacks. |
| `OnboardingResults.tsx` | TDEE / target preview that closes the long flow. |

The legacy visual chrome lives in `components/OnboardingLayout.tsx`. Lean screens use their own semantic-token layout, a six-step text overline and sentence-case controls.

## Data flow

```
LeanQ1 ─► saveOnboardingData({ primaryGoal })           ┐
LeanQ2 ─► saveOnboardingData({ fitnessLevel })          ├─ AsyncStorage('onboarding_data')
LeanQ3 ─► saveOnboardingData({ intent })                │
LeanQ4 ─► saveOnboardingData({ sex?, height?, currentWeight? }) │
LeanQ5 ─► saveOnboardingData({ dob?, targetWeight? })          │ // explicitly selected birth year only
LeanQ6 ─► saveOnboardingData({ restrictions })                ┘
        ─► finalizeLeanOnboarding() // PUT /profile, targets when required inputs exist
        ─► AsyncStorage.setItem('onboarding_complete', 'true')
        ─► AsyncStorage.setItem('lean_onboarding_intent', intent)
        ─► authEvents.emit()           // root re-bootstraps
        ─► RootNavigator routes to ClientNavigator (Home)
```

The existing finalizer updates `/profile` and calculates targets when sex, height, weight and birth year are available. Failed profile sync is retried by `useLeanOnboardingReconcile`; local completion still bypasses a second Day-1 onboarding flow. The first-win screen remains separate and skippable.

## App-store / deep-link dependencies

None. Onboarding is post-auth and is not addressable from a deep link. The only navigation in is `RootNavigator` deciding `authState === 'onboarding'`.

## Security and tenancy

- Personal health answers are stored locally and sent through the existing authenticated profile update. No auth, sharing-consent or backend access rule changes here.
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

`__tests__/leanHonest.test.tsx` renders all six screens and exercises choices, Back, skip, optional sex, explicit birth year, units, dietary selections and the existing final macro calculation. `leanOnboardingFlow.test.ts` pins structural wiring; `LeanQ1CoachSharing.test.tsx` retains the unchanged sharing-notice contract.

```bash
npm test
```

## Release notes

- Reviewers reaching this flow see six optional steps, not the legacy long flow. No completion-duration promise is made.
- The "Skip" affordance on `LeanQ1` writes `lean_onboarding_intent: 'explore'` and bypasses the rest of the flow. This is intentional — Play guidelines disallow forcing data entry before letting a user explore the app.
- Unanswered fields are omitted, not replaced with invented values. Q1's skip confirmation points to Profile > Edit profile for later setup.
- If the activation funnel ever needs to be replaced by a different first-run experience, the change is a one-line route swap in `navigation/RootNavigator.tsx` (`LeanOnboardingNavigator` → something else); the legacy `OnboardingNavigator` is preserved as a known-good fallback.
