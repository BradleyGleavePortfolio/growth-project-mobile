/**
 * FIX-942 (LO-942 B1, LS-942 B3): the queues of unsent content on this phone that wipe themselves at sign-out (space
 * chat texts, voice notes). Each registers when its module loads, the moment it starts listening for the sign-out that
 * wipes it, so a queue that is wiped is a queue that is counted. services/authActions.sendUnsyncedLogs gives each one
 * try and counts what is left in the sign-out confirm, for the signing-out account only. A light module on purpose:
 * authActions does not load the queues (the voice queue starts its driver on load).
 */
export interface SignOutQueue {
  /** This account's items still only on this phone: waiting, failed (refused too) and on their way. */
  count: (userId: string) => Promise<number>;
  /** One try to send them, as this account. */
  send: (userId: string) => Promise<void>;
}

const queues = new Map<string, SignOutQueue>();

export function registerSignOutQueue(name: string, queue: SignOutQueue): void {
  queues.set(name, queue);
}

export function signOutQueues(): SignOutQueue[] {
  return [...queues.values()];
}
