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

/** Why on-device work stopped. */
export type OnDeviceStopReason = 'session_changed' | 'cancelled';

/** Thrown when the session changed under in-flight on-device work. */
export class OnDeviceSessionChangedError extends Error {
  readonly reason: OnDeviceStopReason;

  constructor(reason: OnDeviceStopReason = 'session_changed') {
    super(
      reason === 'cancelled'
        ? 'The on-device health work was cancelled.'
        : 'The signed-in account changed; on-device health work stopped.',
    );
    this.name = 'OnDeviceSessionChangedError';
    this.reason = reason;
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
  /**
   * Stop this run for good (the Connect sheet closed or unmounted). Every
   * later {@link assertCurrent} throws with reason `cancelled`.
   */
  cancel(): void;
}

function fenceFrom(
  userId: string,
  startedAt: number,
  readUserId: () => Promise<string | null>,
): SessionFence {
  let cancelled = false;
  const check = (): void => {
    if (cancelled) throw new OnDeviceSessionChangedError('cancelled');
    if (generation !== startedAt) throw new OnDeviceSessionChangedError();
  };
  return {
    userId,
    async assertCurrent() {
      check();
      const now = await readUserId();
      check();
      if (now !== userId) throw new OnDeviceSessionChangedError();
    },
    cancel() {
      cancelled = true;
    },
  };
}

/**
 * A fence for a user id that was read BEFORE this call. Prefer
 * {@link beginSessionFence}: it captures the auth generation before it reads
 * the user, so an auth event during that read is caught too.
 */
export function createSessionFence(
  userId: string,
  readUserId: () => Promise<string | null> = readSignedInUserId,
): SessionFence {
  return fenceFrom(userId, generation, readUserId);
}

/**
 * S14 round 3 (Sol A-317-1): capture the auth generation synchronously,
 * THEN read the signed-in user. Called when the person taps Continue, before
 * any native permission prompt, so the whole Connect run (prompt, register,
 * local authorization, import) stays bound to the person who tapped. Resolves
 * null when nobody is signed in or the session moved during the read.
 */
export async function beginSessionFence(
  readUserId: () => Promise<string | null> = readSignedInUserId,
): Promise<SessionFence | null> {
  const startedAt = generation;
  const userId = await readUserId();
  if (!userId || generation !== startedAt) return null;
  return fenceFrom(userId, startedAt, readUserId);
}
