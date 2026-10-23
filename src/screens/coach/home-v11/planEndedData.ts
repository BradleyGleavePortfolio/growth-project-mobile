/**
 * "Plan ended last 7 days, {N}" on the coach Home (owner ruling v3 6328335815 items 5-7 on b#1127; RENEWAL3 P1, K1-K3):
 * b#1130's GET /v1/coach/churned-clients, newest end first. The server keeps the window, the order and {N} (`total`).
 * The phone groups by `days_since`: 0 Today, 1 Yesterday, 2 and more Earlier this week (RN3-29: "2 to 6 days ago", not
 * the server's Monday-to-Sunday `group`). Shown only when the server answers with the list: a 404 (FEATURE_PLAN_RENEWAL
 * off) or any other answer hides it. Nothing here writes to a client: Roman only drafts, and only when asked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import api from '../../../services/api';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import type { DraftAsk } from './DraftSheets';

export interface PlanEndedRow {
  client_id: string;
  name: string;
  days_since: number;
  package_name: string;
  last_coach_message_at: string | null;
}
export interface PlanEndedPage { total: number; time_zone: string | null; items: PlanEndedRow[] }
export interface PlanEndedGroup { key: 'today' | 'yesterday' | 'week'; label: string; rows: PlanEndedRow[] }

const TAKE = 50; // the server's most per page
const MAX_PAGES = 10;

const str = (v: unknown): v is string => typeof v === 'string';
function parseRow(v: unknown): PlanEndedRow | null {
  const r = (v ?? {}) as Record<string, unknown>;
  if (!str(r.client_id) || !r.client_id || typeof r.days_since !== 'number' || !Number.isFinite(r.days_since)) return null;
  return {
    client_id: r.client_id,
    name: (str(r.name) && r.name.trim()) || (str(r.first_name) && r.first_name.trim()) || 'Unnamed client',
    days_since: Math.max(0, Math.floor(r.days_since)),
    package_name: str(r.package_name) ? r.package_name.trim() : '',
    last_coach_message_at: str(r.last_coach_message_at) && !Number.isNaN(Date.parse(r.last_coach_message_at)) ? r.last_coach_message_at : null,
  };
}

/** One page, or null when the answer is not the list. */
export function parsePlanEndedPage(v: unknown): (PlanEndedPage & { next_cursor: string | null }) | null {
  const p = (v ?? {}) as Record<string, unknown>;
  if (!Array.isArray(p.items) || typeof p.total !== 'number' || !Number.isFinite(p.total)) return null;
  const items = p.items.map(parseRow).filter((r): r is PlanEndedRow => r !== null);
  return {
    total: Math.max(items.length, Math.floor(p.total)),
    time_zone: str(p.time_zone) && p.time_zone ? p.time_zone : null,
    items,
    next_cursor: str(p.next_cursor) && p.next_cursor ? p.next_cursor : null,
  };
}

/** Every page, newest end first; null when the list is off on this server (404) or the answer is not the list. */
export async function readPlanEnded(): Promise<PlanEndedPage | null> {
  let head: PlanEndedPage | null = null;
  const items: PlanEndedRow[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    let data: unknown;
    try {
      data = (await api.get('/v1/coach/churned-clients', { params: cursor ? { take: TAKE, cursor } : { take: TAKE } })).data;
    } catch (err) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
    const page = parsePlanEndedPage(data);
    if (!page) break;
    head = head ?? page;
    for (const r of page.items) if (!seen.has(r.client_id)) { seen.add(r.client_id); items.push(r); }
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return head ? { total: Math.max(head.total, items.length), time_zone: head.time_zone, items } : null;
}

export const planEndedTitle = (n: number) => `Plan ended last 7 days, ${n}`; // RN3-24, the owner's words
const ended = (days: number) => (days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);
/** RN3-30, in the pieces WholeLine draws without breaking inside one: joined, they are exactly `rowLine`. */
export const rowLineParts = (r: PlanEndedRow): string[] =>
  r.package_name ? [`Plan ended ${ended(r.days_since)} · `, r.package_name] : [`Plan ended ${ended(r.days_since)}`];
/** RN3-30 */
export const rowLine = (r: PlanEndedRow) => rowLineParts(r).join('');
/** RN3-25 */
export const homeLine = (r: PlanEndedRow) => `${r.name} · ended ${ended(r.days_since)}`;
/** RN3-26 (P1) and RN3-27 (P1-0), for a screen reader. */
export function homeLabel(p: PlanEndedPage): string {
  const first = p.items[0];
  if (!first || p.total === 0) return `${planEndedTitle(0)}. Clients whose plan ended show here, newest first.`;
  const more = p.total - 1;
  return `${planEndedTitle(p.total)}. ${first.name}, plan ended ${ended(first.days_since)}${more > 0 ? `, and ${more} more` : ''}`;
}
/** RN3-31: "Messaged Oct 20", in the coach's time zone when the server names it. */
export function messagedLine(at: string, timeZone: string | null): string {
  const d = new Date(at);
  let day: string;
  try {
    day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(timeZone ? { timeZone } : {}) });
  } catch {
    day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return `Messaged ${day}`;
}

