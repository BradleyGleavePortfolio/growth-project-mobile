/**
 * Profile completion gating — covers what counts as "complete" for the
 * cold-outbound flow. The Home nudge, the Profile section header, and the
 * EditProfile screen all read this gate, so a regression here changes
 * behavior across three surfaces at once.
 */
import {
  getProfileCompletion,
  summarizeMissing,
  buildProfileUpdatePayload,
  FIELD_LABEL,
} from '../profileCompletion';
import type { CurrentUser } from '../../hooks/useCurrentUser';

const fullProfile: NonNullable<CurrentUser['profile']> = {
  sex: 'female',
  dob: '1992-04-15',
  target_weight: 165,
  diet_type: 'omnivore',
  workout_days_per_week: 4,
  gym_membership: 'home_gym',
  // Wave 5: TDEE-critical fields + dietary safety required for "complete"
  current_weight: 172,
  height_cm: 168,
  activity_level: 'moderate',
  primary_goal: 'maintain',
  diet_restrictions: [],
};

function userWith(profile: Partial<NonNullable<CurrentUser['profile']>>): CurrentUser {
  return {
    id: 'u_1',
    email: 'a@b.co',
    profile,
  };
}

describe('getProfileCompletion', () => {
  it('reports complete when all six core fields are set', () => {
    const r = getProfileCompletion(userWith(fullProfile));
    expect(r.isComplete).toBe(true);
    expect(r.missing).toHaveLength(0);
    expect(r.percentComplete).toBe(100);
  });

  it('flags every missing field on a fresh profile', () => {
    const r = getProfileCompletion(userWith({}));
    expect(r.isComplete).toBe(false);
    expect(r.missing).toEqual([
      'sex',
      'dob',
      'target_weight',
      'diet_type',
      'workout_days_per_week',
      'gym_membership',
      // Wave 5 additions — TDEE inputs + dietary safety
      'current_weight',
      'height_cm',
      'activity_level',
      'primary_goal',
      'diet_restrictions',
    ]);
    expect(r.percentComplete).toBe(0);
  });

  it('treats empty strings, zero, and null as missing', () => {
    const r = getProfileCompletion(
      userWith({
        sex: '',
        dob: '   ',
        target_weight: 0,
        diet_type: undefined,
        workout_days_per_week: 0,
      }),
    );
    expect(r.missing).toContain('sex');
    expect(r.missing).toContain('dob');
    expect(r.missing).toContain('target_weight');
    expect(r.missing).toContain('diet_type');
    expect(r.missing).toContain('workout_days_per_week');
  });

  it('reports partial completion when some fields are set', () => {
    const r = getProfileCompletion(
      userWith({ sex: 'male', dob: '1990-01-01', target_weight: 170 }),
    );
    expect(r.filled).toEqual(['sex', 'dob', 'target_weight']);
    expect(r.missing).toEqual([
      'diet_type',
      'workout_days_per_week',
      'gym_membership',
      'current_weight',
      'height_cm',
      'activity_level',
      'primary_goal',
      'diet_restrictions',
    ]);
    // 3 of 11 required fields → ~27% (rounded from 27.27)
    expect(r.percentComplete).toBe(27);
  });

  it('treats an empty diet_restrictions array as "answered: none"', () => {
    // Safety gate: undefined = unanswered, [] = explicit "no restrictions".
    const r = getProfileCompletion(userWith({ diet_restrictions: [] }));
    expect(r.filled).toContain('diet_restrictions');
    expect(r.missing).not.toContain('diet_restrictions');
  });

  it('treats a non-array diet_restrictions value as missing', () => {
    // Defensive: legacy backend rows occasionally store the field as a
    // string. Until normalized, we treat it as unanswered so the user is
    // re-prompted rather than silently shown recipes that may include
    // their allergens.
    const r = getProfileCompletion(
      userWith({ diet_restrictions: 'peanut_allergy' as unknown as string[] }),
    );
    expect(r.missing).toContain('diet_restrictions');
  });

  it('treats a null user as fully missing', () => {
    const r = getProfileCompletion(null);
    expect(r.isComplete).toBe(false);
    expect(r.percentComplete).toBe(0);
  });
});

