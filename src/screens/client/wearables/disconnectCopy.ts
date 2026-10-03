/**
 * S14 round 4b (Opus C-317-4, owner ruling 2026-10-02): what the Disconnect
 * confirm says, and what a failed disconnect says.
 *
 * The confirm names the source and what stops. It says plainly that data
 * already shared stays with the coach (the backend soft-disconnect only
 * changes the connection status; samples are kept). Failures map status and
 * machine code to what happened and a working next action; anything
 * unexpected shows a short reference and the support address and is
 * reported to Sentry (status, code and reference only).
 *
 * Plain warm words: no emojis, no exclamation marks.
 */

import axios from 'axios';
import type { WearableProvider } from '../../../api/wearablesConnectionsApi';
import { reportUnexpected } from '../../../lib/consultation/report';
import { newRequestId, shortReference, supportReferenceOf } from '../../../utils/correlation';
import { WEARABLES_SUPPORT_EMAIL } from './onDeviceCopy';

function isOnDevice(provider: WearableProvider): boolean {
  return provider === 'APPLE_HEALTHKIT' || provider === 'HEALTH_CONNECT';
}

export interface DisconnectConfirmCopy {
  title: string;
  body: string;
}

export function disconnectConfirmCopy(
  provider: WearableProvider,
  name: string,
): DisconnectConfirmCopy {
  const stops = isOnDevice(provider)
    ? `The Growth Project stops bringing in new ${name} data from this phone, and your coach stops seeing new ${name} data.`
    : `The Growth Project stops receiving new ${name} data, and your coach stops seeing new ${name} data.`;
  return {
    title: `Disconnect ${name}?`,
    body: `${stops} Data already shared stays with your coach. You can connect ${name} again at any time.`,
  };
}

export interface DisconnectFailure {
  text: string;
  /**
   * `retry`: tapping Disconnect again can work. `already`: there was nothing
   * to disconnect (refresh the list and close). `none`: retrying here will
   * not help (for example, the session ended).
   */
  kind: 'retry' | 'already' | 'none';
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

export function disconnectFailureMessage(err: unknown, name: string): DisconnectFailure {
  if (axios.isAxiosError(err)) {
    const status = statusOf(err);
    if (status === null) {
      return {
        text: `The Growth Project couldn't be reached, so ${name} is still connected. Check your internet connection, then tap Disconnect again.`,
        kind: 'retry',
      };
    }
    if (status === 401) {
      return {
        text: `Your session has ended, so ${name} is still connected. Log in again, then disconnect ${name} from Connections.`,
        kind: 'none',
      };
    }
    if (status === 404) {
      return { text: `${name} is already disconnected.`, kind: 'already' };
    }
    if (status === 403) {
      return {
        text: `${name} can be disconnected from a client account only, so nothing changed. If you are a client and see this, contact your coach.`,
        kind: 'none',
      };
    }
    if (status === 429) {
      return {
        text: `Too many tries in a short time, so ${name} is still connected. Wait a minute, then tap Disconnect again.`,
        kind: 'retry',
      };
    }
  }

  const requestId = supportReferenceOf(err) ?? newRequestId();
  reportUnexpected('wearables.disconnect', {
    status: statusOf(err),
    code: codeOf(err),
    requestId,
  });
  const ref = shortReference(requestId) ?? 'unavailable';
  return {
    text: `${name} couldn't be disconnected because of an unexpected problem with The Growth Project, so it is still connected. Reference ${ref}. Tap Disconnect again in a few minutes, or write to ${WEARABLES_SUPPORT_EMAIL} and mention the reference.`,
    kind: 'retry',
  };
}
