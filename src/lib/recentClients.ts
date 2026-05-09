/**
 * Recently-viewed clients — local AsyncStorage cache.
 *
 * Powers the `<UniversalClientSearch />` "recent on focus" affordance:
 * when the user taps the search field with no query, we surface the last
 * five clients they opened. Stored locally because the canonical record
 * is "what did this device user look at recently" — not coach-tenant
 * state — and a server round-trip on focus would defeat the purpose of
 * a fast picker.
 *
 * Schema is intentionally minimal: the search-result row shape is a
 * superset of what we need to render the recent-row, and we tag with a
 * `last_seen_at` ISO string so the list is naturally ordered.
 *
 * The list is capped at MAX_RECENT to keep AsyncStorage cheap and to
 * keep "recently" meaningful. Older entries fall off when a new one is
 * pushed; the order is most-recent-first.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tgp.recent_clients.v1';
const MAX_RECENT = 5;

export interface RecentClient {
  email: string;
  name: string | null;
  pillars: ('fitness' | 'finance')[];
  last_seen_at: string;
}

export async function readRecentClients(): Promise<RecentClient[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent);
  } catch {
    return [];
  }
}

export async function pushRecentClient(client: Omit<RecentClient, 'last_seen_at'>): Promise<void> {
  try {
    const existing = await readRecentClients();
    const trimmed = existing.filter((r) => r.email.toLowerCase() !== client.email.toLowerCase());
    const next: RecentClient[] = [
      { ...client, last_seen_at: new Date().toISOString() },
      ...trimmed,
    ].slice(0, MAX_RECENT);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Best-effort cache; never throw out of a UX event handler.
  }
}

export async function clearRecentClients(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

function isRecent(v: unknown): v is RecentClient {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<RecentClient>;
  return (
    typeof r.email === 'string' &&
    (r.name === null || typeof r.name === 'string') &&
    Array.isArray(r.pillars) &&
    typeof r.last_seen_at === 'string'
  );
}
