/**
 * featureFlags — module-level feature toggles read from EXPO_PUBLIC_* env.
 *
 * Why a separate module: a small number of features (currently bloodwork)
 * ship behind an OFF-by-default flag while their backend, audit-log, and
 * consent flows are still being reviewed. Reading the flag through this
 * helper keeps the surface uniform and makes the OFF-by-default contract
 * easy to assert in tests.
 *
 * Add new flags here. Keep the default `false` unless there is an
 * explicit, documented reason to ship a feature on by default.
 */

function envBool(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return defaultValue;
}

export const featureFlags = {
  /**
   * Client-entered bloodwork / labs review surface. OFF by default —
   * flip on per build (or remotely, once a remote-config layer lands)
   * once backend storage, audit log, and consent capture are live.
   *
   * env: EXPO_PUBLIC_FEATURE_BLOODWORK
   */
  bloodwork: envBool('EXPO_PUBLIC_FEATURE_BLOODWORK', false),
} as const;

export type FeatureFlagKey = keyof typeof featureFlags;

export function isFeatureEnabled(flag: FeatureFlagKey): boolean {
  return !!featureFlags[flag];
}
