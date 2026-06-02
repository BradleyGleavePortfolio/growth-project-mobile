/**
 * relativeTime — humanise an ISO timestamp into a short "3h ago" string.
 *
 * Mirrors the exact thresholds of the existing `relativeTime` in
 * `ConnectionsScreen.tsx` (the freshness "last synced" copy must read
 * identically across the Connections hub and the wearables cards/detail).
 * Extracted into its own pure module so the cards don't import the whole
 * ConnectionsScreen (which would drag in React Query hooks + the connect
 * sheet) just for a string helper. Total + pure (never throws); a malformed
 * date returns `null` so the caller can fall back to its own copy.
 */

export function relativeTime(
  iso: string | null,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = now - t;
  if (diffMs < 0) return 'just now';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}
