/**
 * LEAVE-MUTE-M (agent 203): the pure rules of leaving and muting, one copy each.
 *   - A space row from GET /community/cohorts?include_left=1 is left when its left_at is set (an older server sends no
 *     left_at and no left rows: every row is in). Every reader of the list goes through isLeft / splitCohorts.
 *   - Leave space shows only where the server allows it (b#1168 service :81-83, R6): a chat space, and the caller is not
 *     that community's coach. A kind an older server leaves out hides it.
 *   - The stream (weaveStream): "{name} left" lines between messages by time, only inside the loaded range (R9); the
 *     Muted mark under a muted thread's first message; a left thread's replies after `since` folded into one line where
 *     the first of them would be (R8: the count is what is loaded), and once opened, Follow thread under the last one.
 */
import type { SpaceLeftRow, SpaceThreadState } from './spaceLeaveMuteApi';

type CohortLike = { kind?: string | null; my_role?: string | null; left_at?: unknown } | null | undefined;

export const isLeft = (c: CohortLike): boolean => typeof c?.left_at === 'string' && c.left_at.length > 0;

export const canLeave = (c: CohortLike): boolean => !!c && c.kind === 'chat' && c.my_role !== 'coach' && c.my_role !== 'owner';

/** The rows she is in and the rows she left, each in the server's order. */
export function splitCohorts<T extends { left_at?: unknown }>(rows: readonly T[]): { in: T[]; left: T[] } {
  const out = { in: [] as T[], left: [] as T[] };
  for (const r of rows) (isLeft(r) ? out.left : out.in).push(r);
  return out;
}

export type StreamExtra =
  | { type: 'left'; key: string; name: string; at: string }
  | { type: 'fold'; key: string; threadId: string; count: number }
  | { type: 'mark'; key: string; threadId: string }
  | { type: 'follow'; key: string; threadId: string };

type StreamMessage = { id: string; created_at: string; sender_user_id: string; parent_message_id?: string | null; parent?: { id: string } | null; deleted?: boolean };

/** The thread a message belongs to: its first message (itself, when it is one). */
export const threadOf = (m: StreamMessage): string => m.parent?.id ?? m.parent_message_id ?? m.id;
export const isReply = (m: StreamMessage): boolean => !!(m.parent?.id ?? m.parent_message_id);

export interface WeaveInput<I> {
  /** The stream as the screen builds it, newest first (the inverted list's order). */
  items: readonly I[];
  /** An item's time (null: a line with no time of its own, such as New messages). */
  timeOf: (item: I) => string | null;
  /** The server message an item draws, if any. */
  messageOf: (item: I) => StreamMessage | null;
  lefts: readonly SpaceLeftRow[];
  threads: readonly SpaceThreadState[];
  /** Left threads she opened on this visit. */
  opened: ReadonlySet<string>;
  /** The oldest message loaded, and whether the loaded pages are the whole space (no older page). */
  oldestAt: string | null;
  whole: boolean;
}

/** The stream with its leave and thread lines, newest first. */
export function weaveStream<I>(input: WeaveInput<I>): Array<I | StreamExtra> {
  const { items, timeOf, messageOf, threads, opened, oldestAt, whole } = input;
  const muted = new Set(threads.filter((t) => t.state === 'muted').map((t) => t.thread_message_id));
  const leftSince = new Map(threads.filter((t) => t.state === 'left').map((t) => [t.thread_message_id, t.since]));
  const oldestFirst = [...items].reverse();
  // A left thread's replies after she left it: hidden behind one line unless she opened it.
  const hidden = (m: StreamMessage | null) => {
    if (!m || !isReply(m)) return null;
    const since = leftSince.get(threadOf(m));
    return since !== undefined && m.created_at > since ? threadOf(m) : null;
  };
  const counts = new Map<string, number>();
  const lastReply = new Map<string, string>();
  for (const it of oldestFirst) {
    const m = messageOf(it);
    const t = hidden(m);
    if (t && m) { counts.set(t, (counts.get(t) ?? 0) + 1); lastReply.set(t, m.id); }
  }
  const lefts = [...input.lefts]
    .filter((l) => whole || (!!oldestAt && l.left_at >= oldestAt))
    .sort((a, b) => a.left_at.localeCompare(b.left_at));
  let next = 0;
  const out: Array<I | StreamExtra> = [];
  const flush = (before: string | null) => {
    while (next < lefts.length && (before === null || lefts[next].left_at < before)) {
      const l = lefts[next++];
      out.push({ type: 'left', key: `left-${l.user_id}-${l.left_at}`, name: l.name, at: l.left_at });
    }
  };
  const folded = new Set<string>();
  for (const it of oldestFirst) {
    const at = timeOf(it);
    if (at) flush(at);
    const m = messageOf(it);
    const t = hidden(m);
    if (t && m) {
      if (!opened.has(t)) {
        if (!folded.has(t)) { folded.add(t); out.push({ type: 'fold', key: `fold-${t}`, threadId: t, count: counts.get(t) ?? 0 }); }
        continue;
      }
      out.push(it);
      if (lastReply.get(t) === m.id) out.push({ type: 'follow', key: `follow-${t}`, threadId: t });
      continue;
    }
    out.push(it);
    if (m && !isReply(m) && !m.deleted && muted.has(m.id)) out.push({ type: 'mark', key: `mark-${m.id}`, threadId: m.id });
  }
  flush(null);
  return out.reverse();
}
