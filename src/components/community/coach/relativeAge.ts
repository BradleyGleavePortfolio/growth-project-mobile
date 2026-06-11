/**
 * relativeAge — compact, deterministic "age" label for coach rows (inbox items,
 * flagged content). Renders the elapsed time since an ISO timestamp as a short
 * string: "now", "5m", "3h", "2d", "4w". Pure and timezone-agnostic (operates
 * on epoch millis) so it is trivially unit-testable.
 *
 * Returns "now" for anything under a minute and for future / unparseable
 * timestamps (clock skew degrades gracefully rather than printing "-3m").
 */
export function relativeAge(iso: string, nowMs: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'now';
  const deltaMs = nowMs - then;
  if (deltaMs < 60_000) return 'now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

/**
 * v2-2 (R1 fixer, M-NEW): compose the message-detail ack timestamp strip from a
 * flat ack envelope's `*_at` fields, e.g. "Seen 4m ago · Acked 2m ago · Replied
 * now". Only stamped stages appear (a null timestamp is skipped), in ack order
 * (seen → acked → replied). Returns an empty string when no stage is stamped so
 * the caller can omit the strip entirely. Pure + timezone-agnostic (delegates
 * to `relativeAge`), so it is trivially unit-testable.
 */
export function formatAckTimestampStrip(
  ack: {
    seen_at: string | null;
    acked_at: string | null;
    replied_at: string | null;
  } | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (ack == null) return '';
  const parts: string[] = [];
  if (ack.seen_at) parts.push(`Seen ${ageWithAgo(ack.seen_at, nowMs)}`);
  if (ack.acked_at) parts.push(`Acked ${ageWithAgo(ack.acked_at, nowMs)}`);
  if (ack.replied_at)
    parts.push(`Replied ${ageWithAgo(ack.replied_at, nowMs)}`);
  return parts.join(' · ');
}

/** "now" stays "now"; everything else gets a trailing " ago". */
function ageWithAgo(iso: string, nowMs: number): string {
  const age = relativeAge(iso, nowMs);
  return age === 'now' ? 'just now' : `${age} ago`;
}
