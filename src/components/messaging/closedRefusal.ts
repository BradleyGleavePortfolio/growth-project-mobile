/**
 * BLOCK-ALL-M: which failed requests mean "this conversation is closed to me". Pure (no React Native), so the query
 * client's retry rule reads it too: a closed answer is final, never retried (FX-872: no box while a refusal retries).
 */

/** Backend answers that mean "closed to you" (messaging-errors.ts, community-safety, community.service, posts). */
const CLOSED_CODES = new Set([
  'messaging.blocked', // edit / pin / react with a block on either side
  'community.dm.blocked_by_you', // a DM to someone I blocked
  'community.dm.blocked_by_them', // a DM with someone who blocked me (#169-5, b#1145)
  'community.dm.not_found', // a DM with someone who blocked me or left (the block is never disclosed)
  'community.workspace.no_access', // banned, or no longer a member
  'community.cohort.no_access',
  'community.post.not_found', // the Hall or a post the viewer can no longer open (a ban reads as not found)
  'community.challenge.not_found', // a challenge's notes after a ban or a block
]);
/** The coaching send refusal carries no code, only this text (backend messaging.service sendAsCoach / sendAsClient). */
const COACHING_BLOCKED = 'Messages cannot be sent to blocked users';

type ErrLike = {
  status?: number;
  code?: unknown;
  userMessage?: unknown;
  cause?: unknown;
  response?: { status?: number; data?: { code?: unknown; error?: unknown; message?: unknown } };
};

/** True when a failed request means this conversation is closed to the viewer (axios errors, MessagingApiError, and
 * CommunityApiError, which keeps the axios error as `cause`). */
export function isClosedRefusal(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as ErrLike;
  if (depth < 2 && e.cause && isClosedRefusal(e.cause, depth + 1)) return true;
  const data = e.response?.data;
  const code = typeof data?.code === 'string' ? data.code : e.code;
  if (typeof code === 'string' && CLOSED_CODES.has(code)) return true;
  const status = e.response?.status ?? e.status;
  return status === 403 && (data?.error === 'BLOCKED' || data?.message === COACHING_BLOCKED || e.userMessage === COACHING_BLOCKED);
}

/** Refusals this session already got, by the other person's id: leaving and coming back keeps the chat closed. Cleared
 * when I unblock that person or the server's own row says open again (FX-872, Opus B4). */
const refusedWith = new Set<string>();
const listeners = new Set<() => void>();

export const closedRefusals = {
  has: (userId: string | null | undefined) => !!userId && refusedWith.has(userId),
  add(userId: string | null | undefined) {
    if (!userId || refusedWith.has(userId)) return;
    refusedWith.add(userId);
    listeners.forEach((l) => l());
  },
  clear(userId: string | null | undefined) {
    if (!userId || !refusedWith.delete(userId)) return;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
};