export const initialsOf = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('') || '?';

const LABELS = { today: 'Today', yesterday: 'Yesterday', week: 'Earlier this week' } as const; // RN3-29
/** Rows in the server's order, under Today (0 days), Yesterday (1) and Earlier this week (2 and more). */
export function groupPlanEnded(rows: PlanEndedRow[]): PlanEndedGroup[] {
  const keyOf = (d: number): PlanEndedGroup['key'] => (d <= 0 ? 'today' : d === 1 ? 'yesterday' : 'week');
  return (['today', 'yesterday', 'week'] as const)
    .map((key) => ({ key, label: LABELS[key], rows: rows.filter((r) => keyOf(r.days_since) === key) }))
    .filter((g) => g.rows.length > 0);
}

/** The ask-first win-back draft: b#1130's POST builds Roman's request from the row; the body is not used. */
export const planEndedAsk = (r: PlanEndedRow): DraftAsk => ({
  clientName: r.name,
  about: rowLine(r), // RN3-34, the K3 context line
  aboutParts: rowLineParts(r),
  masthead: true, // K3a / K3b: Roman's forest masthead, the context line in its chip
  request: { capability: 'draft.coach_message', subject_user_id: r.client_id, message: '' },
  path: `/v1/coach/churned-clients/${encodeURIComponent(r.client_id)}/draft`,
});

/**
 * The rows without anyone the coach has blocked on this phone. The server is the authority both ways (b#1141 drops a
 * blocked pair from GET /v1/coach/churned-clients and 404s its draft); this only keeps a block made a moment ago from
 * showing until the next read. {N} drops by the rows taken out.
 */
export function withoutBlocked(page: PlanEndedPage | null, blockedIds: readonly string[]): PlanEndedPage | null {
  if (!page || blockedIds.length === 0) return page;
  const blocked = new Set(blockedIds);
  const items = page.items.filter((r) => !blocked.has(r.client_id));
  if (items.length === page.items.length) return page;
  return { ...page, total: Math.max(items.length, page.total - (page.items.length - items.length)), items };
}

/** The ids the coach has blocked, as this phone knows them (blockedUsersStore). */
export function useBlockedIds(): string[] {
  const blocked = useBlockedUsersStore((s) => s.blocked);
  return useMemo(() => blocked.map((b) => b.id), [blocked]);
}

/** The Home's read: on mount, on each return to the Home, and on `reload`. A failed re-read keeps the last list. */
export function usePlanEnded() {
  const isFocused = useIsFocused();
  const [page, setPage] = useState<PlanEndedPage | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: unknown }>({ loading: true, error: null });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const next = await readPlanEnded();
      if (mine !== seq.current) return;
      setPage(next);
      setState({ loading: false, error: null });
    } catch (error) {
      if (mine === seq.current) setState({ loading: false, error });
    }
  }, []);
  useEffect(() => () => { seq.current += 1; }, []);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current && !isFocused) return;
    mounted.current = true;
    void reload();
  }, [isFocused, reload]);
  const blockedIds = useBlockedIds();
  const shown = useMemo(() => withoutBlocked(page, blockedIds), [page, blockedIds]);
  return { page: shown, loading: state.loading, error: state.error, reload };
}
