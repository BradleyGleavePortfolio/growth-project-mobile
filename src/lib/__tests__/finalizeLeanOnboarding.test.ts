/**
 * finalizeLeanOnboarding — verifies the lean → backend wiring fix.
 *
 * This is the most important test in the file: prior to this commit, the
 * lean flow wrote to AsyncStorage and never called profileApi.update,
 * leaving new users on Home with `protein_target=undefined` forever.
 * The contract these tests pin down is:
 *   1. profileApi.update is called on completion.
 *   2. Lean enum vocab is mapped to the legacy/backend enum vocab.
 *   3. activity_level defaults to 'moderate' (never blindly accepts a
 *      lean Q3 intent value).
 *   4. Macros are computed when current_weight + height + dob + sex are
 *      present.
 *   5. On API failure the call returns ok=false and does NOT mark
 *      lean_onboarding_synced (the reconcile hook depends on this to
 *      retry on next app open).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Mock profileApi BEFORE the SUT import. The factory uses a `mock`-
// prefixed variable so jest's hoisting check lets it through (the rule
// is: factories may not reference out-of-scope variables, except those
// named with a `mock` prefix). The actual jest.fn lives on
// global.__profileUpdateMock so the test body can read its calls.
jest.mock('../../services/api', () => {
  const mockUpdate = jest.fn();
  // Stash a handle so tests can assert on calls + reset between specs.
  (global as unknown as { __profileUpdateMock: jest.Mock }).__profileUpdateMock =
    mockUpdate;
  return {
    profileApi: {
      update: mockUpdate,
    },
  };
});

import {
  finalizeLeanOnboarding,
  mapLeanGoalToLegacy,
  mapLeanFitnessToLegacy,
} from '../finalizeLeanOnboarding';

const updateMock = (global as unknown as { __profileUpdateMock: jest.Mock })
  .__profileUpdateMock;

beforeEach(async () => {
  updateMock.mockReset();
  updateMock.mockResolvedValue({ data: {} });
  await AsyncStorage.clear();
});

describe('mapLeanGoalToLegacy', () => {
  it('maps the three lean goals to legacy enum', () => {
    expect(mapLeanGoalToLegacy('lose_weight')).toBe('lose_moderate');
    expect(mapLeanGoalToLegacy('build_muscle')).toBe('gain');
    expect(mapLeanGoalToLegacy('maintain')).toBe('maintain');
  });

  it('returns null for an undefined input (skipped step)', () => {
    expect(mapLeanGoalToLegacy(undefined)).toBeNull();
  });

  it('passes through unknown values so legacy strings still flow', () => {
    // Defensive: a user who half-onboarded under the legacy flow may
    // already have 'lose_fast' written. We don't want to clobber that.
    expect(mapLeanGoalToLegacy('lose_fast')).toBe('lose_fast');
  });
});

describe('mapLeanFitnessToLegacy', () => {
  it('maps the three lean experience levels to legacy enum', () => {
    expect(mapLeanFitnessToLegacy('new')).toBe('beginner');
    expect(mapLeanFitnessToLegacy('some')).toBe('intermediate');
    expect(mapLeanFitnessToLegacy('experienced')).toBe('advanced');
  });
});

describe('finalizeLeanOnboarding — calls profileApi.update', () => {
  it('PUTs the mapped payload when LeanQ1–Q4 fields are present', async () => {
    await AsyncStorage.setItem(
      'onboarding_data',
      JSON.stringify({
        primaryGoal: 'lose_weight',
        fitnessLevel: 'some',
        sex: 'female',
        dob: '1992-04-15',
        currentWeight: 72, // kg
        height: 168, // cm
        intent: 'workout',
      }),
    );

    const result = await finalizeLeanOnboarding();

    expect(result.ok).toBe(true);
    expect(updateMock).toHaveBeenCalledTimes(1);
    const payload = updateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      onboarding_completed: true,
      sex: 'female',
      dob: '1992-04-15',
      current_weight: 72,
      height_cm: 168,
      // Lean → legacy enum mapping
      primary_goal: 'lose_moderate',
      fitness_level: 'intermediate',
      // Lean Q3 "intent" is preserved as a separate field — NOT mapped
      // onto activity_level.
      lean_intent: 'workout',
      // activity_level defaults to 'moderate' until EditProfile sets it.
      activity_level: 'moderate',
    });
    // Macros computed because all four BMR inputs are present.
    expect(payload.tdee).toEqual(expect.any(Number));
    expect(payload.calorie_target).toEqual(expect.any(Number));
    expect(payload.protein_target).toBeGreaterThan(0);
    expect(result.computedMacros).toBe(true);
  });

  it('marks lean_onboarding_synced=true on success', async () => {
    await AsyncStorage.setItem('onboarding_data', JSON.stringify({}));
    const result = await finalizeLeanOnboarding();
    expect(result.ok).toBe(true);
    const flag = await AsyncStorage.getItem('lean_onboarding_synced');
    expect(flag).toBe('true');
  });
});

describe('finalizeLeanOnboarding — never poisons activity_level', () => {
  it('ignores a lean-Q3 intent value previously written to activityLevel', async () => {
    // Pre-fix bug: LeanQ3 wrote 'workout'/'track_meals'/'explore' into
    // the activityLevel field. Even if a stale install still has that
    // value in AsyncStorage, finalizeLeanOnboarding must not forward it
    // to the backend (it would break TDEE).
    await AsyncStorage.setItem(
      'onboarding_data',
      JSON.stringify({ activityLevel: 'workout' }),
    );
    await finalizeLeanOnboarding();
    const payload = updateMock.mock.calls[0][0];
    expect(payload.activity_level).toBe('moderate');
  });

  it('preserves a valid TDEE bucket if one is already set', async () => {
    await AsyncStorage.setItem(
      'onboarding_data',
      JSON.stringify({ activityLevel: 'active' }),
    );
    await finalizeLeanOnboarding();
    const payload = updateMock.mock.calls[0][0];
    expect(payload.activity_level).toBe('active');
  });
});

describe('finalizeLeanOnboarding — partial answers', () => {
  it('skips macro computation when BMR inputs are incomplete', async () => {
    await AsyncStorage.setItem(
      'onboarding_data',
      JSON.stringify({
        primaryGoal: 'maintain',
        // weight + height present but no dob → can't compute age → no macros
        currentWeight: 72,
        height: 168,
        sex: 'male',
      }),
    );
    const result = await finalizeLeanOnboarding();
    expect(result.ok).toBe(true);
    expect(result.computedMacros).toBe(false);
    const payload = updateMock.mock.calls[0][0];
    expect(payload.tdee).toBeUndefined();
    expect(payload.protein_target).toBeUndefined();
  });

  it('omits skipped fields rather than sending null', async () => {
    await AsyncStorage.setItem('onboarding_data', JSON.stringify({}));
    await finalizeLeanOnboarding();
    const payload = updateMock.mock.calls[0][0];
    expect(payload.sex).toBeUndefined();
    expect(payload.dob).toBeUndefined();
    expect(payload.primary_goal).toBeUndefined();
    expect(payload.onboarding_completed).toBe(true);
  });
});

describe('finalizeLeanOnboarding — failure handling', () => {
  it('returns ok=false on API error and does NOT mark synced', async () => {
    updateMock.mockRejectedValueOnce(new Error('network down'));
    await AsyncStorage.setItem(
      'onboarding_data',
      JSON.stringify({ primaryGoal: 'maintain' }),
    );
    const result = await finalizeLeanOnboarding();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('api_error');
    const flag = await AsyncStorage.getItem('lean_onboarding_synced');
    expect(flag).toBeNull(); // reconcile hook must be free to retry
  });
});
