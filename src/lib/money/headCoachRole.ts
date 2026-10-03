/**
 * B-332-9 (Opus) — whether the signed-in coach's money is handled by a head
 * coach (an active sub-coach: Money and Connect routes answer 403
 * `sub_coach_billing_blocked`).
 *
 * The Home Money card and the Money page learn it from the server; Settings
 * reads it here (no extra request) to hide the Money row. It lives only for
 * the current session: sign-in and sign-out reset it, so one account's role
 * never carries over to the next.
 */
import { useSyncExternalStore } from "react";
import { authEvents } from "../../utils/authEvents";

let handles = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Record what the server said for the signed-in coach. */
export function noteHeadCoachHandlesMoney(value: boolean): void {
  wireAuthReset();
  if (handles === value) return;
  handles = value;
  emit();
}

export function headCoachHandlesMoney(): boolean {
  return handles;
}

// Reset on every sign-in and sign-out. Wired on first use, so importing this
// module never touches auth state.
let wired = false;
function wireAuthReset(): void {
  if (wired) return;
  wired = true;
  const reset = () => noteHeadCoachHandlesMoney(false);
  authEvents.on("logout", reset);
  authEvents.on("login", reset);
}

function subscribe(listener: () => void): () => void {
  wireAuthReset();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHeadCoachHandlesMoney(): boolean {
  return useSyncExternalStore(
    subscribe,
    headCoachHandlesMoney,
    headCoachHandlesMoney,
  );
}
