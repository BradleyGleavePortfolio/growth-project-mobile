/**
 * ConsultationOnboardingNavigator: mounts the consultation onboarding for a
 * new client when `featureFlags.consultationOnboarding` is on (see
 * RootNavigator). It replaces the lean flow entirely, including the lean
 * flow's skip-to-finish path: the consultation can only finish through
 * POST /me/onboarding/complete.
 *
 * Rollback is the flag: with it off, RootNavigator mounts the lean flow as
 * before and nothing here is reachable.
 */
import React, { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCurrentUser } from '../hooks/useCurrentUser';
import ConsultationFlow from '../screens/consultation/ConsultationFlow';
import type { CompleteOnboardingResponse } from '../api/consultationApi';
import { authEvents } from '../utils/authEvents';
import { logger } from '../utils/logger';

export const CONSULTATION_COMPLETE_KEY = 'consultation_complete';

function firstNameOf(user: { firstName?: string; name?: string } | null): string | null {
  if (!user) return null;
  if (user.firstName?.trim()) return user.firstName.trim();
  const n = user.name?.trim();
  return n ? n.split(/\s+/)[0] : null;
}

export default function ConsultationOnboardingNavigator() {
  const user = useCurrentUser();

  const onFinished = useCallback(async (_result: CompleteOnboardingResponse) => {
    try {
      await AsyncStorage.setItem('onboarding_complete', 'true');
      await AsyncStorage.setItem(CONSULTATION_COMPLETE_KEY, 'true');
    } catch (err) {
      logger.warn('ConsultationOnboarding', 'could not store completion flag', err);
    }
    authEvents.emit();
  }, []);

  // Wait for the cached user so local resume state is keyed to the right id.
  if (!user) return null;

  return (
    <ConsultationFlow
      userId={user.id}
      firstName={firstNameOf(user)}
      coachName={null}
      onFinished={onFinished}
    />
  );
}
