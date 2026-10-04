/**
 * Over-the-air update identity on every Sentry event (S-RELEASE-3, B-305-6).
 *
 * An EAS update keeps the binary's Sentry release (`<version>+<build>`), so
 * the release alone cannot tell the embedded bundle from a hotfix. These
 * searchable tags can, using the names newer @sentry/react-native versions set
 * themselves (so the search keeps working after an SDK upgrade):
 *
 *   expo.updates.update_id        the running update (lowercase UUID)
 *   expo.updates.channel          clinic | production | preview
 *   expo.updates.runtime_version  the fingerprint runtime of the binary
 *   expo.updates.embedded         "true" while the bundle inside the binary runs
 *   expo.updates.emergency        "true" when expo-updates fell back to the
 *                                 embedded bundle because an update failed
 *
 * The same values are set as the `ota_updates` context (the key and field
 * names the SDK uses), so every JS event and, through scope sync, every
 * native crash report carries them.
 *
 * An emergency launch (an update that could not launch, rolled back natively
 * by expo-updates error recovery) is also reported once as a warning, so a
 * bad update shows up in Sentry even though the device keeps working.
 *
 * No free-form text leaves the device (Sol B-305-10, B-305-12): the native
 * `emergencyLaunchReason` is an exception's localizedDescription / message and
 * can hold anything, so it is mapped HERE to a closed category
 * (EmergencyReasonCategory, `unknown` fallback) and only the category is sent.
 * The identifiers are shape-checked too (src/services/otaUpdateShape.ts): the
 * update id must be a UUID, the channel one of the configured channels (else
 * `other`), the runtime a short fingerprint-like token; anything else is
 * dropped. The SDK's own ExpoContext integration, which would copy the raw
 * reason into `contexts.ota_updates` on every JS event and into the native
 * crash scope, is removed in initSentry (src/services/sentry.ts), and the
 * content policy (src/services/sentryPrivacy.ts) reduces any `ota_updates` /
 * `ota_emergency` context that still reaches a JS event to the same shapes.
 *
 * Read-only: values come from the native ExpoUpdates module constants that
 * expo-modules exposes on `globalThis.expo.modules`. Nothing here imports
 * expo-updates, checks for, downloads or reloads an update: an update is only
 * ever applied on the next cold start (app.json checkAutomatically ON_LOAD,
 * fallbackToCacheTimeout 0), never in the middle of a session or onboarding.
 */
import * as Sentry from '@sentry/react-native';

import {
  EMERGENCY_REASON_CATEGORIES,
  OTA_CHANNELS,
  emergencyReasonCategory,
  safeChannel,
  safeCheckMode,
  safeLaunchDuration,
  safeRuntimeVersion,
  safeUpdateId,
  type EmergencyReasonCategory,
  type OtaUpdatesContext,
} from './otaUpdateShape';

export { EMERGENCY_REASON_CATEGORIES, OTA_CHANNELS, emergencyReasonCategory };
export type { EmergencyReasonCategory };

/** The Sentry context key the SDK uses for update state (kept, so the Sentry UI shows it the same way). */
export const OTA_UPDATES_CONTEXT = 'ota_updates';

export type OtaUpdateState = {
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  embedded: boolean;
  emergency: boolean;
  usingEmbeddedAssets: boolean;
  checkAutomatically: string | null;
  launchDurationMs: number | null;
  /** A closed category of the native reason; the reason text itself is never kept. */
  emergencyReason: EmergencyReasonCategory;
};

type SentryLike = {
  setTags: (tags: Record<string, string>) => void;
  setContext: (key: string, context: OtaUpdatesContext) => void;
  captureMessage: (
    message: string,
    context: {
      level: 'warning';
      tags: Record<string, string>;
      fingerprint: string[];
      contexts: Record<string, Record<string, string>>;
    },
  ) => unknown;
};

