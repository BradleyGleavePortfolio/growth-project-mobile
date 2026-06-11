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
