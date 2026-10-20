import React, { useEffect, useState } from 'react';
import { Linking, LogBox, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import ClientNavigator from '../navigation/ClientNavigator';
import CoachNavigator from '../navigation/CoachNavigator';
import { EntitlementProvider } from '../entitlements/EntitlementProvider';
import { featureFlags } from '../config/featureFlags';
import { isScreenshotMode } from './mode';
import { seedDemoUser, seedDemoWorkout } from './seed';
import { DEMO_WORKOUT_PARAMS } from './fixtures';
import { screenshotState, screenshotTarget, type ScreenshotTarget } from './screens';

/** Uses the shipping navigators, including whichever coach bar the profile builds. */
export function ScreenshotNavigator() {
  const [target, setTarget] = useState<ScreenshotTarget | null>(null);
  useEffect(() => {
    if (!isScreenshotMode()) return;
    LogBox.ignoreAllLogs(); // no warning toasts inside native frames
    void Linking.getInitialURL().then(async (url) => {
      const next = screenshotTarget(url);
      if (next.route === 'RomanChat' && !featureFlags.romanChat) {
        throw new Error('The selected store profile does not enable Roman chat');
      }
      await seedDemoUser(next.audience);
      if (next.route === 'ActiveWorkout') await seedDemoWorkout();
      setTarget(next);
    });
  }, []);
  if (!isScreenshotMode() || !target) return null;
  return (
    <View style={{ flex: 1 }} testID={`screenshot-${target.slug}`}>
      <NavigationContainer initialState={screenshotState(
        target, target.route === 'ActiveWorkout' ? DEMO_WORKOUT_PARAMS : undefined,
      )}>
        <EntitlementProvider>
          {target.audience === 'coach' ? <CoachNavigator /> : <ClientNavigator />}
        </EntitlementProvider>
      </NavigationContainer>
    </View>
  );
}
