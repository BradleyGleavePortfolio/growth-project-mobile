import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const HEALTH_CONNECT_DISABLED_MESSAGE =
  'Health Connect is coming to Android in an update. You can still log your training and meals in the app.';

/** Build metadata, not an EXPO_PUBLIC flag: absent metadata fails closed. */
export function isAndroidHealthConnectEnabled(): boolean {
  return (
    Platform.OS === 'android' &&
    Constants.expoConfig?.extra?.healthConnectEnabled === true
  );
}

export function isHealthConnectProviderDisabled(provider: string): boolean {
  return (
    Platform.OS === 'android' &&
    !isAndroidHealthConnectEnabled() &&
    (provider === 'HEALTH_CONNECT' || provider === 'SAMSUNG_HEALTH')
  );
}

export class HealthConnectDisabledError extends Error {
  readonly code = 'health_connect_build_disabled';

  constructor() {
    super(HEALTH_CONNECT_DISABLED_MESSAGE);
    this.name = 'HealthConnectDisabledError';
  }
}

/** Call after the platform guard and before resolving any native HC module. */
export function assertAndroidHealthConnectEnabled(): void {
  if (!isAndroidHealthConnectEnabled()) throw new HealthConnectDisabledError();
}
