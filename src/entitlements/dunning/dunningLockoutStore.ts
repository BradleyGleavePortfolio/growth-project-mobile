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
 */

export const LOCKED_DUNNING_CODE = 'LOCKED_DUNNING';

export interface DunningLockedSignal {
  /** Backend request id of the 403, for the support reference. */
  requestId: string | null;
  /** The route that was refused (for diagnostics only, never shown). */
  requestUrl?: string;
}

type Listener = (locked: boolean, signal: DunningLockedSignal | null) => void;

let locked = false;
let lastSignal: DunningLockedSignal | null = null;
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
  /** Called by the API interceptor on a 403 LOCKED_DUNNING. */
  reportLocked(signal: DunningLockedSignal): void {
    lastSignal = signal;
    if (locked) return;
    locked = true;
    notify();
  },
  /** Called when a fresh status read (or a payment) shows the client is not locked. */
  clear(): void {
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
    listeners.clear();
  },
};

/** True when an axios-style error body is the backend's dunning lockout. */
export function isLockedDunningResponse(status: number | undefined, data: unknown): boolean {
  if (status !== 403 || !data || typeof data !== 'object') return false;
  return (data as { code?: unknown }).code === LOCKED_DUNNING_CODE;
}