describe('summarizeMissing', () => {
  it('returns empty string for a complete profile', () => {
    expect(summarizeMissing([])).toBe('');
  });

  it('uses "and" for two missing fields', () => {
    expect(summarizeMissing(['sex', 'dob'])).toBe('Sex and Date of birth');
  });

  it('lists the first two and counts the rest', () => {
    expect(
      summarizeMissing(['sex', 'dob', 'target_weight', 'diet_type']),
    ).toBe('Sex, Date of birth, and 2 more');
  });

  it('exposes a label for every required field', () => {
    const fields = [
      'sex',
      'dob',
      'target_weight',
      'diet_type',
      'workout_days_per_week',
      'gym_membership',
    ] as const;
    for (const f of fields) {
      expect(FIELD_LABEL[f]).toBeTruthy();
    }
  });
});

// Reusable shell for the now-larger EditProfileFormState. Lets each test
// override only the keys it cares about.
const blankForm = {
  sex: null,
  dob: '',
  targetWeight: '',
  dietType: null,
  workoutDaysPerWeek: null,
  gymMembership: null,
  currentWeight: '',
  heightCm: '',
  activityLevel: null,
  primaryGoal: null,
  dietRestrictions: [] as string[],
  dietRestrictionsAnswered: false,
} as const;

describe('buildProfileUpdatePayload', () => {
  it('emits snake_case keys for every set field', () => {
    const payload = buildProfileUpdatePayload({
      ...blankForm,
      sex: 'female',
      dob: '1992-04-15',
      targetWeight: '165',
      dietType: 'vegetarian',
      workoutDaysPerWeek: 4,
      gymMembership: 'home_gym',
    });
    expect(payload).toEqual({
      sex: 'female',
      dob: '1992-04-15',
      target_weight: 165,
      diet_type: 'vegetarian',
      workout_days_per_week: 4,
      gym_membership: 'home_gym',
    });
  });

  it('omits unset fields so the backend keeps prior values', () => {
    const payload = buildProfileUpdatePayload({
      ...blankForm,
      gymMembership: 'no_gym',
    });
    expect(payload).toEqual({ gym_membership: 'no_gym' });
  });

  it('drops a target weight that is empty or non-positive', () => {
    expect(
      buildProfileUpdatePayload({ ...blankForm, targetWeight: '0' }),
    ).toEqual({});
    expect(
      buildProfileUpdatePayload({ ...blankForm, targetWeight: 'abc' }),
    ).toEqual({});
  });

  it('coerces a numeric string target weight', () => {
    const payload = buildProfileUpdatePayload({
      ...blankForm,
      targetWeight: '172.5',
    });
    expect(payload).toEqual({ target_weight: 172.5 });
  });

  it('emits TDEE-critical fields when the form supplies them', () => {
    const payload = buildProfileUpdatePayload({
      ...blankForm,
      currentWeight: '180',
      heightCm: '178',
      activityLevel: 'moderate',
      primaryGoal: 'lose_moderate',
    });
    expect(payload).toEqual({
      current_weight: 180,
      height_cm: 178,
      activity_level: 'moderate',
      primary_goal: 'lose_moderate',
    });
  });

  it('only emits diet_restrictions once the user has answered', () => {
    // Unanswered → field absent so backend keeps any prior value.
    expect(
      buildProfileUpdatePayload({
        ...blankForm,
        dietRestrictions: ['Nut Allergy'],
        dietRestrictionsAnswered: false,
      }).diet_restrictions,
    ).toBeUndefined();

    // Answered "none" → empty array is sent so backend records the answer.
    expect(
      buildProfileUpdatePayload({
        ...blankForm,
        dietRestrictions: [],
        dietRestrictionsAnswered: true,
      }),
    ).toEqual({ diet_restrictions: [] });

    // Answered with selections → array is sent verbatim.
    expect(
      buildProfileUpdatePayload({
        ...blankForm,
        dietRestrictions: ['Nut Allergy', 'Vegan'],
        dietRestrictionsAnswered: true,
      }),
    ).toEqual({ diet_restrictions: ['Nut Allergy', 'Vegan'] });
  });
});
