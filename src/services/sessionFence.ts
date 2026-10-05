/**
 * sessionFence: one ordering rule for every write of the session credential
 * (the `supabase_token` / `supabase_refresh_token` pair). Mobile #331
 * A-331-7 / B-331-7 / B-331-8.
 *
 * The token refresh in services/api.ts runs across several awaits (read the
 * refresh token, ask Supabase, write two SecureStore keys), and sign-in and
 * sign-out write the same keys from other call sites (LoginScreen,
 * CreateAccountScreen, appleAuth, googleAuth, authActions.signOut), one key
 * at a time. A check followed by an await is not a guard: another sign-in can
 * land in the gap. So:
 *
 *   - Every write or removal of a session key runs through `runSessionWrite`
 *     (secureStorage.setItem / removeItem do this for those keys). It moves
 *     the session GENERATION synchronously at call time, waits until nobody
 *     holds the fence, then HOLDS the fence for its whole native write, and
 *     moves the generation again when the write has landed. So nothing can
 *     publish between "called" and "landed", and anything that started while
 *     a write was pending sees the generation move.
 *   - A refresh captures the generation when it starts, after waiting for
 *     writes in flight (`sessionWritesSettled`). It may publish its tokens
 *     only by taking the fence for that same generation (`holdSessionFence`),
 *     synchronously, with no await between the check and taking it. A
 *     sign-in or sign-out that wrote either key since the refresh started
 *     (even one key of the pair, even one still landing) has moved the
 *     generation, so the overtaken refresh writes nothing. One that begins
 *     while the refresh writes waits, and then overwrites.
 *   - A 401 for a request first sent in an older generation never starts or
 *     joins a refresh (services/api.ts): it belongs to a session that ended.
 *   - The one-time copy of a legacy AsyncStorage value into SecureStore
 *     (secureStorage.ts, first read after an upgrade) runs through
 *     `runSessionMigration`: bound to the generation read before the legacy
 *     read, held for the whole copy, refused once a sign-in or sign-out moved
 *     the generation (Sol A-331-7 round 3).
 *   - A failed refresh signs out only by taking the fence for the generation
 *     it started in, and holds it for the whole sign-out (kind 'signout').
 *     A sign-in that begins meanwhile waits and writes its tokens after the
 *     sign-out has finished. Releasing that hold ends the session (the
 *     generation moves).
 *   - The holder's own writes pass the fence with its pass (no wait), so
 *     holding the fence can never deadlock its holder. Token reads by the
 *     API client wait only for 'write' holds (short native writes), never
 *     for a sign-out, which may itself make requests.
 *
 * Refreshing the same session does not change the generation. A sign-out and
 * sign-in of the same account (A -> logout -> A) does. Nothing here is stored,
 * logged or reported.
 */

declare const passBrand: unique symbol;
/** Opaque proof of holding the fence; only this module makes one. */
export type SessionFencePass = { readonly [passBrand]: true };

type HoldKind = 'write' | 'signout';

interface Holder {
  readonly pass: SessionFencePass;
  readonly kind: HoldKind;
  readonly done: Promise<void>;
}

export interface SessionFenceHold {
  readonly pass: SessionFencePass;
  /** Release exactly once (finally). `endsSession` moves the generation. */
  release: (endsSession?: boolean) => void;
}

let generation = 0;
let holder: Holder | null = null;

/** The current session generation (moves on every sign-in / sign-out write). */
export function sessionGeneration(): number {
  return generation;
}

/** True while some party holds the fence. */
export function sessionFenceHeld(): boolean {
  return holder !== null;
}

function take(kind: HoldKind): SessionFenceHold {
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const pass = Object.freeze({}) as SessionFencePass;
  const mine: Holder = { pass, kind, done };
  holder = mine;
  let released = false;
  return {
    pass,
    release: (endsSession = false) => {
      if (released) return;
      released = true;
      if (endsSession) generation += 1;
      if (holder === mine) holder = null;
      resolveDone();
    },
  };
}

/**
 * Run one native write or removal of a session key. Without the holder's
 * pass: moves the generation now (synchronously, at call time), waits until
 * nobody holds the fence, holds it for the write, and moves the generation
 * again once the write has landed. With the holder's pass: runs at once.
 */
export async function runSessionWrite<T>(pass: SessionFencePass | undefined, write: () => Promise<T>): Promise<T> {
  if (pass !== undefined && holder !== null && holder.pass === pass) return write();
  generation += 1;
  while (holder !== null) {
    await holder.done;
  }
  // No await between the loop's last check and taking the fence.
  const mine = take('write');
  try {
    return await write();
  } finally {
    mine.release(true);
  }
}

/**
 * Mobile #331 A-331-7 (Sol, round 3): copy a legacy (pre-SecureStore) value of
 * a session key for the session of generation `expected`, which the caller
 * read BEFORE it read the legacy value. Waits only for short 'write' holds,
 * never for a sign-out (which may itself read a token). Then, with no await
 * between the check and taking the fence, it copies only while that session
 * is still current and nobody holds the fence, and holds the fence until the
 * copy has landed. A sign-in or sign-out that wrote either key since
 * `expected` was read (even one still landing) has moved the generation, so
 * nothing is copied (false). One that begins during the copy waits for it and
 * then overwrites. The copy keeps the same session, so, like a refresh
 * commit, it does not move the generation.
 */
export async function runSessionMigration(expected: number, copy: () => Promise<void>): Promise<boolean> {
  while (holder !== null && holder.kind === 'write') {
    await holder.done;
  }
  if (generation !== expected || holder !== null) return false;
  const mine = take('write');
  try {
    await copy();
    return true;
  } finally {
    mine.release();
  }
}

/** Resolves once no session-key write (or refresh commit) is landing. */
export async function sessionWritesSettled(): Promise<void> {
  while (holder !== null && holder.kind === 'write') {
    await holder.done;
  }
}

/**
 * Take the fence for the session of generation `expected`. Returns null, and
 * holds nothing, when that session was already replaced or ended (the
 * generation moved) or someone else holds the fence.
 */
export function holdSessionFence(expected: number, kind: HoldKind = 'write'): SessionFenceHold | null {
  if (generation !== expected || holder !== null) return null;
  return take(kind);
}

/** Test-only reset. */
export function __resetSessionFenceForTests(): void {
  generation = 0;
  holder = null;
}
