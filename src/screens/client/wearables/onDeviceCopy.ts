/**
 * S14 round 3 — what the Apple Health / Health Connect connect and refresh
 * surfaces say for every outcome (owner rule 2026-10-01 13:34: every failure
 * says what happened and what to do next; known statuses and machine codes
 * get their own copy; anything unexpected shows a short reference, a support
 * path, and is reported to Sentry).
 *
 * Plain warm words: no emojis, no exclamation marks. No health values are
 * ever put into copy or reports.
 */

import axios from 'axios';
import { Platform } from 'react-native';
import { SUPPORT_EMAIL } from '../../../constants/support';
import { reportUnexpected } from '../../../lib/consultation/report';
import { newRequestId, shortReference, supportReferenceOf } from '../../../utils/correlation';
import {
  OnDeviceNotSignedInError,
  OnDeviceStepError,
  type OnDeviceImportOutcome,
} from '../../../services/health/onDeviceSync';
import { OnDeviceSessionChangedError } from '../../../services/health/sessionFence';
import type { OnDeviceConnectOutcome } from '../../../services/health/onDeviceConnect';
import type { WearableProvider } from '../../../api/wearablesConnectionsApi';
import {
  HealthConnectPermissionDeniedError,
  HealthConnectUnavailableError,
} from '../../../services/health/healthConnect/errors';

/**
 * Where people write when something unexpected happens: the app's one
 * support address (S-ERRORS #324, src/constants/support.ts).
 */
export const WEARABLES_SUPPORT_EMAIL = SUPPORT_EMAIL;

/** What the sheet shows, and which action its primary button runs. */
export interface OnDeviceMessage {
  text: string;
  /**
   * `connect` re-runs Connect from the start, `resume` continues the import
   * for the same connection, `login` ends the expired session so the person
   * can log in again, `open_settings` opens Health Connect's permissions,
   * `open_store` opens Health Connect in the Play Store, `none` means there
   * is nothing to retry here (the button is hidden; Close remains).
   */
  action: 'connect' | 'resume' | 'login' | 'open_settings' | 'open_store' | 'none';
  /** Primary button label when it is not the action's default. */
  cta?: string;
}

/** Default primary button label per action. */
export function ctaLabelFor(message: Pick<OnDeviceMessage, 'action' | 'cta'>): string {
  if (message.cta) return message.cta;
  switch (message.action) {
    case 'resume':
      return 'Try again';
    case 'login':
      return 'Log in again';
    case 'open_settings':
      return 'Open Health Connect';
    case 'open_store':
      return 'Get Health Connect';
    default:
      return 'Continue';
  }
}

function statusOf(err: unknown): number | null {
  if (!axios.isAxiosError(err)) return null;
  const s = err.response?.status;
  return typeof s === 'number' ? s : null;
}

