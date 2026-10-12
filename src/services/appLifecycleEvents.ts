// M1b: the app's own install, update and backgrounded events.
//
// The SDK's automatic lifecycle events are off (App.tsx) because its
// app-open event carries the link that opened the app, and reset/confirm
// links hold sign-in tokens. These replace the install, update and
// backgrounded events it used to send. They go through src/lib/analytics.ts
// (the consent gate: nothing is sent before sign-in) and carry only the app
// version and build number, never a link, token or screen text.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { AppState, type AppStateStatus } from 'react-native';
import { AnalyticsEvents } from '../analytics/events';
import { track } from '../lib/analytics';

/** Last app version and build this device ran, stored as "<version>|<build>". */
export const LAST_APP_VERSION_KEY = 'gp_last_app_version';

type AppStateLike = Pick<typeof AppState, 'addEventListener'>;

function versionProps(): { app_version: string; build: string } | null {
  const version = Application.nativeApplicationVersion;
  if (typeof version !== 'string' || !version) return null;
  return { app_version: version, build: Application.nativeBuildVersion ?? '' };
}

/** Sends app_installed on the first launch and app_updated when the version or build changed. */
export async function trackInstallOrUpdate(): Promise<void> {
  try {
    const current = versionProps();
    if (!current) return;
    const stamp = `${current.app_version}|${current.build}`;
    const last = await AsyncStorage.getItem(LAST_APP_VERSION_KEY);
    if (last === stamp) return;
    await AsyncStorage.setItem(LAST_APP_VERSION_KEY, stamp);
    if (last === null) {
      track(AnalyticsEvents.APP_INSTALLED, current);
    } else {
      const [previousVersion = '', previousBuild = ''] = last.split('|');
      track(AnalyticsEvents.APP_UPDATED, {
        ...current,
        previous_version: previousVersion,
        previous_build: previousBuild,
      });
    }
  } catch {
    // best-effort: never blocks boot
  }
}

/** Sends app_backgrounded each time the app goes to the background. Returns the unsubscribe. */
export function installBackgroundedEvent(appState: AppStateLike = AppState): () => void {
  const subscription = appState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'background') return;
    track(AnalyticsEvents.APP_BACKGROUNDED, versionProps() ?? undefined);
  });
  return () => subscription.remove();
}
