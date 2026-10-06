import type { WearableProvider } from '../../../api/wearablesConnectionsApi';

/**
 * B-WEARLIST-125: the one-line benefit shown under a cloud tracker on
 * Connections. Each line names only data that tracker's server connector
 * really reads (growth-project-backend src/wearables/connectors/<provider>).
 */
const CLOUD_BENEFIT: Partial<Record<WearableProvider, string>> = {
  OURA: 'Sleep, readiness and heart rate from your Oura ring',
  WHOOP: 'Recovery, strain, sleep and HRV from your WHOOP',
  GARMIN: 'Workouts, sleep, HRV and Body Battery from your Garmin',
  FITBIT: 'Sleep, heart rate and weight from your Fitbit',
  POLAR: 'Workouts, sleep and Nightly Recharge from your Polar',
  WITHINGS: 'Weight, body composition, blood pressure and sleep from Withings',
  WAHOO: 'Workouts and heart rate from your Wahoo',
  STRAVA: 'Runs, rides and workouts from Strava',
};

/** The benefit line for a cloud tracker, or null for every other source. */
export function cloudBenefit(provider: WearableProvider): string | null {
  return CLOUD_BENEFIT[provider] ?? null;
}
