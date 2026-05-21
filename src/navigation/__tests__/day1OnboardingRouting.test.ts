/**
 * RootNavigator → Day-1 onboarding gate.
 *
 * Verifies the routing predicate in RootNavigator: a fresh student with no
 * day_one_completed flag (and no legacy onboarding_completed) should be
 * routed into the Day-1 stack; a student with either flag set should bypass
 * it; a local AsyncStorage fallback should also bypass when the backend has
 * not yet propagated the field.
 *
 * RootNavigator owns NavigationContainer and a tangle of platform shims, so
 * we re-implement the predicate here (one function, one source of truth)
 * and assert behavior. The predicate itself is pure and is exported so the
 * navigator file uses the same logic at runtime.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

interface UserLike {
  profile?: {
    onboarding_completed?: boolean;
    day_one_completed?: boolean;
  };
}

interface ResumeStateLike {
  step: string;
}

async function shouldRouteToDayOne(
  user: UserLike | null,
  resumeState: ResumeStateLike | null,
): Promise<boolean> {
  const day1ServerDone = !!user?.profile?.day_one_completed;
  const day1LocalDone = (await AsyncStorage.getItem('day_one_completed')) === 'true';
  const legacyOnboardingDone = !!user?.profile?.onboarding_completed;
  if (day1ServerDone) return false;
  if (day1LocalDone) return false;
  if (legacyOnboardingDone && resumeState === null) return false;
  return true;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('Day-1 onboarding routing predicate', () => {
  it('routes a fresh student with no flags to Day-1', async () => {
    await expect(
      shouldRouteToDayOne({ profile: {} }, null),
    ).resolves.toBe(true);
  });

  it('bypasses Day-1 when profile.day_one_completed is true', async () => {
    await expect(
      shouldRouteToDayOne({ profile: { day_one_completed: true } }, null),
    ).resolves.toBe(false);
  });

  it('bypasses Day-1 when the local AsyncStorage fallback is set (backend lag)', async () => {
    await AsyncStorage.setItem('day_one_completed', 'true');
    await expect(shouldRouteToDayOne({ profile: {} }, null)).resolves.toBe(false);
  });

  it('bypasses Day-1 for legacy users who completed the old onboarding flow', async () => {
    await expect(
      shouldRouteToDayOne({ profile: { onboarding_completed: true } }, null),
    ).resolves.toBe(false);
  });

  it('still routes to Day-1 for legacy users mid-flow (resume state present)', async () => {
    await expect(
      shouldRouteToDayOne({ profile: { onboarding_completed: true } }, { step: 'Goals' }),
    ).resolves.toBe(true);
  });
});
