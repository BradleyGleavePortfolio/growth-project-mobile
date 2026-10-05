/**
 * romanEraseTracker: the Roman chat erases still on their way to the server,
 * per account (Sol B-331-5).
 *
 * A delete that has already left the phone cannot be called back, and its
 * answer is dropped when the sign-in changes. If the same account signs in
 * again before it settles, a list read started right away could be answered
 * from before the erase and show the erased chat again. So every list read
 * first waits for the erases of its own account to settle (success or not),
 * then reads: whatever the server says after that is the truth. Erases of
 * another account never delay a read.
 *
 * Holds only the account subject (never a token) and the request promise.
 * Nothing is stored or logged.
 */
const inflight = new Map<string, Set<Promise<unknown>>>();

/** Track one erase for `subject` until it settles; returns the same promise. */
export function trackErase<T>(subject: string, request: Promise<T>): Promise<T> {
  let set = inflight.get(subject);
  if (!set) {
    set = new Set();
    inflight.set(subject, set);
  }
  const entry: Promise<unknown> = request.then(
    () => undefined,
    () => undefined,
  );
  set.add(entry);
  void entry.then(() => {
    const s = inflight.get(subject);
    if (!s) return;
    s.delete(entry);
    if (s.size === 0) inflight.delete(subject);
  });
  return request;
}

/** Resolves once every erase of `subject` started so far has settled. Never rejects. */
export async function erasesSettled(subject: string): Promise<void> {
  const set = inflight.get(subject);
  if (!set || set.size === 0) return;
  await Promise.all([...set]);
}

/** Test-only: erases still in flight for `subject`. */
export function __erasesInFlightForTests(subject: string): number {
  return inflight.get(subject)?.size ?? 0;
}