function codeOf(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const data: unknown = err.response?.data;
  if (typeof data !== 'object' || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : null;
}

/**
 * Copy for an import that finished but did not cover the whole history
 * (Sol B-317-2): the source is connected, and the person gets a working
 * action to continue.
 */
export function partialImportMessage(
  name: string,
  outcome: Extract<OnDeviceImportOutcome, { kind: 'imported' }>,
): OnDeviceMessage {
  if (outcome.postedCount > 0) {
    return {
      text:
        `${name} is connected and part of your last 30 days is in. ` +
        `Tap Continue import to bring in the rest. It also continues each time you open Health.`,
      action: 'resume',
      cta: 'Continue import',
    };
  }
  return {
    text:
      `${name} is connected, but your history couldn't be read yet. ` +
      `Check that ${name} access is turned on for The Growth Project, then tap Try again.`,
    action: 'resume',
  };
}

/**
 * Copy for a failed Connect run. Returns null when nothing should be shown
 * (the sheet was closed, so the run was cancelled on purpose).
 */
export function connectFailureMessage(err: unknown, name: string): OnDeviceMessage | null {
  if (err instanceof OnDeviceSessionChangedError) {
    if (err.reason === 'cancelled') return null;
    return {
      text:
        `The signed-in account changed while ${name} was connecting, so nothing was brought in. ` +
        `If this is your account, tap Continue to connect ${name}.`,
      action: 'connect',
    };
  }
  if (err instanceof OnDeviceNotSignedInError) {
    return {
      text: `You're signed out, so nothing was read. Log in again, then connect ${name} from Connections.`,
      action: 'login',
    };
  }

  const step = err instanceof OnDeviceStepError ? err.step : 'import';
  const cause = err instanceof OnDeviceStepError ? err.cause : err;
  const connected = step === 'import';
  const action: OnDeviceMessage['action'] = connected ? 'resume' : 'connect';
  const retryWord = connected ? 'Try again' : 'Continue';

  if (cause instanceof HealthConnectPermissionDeniedError) {
    // Every Health Connect type is off for the app (refused or revoked).
    return {
      text:
        `${name} access is turned off for The Growth Project, so nothing new came in. Tap Open Health ` +
        `Connect, choose App permissions, then The Growth Project, and allow access. Then tap ${retryWord}.`,
      action: 'open_settings',
    };
  }
  if (cause instanceof HealthConnectUnavailableError) {
    return {
      text: `Health Connect isn't ready on this phone. Open the Health Connect app to finish setting it up, then tap ${retryWord}.`,
      action,
    };
  }
  if (cause instanceof OnDeviceSessionChangedError) {
    return connectFailureMessage(cause, name);
  }

  if (axios.isAxiosError(cause)) {
    const status = statusOf(cause);
    const code = codeOf(cause);
    if (status === null) {
      return {
        text: connected
          ? `${name} is connected, but your history stopped coming in because the connection dropped. Check your internet connection, then tap Try again.`
          : `The Growth Project couldn't be reached, so ${name} isn't connected yet. Check your internet connection, then tap Continue.`,
        action,
      };
    }
    if (status === 401) {
      return {
        text: connected
          ? `${name} is connected, but your session ended before your history came in. Log in again, then open Health to bring it in.`
          : `Your session has ended, so ${name} isn't connected. Log in again, then connect ${name} from Connections.`,
        action: 'login',
      };
    }
    if (status === 403 && code === 'wearables_connection_forbidden') {
      return {
        text: `This ${name} connection is no longer linked to your account. Tap Continue to connect ${name} again.`,
        action: 'connect',
      };
    }
    if (status === 403) {
      return {
        text: `${name} can be connected from a client account only. If you are a client and see this, contact your coach.`,
        action: 'none',
      };
    }
    if (status === 429) {
      return {
        text: connected
          ? `${name} is connected. Your history paused after too many requests in a short time. Wait a minute, then tap Try again.`
          : `Too many tries in a short time. Wait a minute, then tap Continue.`,
        action,
      };
    }
  }

  // Unexpected: short reference, a support path, and a Sentry report with
  // status, machine code and reference only. A failure with no server
  // request id (a local error) gets a fresh reference so support can still
  // find the Sentry event by it.
  const status = statusOf(cause);
  const requestId = supportReferenceOf(cause) ?? newRequestId();
  reportUnexpected('wearables.on_device_connect', {
    status,
    code: codeOf(cause),
    requestId,
  });
  const ref = shortReference(requestId) ?? 'unavailable';
  return {
    text: connected
      ? `${name} is connected, but your history didn't finish coming in because of an unexpected problem with The Growth Project. Reference ${ref}. Tap Try again in a few minutes, or write to ${WEARABLES_SUPPORT_EMAIL} and mention the reference.`
      : `${name} couldn't be connected because of an unexpected problem with The Growth Project. Reference ${ref}. Tap Continue in a few minutes, or write to ${WEARABLES_SUPPORT_EMAIL} and mention the reference.`,
    action,
  };
}

/** Lane off (FEATURE_WEARABLES_INGEST_POST): nothing to retry yet. */
export const INGEST_DISABLED_COPY =
  "Health data import isn't switched on yet. Your coach will let you know when it is ready.";

/** Server row connected, no local authorization on this phone (Opus B-317-5). */
export function notSyncingHereCopy(name: string): string {
  return `${name} is not syncing on this phone. Tap Reconnect to continue.`;
}

/** A short reference for a failure, reported to Sentry (no health data). */
function referenceFor(where: string, err: unknown, code: string | null): string {
  const requestId = supportReferenceOf(err) ?? newRequestId();
  reportUnexpected(where, { status: statusOf(err), code, requestId });
  return shortReference(requestId) ?? 'unavailable';
}

/** Health Connect providers (Samsung Health reads through Health Connect). */
function readsThroughHealthConnect(provider: WearableProvider): boolean {
  return provider === 'HEALTH_CONNECT' || provider === 'SAMSUNG_HEALTH';
}

/**
 * S-WEAR-3: copy for every native permission outcome other than `granted`
 * (one cause, one message, one working action). `disabled` is handled by the
 * build switch copy in the sheet; `stopped` shows nothing (the attempt ended).
 */
export function permissionOutcomeMessage(
  outcome: Exclude<OnDeviceConnectOutcome, 'granted' | 'disabled' | 'stopped'>,
  provider: WearableProvider,
  name: string,
): OnDeviceMessage {
  const viaHealthConnect = readsThroughHealthConnect(provider);
  const samsungNote =
    provider === 'SAMSUNG_HEALTH' ? 'Samsung Health shares its data through Health Connect. ' : '';
  switch (outcome) {
    case 'denied':
      return viaHealthConnect
        ? {
            text:
              `${name} access wasn't allowed, so nothing was read. Tap Open Health Connect, ` +
              `choose App permissions, then The Growth Project, and allow access. Then come back and tap Continue.`,
            action: 'open_settings',
          }
        : {
            text: `${name} access wasn't allowed, so nothing was read. Tap Continue to choose what to share.`,
            action: 'connect',
          };
    case 'unavailable':
      return {
        text:
          `${samsungNote}Health Connect isn't installed on this phone. Tap Get Health Connect to ` +
          `install it from the Play Store, then come back and tap Continue.`,
        action: 'open_store',
        cta: 'Get Health Connect',
      };
    case 'update_required':
      return {
        text:
          `${samsungNote}Health Connect needs an update before it can share data. Tap Update Health ` +
          `Connect, then come back and tap Continue.`,
        action: 'open_store',
        cta: 'Update Health Connect',
      };
    case 'unsupported':
      return {
        text: viaHealthConnect
          ? `${name} works on Android phones only. On this iPhone, connect Apple Health instead.`
          : provider === 'APPLE_HEALTHKIT'
            ? Platform.OS === 'ios'
              ? "Apple Health isn't available on this device. Open The Growth Project on your iPhone to connect it."
              : 'Apple Health is only on iPhone. Open The Growth Project on your iPhone to connect it, or connect Health Connect on this phone.'
            : `${name} can't be connected on this device.`,
        action: 'none',
      };
    case 'error': {
      const ref = referenceFor('wearables.on_device_permission', null, 'native_permission_error');
      return {
        text:
          `The ${name} permission screen didn't open, so nothing was read. Tap Continue to try again. ` +
          `If it keeps happening, write to ${WEARABLES_SUPPORT_EMAIL} and mention reference ${ref}.`,
        action: 'connect',
      };
    }
  }
}

/**
 * S-WEAR-3: what to do after an on-device store setting was opened and the
 * person comes back. Shown when Health Connect settings or its Play Store
 * page could not open.
 */
export function settingsDidNotOpenMessage(target: 'settings' | 'store', name: string): OnDeviceMessage {
  return target === 'settings'
    ? {
        text:
          `Health Connect didn't open. Open Settings on this phone, search for Health Connect, choose ` +
          `App permissions, then The Growth Project, and allow access. Then come back and tap Continue.`,
        action: 'connect',
      }
    : {
        text:
          `The Play Store didn't open. Open the Play Store, search for Health Connect and install or ` +
          `update it, then come back and tap Continue to connect ${name}.`,
        action: 'connect',
      };
}

/** After the person was sent to Health Connect settings or the Play Store. */
export function returnFromSettingsMessage(name: string): OnDeviceMessage {
  return {
    text: `When ${name} access is set up, tap Continue to connect.`,
    action: 'connect',
  };
}

/**
 * S-WEAR-3: an import that finished with nothing to bring in. On iPhone this
 * is also what turning every category off looks like (HealthKit never tells
 * an app what was declined), so the copy says where to check.
 */
export function emptyImportMessage(provider: WearableProvider, name: string): OnDeviceMessage {
  if (readsThroughHealthConnect(provider)) {
    return {
      text:
        `${name} is connected, but there was no data from the last 30 days to bring in. If you turned ` +
        `some data types off, tap Open Health Connect, choose App permissions, then The Growth Project, ` +
        `and turn them on. New data comes in each time you open Health.`,
      action: 'open_settings',
    };
  }
  return {
    text:
      `${name} is connected, but there was no data from the last 30 days to bring in. If you turned ` +
      `some categories off, open the Health app, tap your profile picture, then Apps, The Growth ` +
      `Project, and turn them on. New data comes in each time you open Health.`,
    action: 'none',
  };
}

/**
 * Sol B-317-8: copy for a failed cloud connect (Oura, WHOOP, Garmin, ...).
 * Reads the HTTP status and machine code, never the message text. Network
 * advice only for a real network failure; 401 offers Log in again; known
 * statuses get their own next step; anything else shows a short reference
 * and the support address and is reported to Sentry (status, code and
 * reference only).
 */
export function cloudConnectFailureMessage(err: unknown, name: string): OnDeviceMessage {
  if (axios.isAxiosError(err)) {
    const status = statusOf(err);
    const code = codeOf(err);
    if (status === null) {
      return {
        text: `The Growth Project couldn't be reached, so ${name} isn't connected yet. Check your internet connection, then tap Continue.`,
        action: 'connect',
      };
    }
    if (status === 401) {
      return {
        text: `Your session has ended, so ${name} isn't connected. Log in again, then connect ${name} from Connections.`,
        action: 'login',
      };
    }
    if (status === 403) {
      return {
        text: `${name} can be connected from a client account only. If you are a client and see this, contact your coach.`,
        action: 'none',
      };
    }
    if (status === 429) {
      return {
        text: `Too many tries in a short time, so ${name} isn't connected yet. Wait a minute, then tap Continue.`,
        action: 'connect',
      };
    }
    if (status === 503 && code === 'wearables_cloud_disabled') {
      return {
        text: `Connecting ${name} isn't switched on yet. Your coach will let you know when it is ready.`,
        action: 'none',
      };
    }
    const ref = referenceFor('wearables.cloud_connect', err, code);
    return {
      text:
        `${name} couldn't be connected because of an unexpected problem with The Growth Project. ` +
        `Reference ${ref}. Tap Continue in a few minutes, or write to ${WEARABLES_SUPPORT_EMAIL} and mention the reference.`,
      action: 'connect',
    };
  }
  // Not an HTTP failure: the in-app sign-in window failed to open.
  const ref = referenceFor('wearables.cloud_connect_browser', err, 'auth_session_error');
  return {
    text:
      `The ${name} sign-in window didn't open, so ${name} isn't connected. Tap Continue to try again. ` +
      `If it keeps happening, write to ${WEARABLES_SUPPORT_EMAIL} and mention reference ${ref}.`,
    action: 'connect',
  };
}

/** Another in-app sign-in window is already open (auth session `locked`). */
export function cloudSessionLockedMessage(name: string): OnDeviceMessage {
  return {
    text: `Another sign-in window is already open. Finish or close it, then tap Continue to connect ${name}.`,
    action: 'connect',
  };
}
