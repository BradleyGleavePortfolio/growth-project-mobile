# Onboarding screens

Every new client gets the consultation in `src/screens/consultation/` (`RootNavigator` mounts `ConsultationOnboardingNavigator` for `authState === 'onboarding'`, B14). The lean six-screen flow (`LeanQ1`–`LeanQ6`, `LeanOnboardingNavigator`) was not mounted after B14 and was deleted in ONBQ-TILES (owner #MOCK-ONBQ-PATH op 1).

What stays here is the legacy long flow, `OnboardingStep1`–`OnboardingStep10` plus `OnboardingResults`: preserved code, not mounted by RootNavigator. It writes to the AsyncStorage key `onboarding_data` via `utils/onboardingStore.ts`.

## Key files

| File | What it does |
| --- | --- |
| `OnboardingStep1.tsx`–`OnboardingStep10.tsx` | Long-flow steps: name & sex, dob, weights, activity, goal, eating habits, diet type, restrictions, gym/fitness level, snacks. |
| `OnboardingResults.tsx` | TDEE / target preview that closes the long flow. |

The legacy visual chrome lives in `components/OnboardingLayout.tsx`.

A client who finished the lean flow on an earlier build may still have an unsynced profile: `useLeanOnboardingReconcile` (mounted by `RootNavigator`) retries `finalizeLeanOnboarding()` (`PUT /profile`, targets when the inputs exist) until it succeeds.

## App-store / deep-link dependencies

None. Onboarding is post-auth and is not addressable from a deep link. The only navigation in is `RootNavigator` deciding `authState === 'onboarding'`.

## Security and tenancy

- Personal health answers are stored locally and sent through the existing authenticated profile update. No auth, sharing-consent or backend access rule changes here.
- The flow never touches the JWT or refresh token. It runs entirely between the auth check and the first profile sync.
- A returning user with a stored profile (`profileDone === true` from the backend) skips onboarding even if the local `onboarding_complete` flag is missing — `RootNavigator` reconciles the two sources before deciding.

## Environment variables

None. The screens are env-free; the `profileApi.update` call inherits whatever `EXPO_PUBLIC_API_URL` the rest of the app uses.

## Failure modes

| Symptom | Cause | Recovery |
| --- | --- | --- |
| Long-flow step writes are missing on Results screen | AsyncStorage write race during quick tapping | The Results screen reads `getOnboardingData()` once on mount; harmless because the next profile-sync uses the latest stored snapshot. |

## Tests

`__tests__/onboardingPolishFlagOff.test.tsx` holds the ED.5 flag-off checks, including that `OnboardingLayout` and `OnboardingResults` gate `StepTransitionView` on `featureFlags.romanOnboardingPolish`.

```bash
npm test
```
