/**
 * ConsultationOnboardingNavigator: mounts the consultation onboarding for a
 * new client when `featureFlags.consultationOnboarding` is on (see
 * RootNavigator). It replaces the lean flow entirely, including the lean
 * flow's skip-to-finish path: the consultation can only finish through
 * POST /me/onboarding/complete.
 *
 * Rollback is the flag: with it off, RootNavigator mounts the lean flow as
 * before and nothing here is reachable.
 *
 * After "Show me around" (Opus B-05): the consultation replaces the Day-1
 * flow and the Day-1 win, so this marks onboarding done locally and in the
 * cached profile (backend #607 complete sets `onboardingCompleted` on the
 * server), and RootNavigator skips the Day-1 and Day-1 win gates while the
 * flag is on. The client lands in the app with Roman's tutorial pending
 * (queued by ConsultationFlow.finish via startClientTutorial).
 */
import React, { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCurrentUser } from '../hooks/useCurrentUser';
import ConsultationFlow from '../screens/consultation/ConsultationFlow';
import type { CompleteOnboardingResponse } from '../api/consultationApi';
import { authEvents } from '../utils/authEvents';
import { logger } from '../utils/logger';
import { patchUserCache } from '../lib/userCache';

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
      await patchUserCache({ profile: { onboarding_completed: true } });
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
