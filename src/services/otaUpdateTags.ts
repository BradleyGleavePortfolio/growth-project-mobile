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
 * An emergency launch (an update that could not launch, rolled back natively
 * by expo-updates error recovery) is also reported once as a warning, so a
 * bad update shows up in Sentry even though the device keeps working.
 *
 * Read-only: values come from the native ExpoUpdates module constants that
 * expo-modules exposes on `globalThis.expo.modules` (the object the Sentry SDK
 * reads for its own `ota_updates` context). Nothing here imports
 * expo-updates, checks for, downloads or reloads an update: an update is only
 * ever applied on the next cold start (app.json checkAutomatically ON_LOAD,
 * fallbackToCacheTimeout 0), never in the middle of a session or onboarding.
 */
import * as Sentry from '@sentry/react-native';

export type OtaUpdateState = {
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  embedded: boolean;
  emergency: boolean;
  emergencyReason: string | null;
};

type SentryLike = {
  setTags: (tags: Record<string, string>) => void;
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

/** The emergency-launch reason without paths, URLs or long text (no PII). */
export function scrubReason(reason: string | null): string | null {
  if (!reason) return null;
  const cleaned = reason
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/(?:[A-Za-z]:)?(?:[\\/][^\s\\/:]+){2,}[\\/]?/g, '<path>')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned;
}

/** Current update state, or null when expo-updates is absent or disabled (dev, Expo Go, web, tests). */
export function readOtaUpdateState(root: unknown = globalThis): OtaUpdateState | null {
  const mod = field(field(field(root, 'expo'), 'modules'), 'ExpoUpdates');
  if (!mod || field(mod, 'isEnabled') !== true) return null;
  const updateId = text(field(mod, 'updateId'));
  const channel = text(field(mod, 'channel'));
  const runtimeVersion = text(field(mod, 'runtimeVersion'));
  return {
    updateId: updateId ? updateId.toLowerCase() : null,
    channel: channel ? channel.toLowerCase() : null,
    runtimeVersion: runtimeVersion ? runtimeVersion.toLowerCase() : null,
    embedded: field(mod, 'isEmbeddedLaunch') === true,
    emergency: field(mod, 'isEmergencyLaunch') === true,
    emergencyReason: scrubReason(text(field(mod, 'emergencyLaunchReason'))),
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
    if (state.emergency && !reported) {
      reported = true;
      sentry.captureMessage('OTA emergency launch: an update failed to start, the embedded bundle is running', {
        level: 'warning',
        tags,
        fingerprint: ['ota-emergency-launch', state.runtimeVersion || 'unknown-runtime'],
        contexts: { ota_emergency: { reason: state.emergencyReason || 'not reported' } },
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