function field(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  return Reflect.get(obj, key);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Current update state, or null when expo-updates is absent or disabled (dev, Expo Go, web, tests). */
export function readOtaUpdateState(root: unknown = globalThis): OtaUpdateState | null {
  const mod = field(field(field(root, 'expo'), 'modules'), 'ExpoUpdates');
  if (!mod || field(mod, 'isEnabled') !== true) return null;
  return {
    updateId: safeUpdateId(field(mod, 'updateId')),
    channel: safeChannel(field(mod, 'channel')),
    runtimeVersion: safeRuntimeVersion(field(mod, 'runtimeVersion')),
    embedded: field(mod, 'isEmbeddedLaunch') === true,
    emergency: field(mod, 'isEmergencyLaunch') === true,
    usingEmbeddedAssets: field(mod, 'isUsingEmbeddedAssets') === true,
    checkAutomatically: safeCheckMode(field(mod, 'checkAutomatically')),
    launchDurationMs: safeLaunchDuration(field(mod, 'launchDuration')),
    emergencyReason: emergencyReasonCategory(text(field(mod, 'emergencyLaunchReason'))),
  };
}

/** Searchable Sentry tags for a state (values are bounded identifiers, never user data). */
export function otaUpdateTags(state: OtaUpdateState): Record<string, string> {
  const tags: Record<string, string> = {
    'expo.updates.embedded': String(state.embedded),
    'expo.updates.emergency': String(state.emergency),
  };
  if (state.updateId) tags['expo.updates.update_id'] = state.updateId;
  if (state.channel) tags['expo.updates.channel'] = state.channel;
  if (state.runtimeVersion) tags['expo.updates.runtime_version'] = state.runtimeVersion;
  return tags;
}

/**
 * The `ota_updates` context for a state, with the SDK's field names but only
 * bounded values (B-305-12). `emergency_reason_category` replaces the SDK's
 * raw `emergency_launch_reason`.
 */
export function otaUpdatesContext(state: OtaUpdateState): OtaUpdatesContext {
  const ctx: OtaUpdatesContext = {
    is_enabled: true,
    is_embedded_launch: state.embedded,
    is_emergency_launch: state.emergency,
    is_using_embedded_assets: state.usingEmbeddedAssets,
    emergency_reason_category: state.emergencyReason,
  };
  if (state.updateId) ctx.update_id = state.updateId;
  if (state.channel) ctx.channel = state.channel;
  if (state.runtimeVersion) ctx.runtime_version = state.runtimeVersion;
  if (state.checkAutomatically) ctx.check_automatically = state.checkAutomatically;
  if (state.launchDurationMs !== null) ctx.launch_duration = state.launchDurationMs;
  return ctx;
}

let reported = false;

/**
 * Tag the Sentry scope with the running update and report an emergency
 * launch once per process. Call right after initSentry(). Never throws:
 * update identity is diagnostics, not app behaviour.
 */
export function reportOtaUpdateLaunch(sentry: SentryLike = Sentry, root: unknown = globalThis): OtaUpdateState | null {
  try {
    const state = readOtaUpdateState(root);
    if (!state) return null;
    const tags = otaUpdateTags(state);
    sentry.setTags(tags);
    // Scope sync copies this context to the native crash scope as well.
    sentry.setContext(OTA_UPDATES_CONTEXT, otaUpdatesContext(state));
    if (state.emergency && !reported) {
      reported = true;
      sentry.captureMessage('OTA emergency launch: an update failed to start, the embedded bundle is running', {
        level: 'warning',
        tags,
        fingerprint: ['ota-emergency-launch', state.runtimeVersion || 'unknown-runtime'],
        contexts: { ota_emergency: { reason_category: state.emergencyReason } },
      });
    }
    return state;
  } catch {
    return null;
  }
}

/** Test hook: allow the once-per-process emergency report again. */
export function resetOtaUpdateReportForTests(): void {
  reported = false;
}
