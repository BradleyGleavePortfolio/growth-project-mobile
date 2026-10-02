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
import { reportUnexpected } from '../../../lib/consultation/report';
import { newRequestId, shortReference, supportReferenceOf } from '../../../utils/correlation';
import {
  OnDeviceNotSignedInError,
  OnDeviceStepError,
  type OnDeviceImportOutcome,
} from '../../../services/health/onDeviceSync';
import { OnDeviceSessionChangedError } from '../../../services/health/sessionFence';
import {
  HealthConnectPermissionDeniedError,
  HealthConnectUnavailableError,
} from '../../../services/health/healthConnect/errors';

/** Where people write when something unexpected happens. */
export const WEARABLES_SUPPORT_EMAIL = 'hello@thegrowthproject.app';

/** What the sheet shows, and which action its primary button runs. */
export interface OnDeviceMessage {
  text: string;
  /**
   * `connect` re-runs Connect from the start, `resume` continues the import
   * for the same connection, `none` means there is nothing to retry here
   * (for example, the person must log in again).
   */
  action: 'connect' | 'resume' | 'none';
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
        `${name} is connected. We brought in part of your last 30 days. ` +
        `Tap Continue import to bring in the rest. It also continues each time you open Health.`,
      action: 'resume',
    };
  }
  return {
    text:
      `${name} is connected, but we couldn't read your history yet. ` +
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
      text: `You're signed out. Log in again, then connect ${name} from Connections.`,
      action: 'none',
    };
  }

  const step = err instanceof OnDeviceStepError ? err.step : 'import';
  const cause = err instanceof OnDeviceStepError ? err.cause : err;
  const connected = step === 'import';
  const action: OnDeviceMessage['action'] = connected ? 'resume' : 'connect';
  const retryWord = connected ? 'Try again' : 'Continue';

  if (cause instanceof HealthConnectPermissionDeniedError) {
    return {
      text: `${name} access wasn't granted. Open ${name} permissions, allow access for The Growth Project, then tap ${retryWord}.`,
      action,
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
          : `We couldn't reach The Growth Project to connect ${name}. Check your internet connection, then tap Continue.`,
        action,
      };
    }
    if (status === 401) {
      return {
        text: `Your session has ended. Log in again, then connect ${name} from Connections.`,
        action: 'none',
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
          ? `${name} is connected. We paused bringing in your history because of too many requests. Wait a minute, then tap Try again.`
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
      ? `${name} is connected, but your history didn't finish coming in because of a problem on our side. Reference ${ref}. Tap Try again in a few minutes, or write to ${WEARABLES_SUPPORT_EMAIL} and mention the reference.`
      : `We couldn't connect ${name} because of a problem on our side. Reference ${ref}. Tap Continue in a few minutes, or write to ${WEARABLES_SUPPORT_EMAIL} and mention the reference.`,
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
