/**
 * dedupeById — merge cursor-paginated pages into one list without duplicate
 * rows. Overlapping or replayed cursor pages (concurrent writes, refetch after
 * invalidation) can repeat a row across pages; a raw concat would then hand
 * FlatList duplicate keys. This keeps the FIRST occurrence of each key and drops
 * later duplicates, preserving page/first-occurrence order so the visible list
 * is stable.
 *
 * `getKey` defaults to reading `.id` (challenges, comments); the leaderboard
 * keys on `user_id`, so it passes its own selector — one helper, three surfaces.
 */
export function dedupeById<T>(
  items: readonly T[],
  getKey: (item: T) => string = (item) => (item as { id: string }).id,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
