import { authEvents } from '../../utils/authEvents';

/**
 * Smart Dunning v2 — the app-wide "payment lockout" signal (S-DUNNING).
 *
 * The backend answers EVERY non-allowed route with
 * `403 { code: 'LOCKED_DUNNING' }` once a client's payment has been
 * unresolved for 10 days. The axios response interceptor
 * (src/services/api.ts) reports each of those here; the
 * DunningLockoutProvider subscribes and renders one calm full-screen state
 * instead of letting every screen show its own error.
 *
 * Module-level (not React context) on purpose: the interceptor lives outside
 * React, and EntitlementProvider reads `isLocked()` to keep the paywall sheet
 * from stacking on top of the lockout screen.
 *
 * B-352-1 (account ownership): the signal belongs to one auth generation.
 * The generation is retired synchronously at every identity boundary
 * (`authEvents` 'logout' / 'login', and the provider's unmount when the
 * client tree goes away), which clears the signal. The request interceptor
 * stamps every request with the generation it started under, and a 403
 * from a retired generation is dropped before it can write here, so a late
 * answer for the previous account never locks the next one. A same-account
 * token refresh does not change the generation.
 */

export const LOCKED_DUNNING_CODE = 'LOCKED_DUNNING';

export interface DunningLockedSignal {
  /** Backend request id of the 403, for the support reference. */
  requestId: string | null;
  /** The route that was refused (for diagnostics only, never shown). */
  requestUrl?: string;
  /**
   * Auth generation the refused request started under (stamped by the api
   * request interceptor, or read by the provider before its status call). A
   * signal without one counts as generation 0 (process start), so it is
   * accepted only until the first identity boundary.
   */
  generation?: number;
}

type Listener = (locked: boolean, signal: DunningLockedSignal | null) => void;

let locked = false;
let lastSignal: DunningLockedSignal | null = null;
let generation = 0;
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((fn) => fn(locked, lastSignal));
}

export const dunningLockoutStore = {
  isLocked(): boolean {
    return locked;
  },
  lastSignal(): DunningLockedSignal | null {
    return lastSignal;
  },
  /** The current auth generation (stamped on requests; compared after every await). */
  currentGeneration(): number {
    return generation;
  },
  /** Called by the API interceptor on a 403 LOCKED_DUNNING. Dropped when its generation is retired. */
  reportLocked(signal: DunningLockedSignal): void {
    if ((signal.generation ?? 0) !== generation) return;
    lastSignal = { requestId: signal.requestId, requestUrl: signal.requestUrl };
    if (locked) return;
    locked = true;
    notify();
  },
  /**
   * Called when a fresh status read (or a payment) shows the client is not
   * locked. With `forGeneration`, a clear from a retired generation is dropped.
   */
  clear(forGeneration?: number): void {
    if (forGeneration !== undefined && forGeneration !== generation) return;
    if (!locked && lastSignal === null) return;
    locked = false;
    lastSignal = null;
    notify();
  },
  /**
   * Identity boundary: retire the current generation (every request or read
   * started before now can no longer write here) and drop the signal.
   */
  retire(): void {
    generation += 1;
    if (!locked && lastSignal === null) return;
    locked = false;
    lastSignal = null;
    notify();
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** Test seam: reset module state between cases. */
  __resetForTests(): void {
    locked = false;
    lastSignal = null;
    generation = 0;
    listeners.clear();
  },
};

// The app's sign-out boundary (signOut, refresh failure, biometric lock) and
// any explicit sign-in emit these synchronously. Guarded because many suites
// replace authEvents with a partial double (emit or onAuthChange only).
if (typeof (authEvents as Partial<typeof authEvents>).on === 'function') {
  authEvents.on('logout', () => dunningLockoutStore.retire());
  authEvents.on('login', () => dunningLockoutStore.retire());
}

/** Request config field carrying the auth generation a request started under. */
type GenerationStamped = { _dunningGeneration?: number };

/** Called first in the api request interceptor (before any await). */
export function stampDunningGeneration<T extends object>(config: T): T {
  (config as GenerationStamped)._dunningGeneration = generation;
  return config;
}

/** The generation stamped on a request config; undefined when it was never stamped. */
export function dunningGenerationOf(config: unknown): number | undefined {
  const g = config && typeof config === 'object' ? (config as GenerationStamped)._dunningGeneration : undefined;
  return typeof g === 'number' ? g : undefined;
}

/** True when an axios-style error body is the backend's dunning lockout. */
export function isLockedDunningResponse(status: number | undefined, data: unknown): boolean {
  if (status !== 403 || !data || typeof data !== 'object') return false;
  return (data as { code?: unknown }).code === LOCKED_DUNNING_CODE;
}
