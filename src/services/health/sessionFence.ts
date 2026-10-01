/**
 * S14 (audit A-317-1) — session fence for on-device health work.
 *
 * A history import reads the phone's health store and posts it in many
 * requests. If the person signs out, or a different account signs in, while
 * that is running, nothing more may be sent: the shared HTTP client would
 * attach the NEW session's token to the OLD account's data.
 *
 * A fence captures the user id and an auth generation when the work starts.
 * Every auth event (login, logout, role change) bumps the generation, and
 * `assertCurrent()` also re-reads the signed-in user. The sync services call
 * it before every ingest request and before saving progress.
 */

import { readUserCache } from '../../lib/userCache';
import { authEvents } from '../../utils/authEvents';

/** Thrown when the session changed under in-flight on-device work. */
export class OnDeviceSessionChangedError extends Error {
  constructor() {
    super('The signed-in account changed; on-device health work stopped.');
    this.name = 'OnDeviceSessionChangedError';
  }
}

let generation = 0;
authEvents.onAuthChange(() => {
  generation += 1;
});

/** Current auth generation (tests). */
export function currentAuthGeneration(): number {
  return generation;
}

/** Signed-in user id from the identity cache, or null. */
export async function readSignedInUserId(): Promise<string | null> {
  try {
    const user = await readUserCache();
    return typeof user?.id === 'string' && user.id.length > 0 ? user.id : null;
  } catch {
    return null;
  }
}

export interface SessionFence {
  readonly userId: string;
  /** Throws {@link OnDeviceSessionChangedError} if the session moved on. */
  assertCurrent(): Promise<void>;
}

export function createSessionFence(
  userId: string,
  readUserId: () => Promise<string | null> = readSignedInUserId,
): SessionFence {
  const startedAt = generation;
  return {
    userId,
    async assertCurrent() {
      if (generation !== startedAt) throw new OnDeviceSessionChangedError();
      const now = await readUserId();
      if (now !== userId || generation !== startedAt) throw new OnDeviceSessionChangedError();
    },
  };
}
