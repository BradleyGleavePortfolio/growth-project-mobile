/**
 * sessionFence: one ordering rule for every write of the session credential
 * (the `supabase_token` / `supabase_refresh_token` pair). Mobile #331
 * A-331-7 / B-331-7 / B-331-8.
 *
 * The token refresh in services/api.ts runs across several awaits (read the
 * refresh token, ask Supabase, write two SecureStore keys), and sign-in and
 * sign-out write the same keys from other call sites (LoginScreen,
 * CreateAccountScreen, appleAuth, googleAuth, authActions.signOut). A check
 * followed by an await is not a guard: another sign-in can land in the gap.
 * So:
 *
 *   - Every write or removal of a session key goes through
 *     `beforeSessionWrite()` (secureStorage.setItem / removeItem call it for
 *     those keys). It bumps the session GENERATION synchronously, at call
 *     time, before any await, and then waits until no other party holds the
 *     fence, so the newer write always lands last.
 *   - A refresh captures the generation when it starts. It may publish its
 *     tokens only by taking the fence for that same generation
 *     (`holdSessionFence`), which is synchronous: there is no await between
 *     the check and taking the fence. A sign-in or sign-out that began
 *     earlier has already moved the generation, so the overtaken refresh
 *     writes nothing. One that begins while the refresh writes waits, and
 *     then overwrites.
 *   - A failed refresh signs out only by taking the fence for the generation
 *     it started in, and holds it for the whole sign-out. A sign-in that
 *     begins meanwhile waits and writes its tokens after the sign-out has
 *     finished, so the new account is never signed out by the old one's
 *     failure.
 *   - The holder's own writes pass the fence with its pass (no bump, no
 *     wait), so holding the fence can never deadlock its holder.
 *
 * Refreshing the same session does not change the generation. A sign-out and
 * sign-in of the same account (A -> logout -> A) does. Nothing here is stored,
 * logged or reported.
 */

declare const passBrand: unique symbol;
/** Opaque proof of holding the fence; only `holdSessionFence` makes one. */
export type SessionFencePass = { readonly [passBrand]: true };

interface Holder {
  readonly pass: SessionFencePass;
  readonly done: Promise<void>;
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

/**
 * Call before writing or removing a session key. Without the holder's pass:
 * bumps the generation now (synchronously) and resolves once no other party
 * holds the fence. With the holder's pass: resolves at once, no bump.
 */
export async function beforeSessionWrite(pass?: SessionFencePass): Promise<void> {
  if (pass !== undefined && holder !== null && holder.pass === pass) return;
  generation += 1;
  // Loop: another holder could take the fence before this write resumes.
  while (holder !== null && holder.pass !== pass) {
    await holder.done;
  }
}

/**
 * Take the fence for the session of generation `expected`. Returns null, and
 * holds nothing, when that session was already replaced or ended (the
 * generation moved) or someone else holds the fence. Release exactly once,
 * in a finally block.
 */
export function holdSessionFence(expected: number): { pass: SessionFencePass; release: () => void } | null {
  if (generation !== expected || holder !== null) return null;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const pass = Object.freeze({}) as SessionFencePass;
  const mine: Holder = { pass, done };
  holder = mine;
  let released = false;
  return {
    pass,
    release: () => {
      if (released) return;
      released = true;
      if (holder === mine) holder = null;
      resolveDone();
    },
  };
}

/** Test-only reset. */
export function __resetSessionFenceForTests(): void {
  generation = 0;
  holder = null;
}
