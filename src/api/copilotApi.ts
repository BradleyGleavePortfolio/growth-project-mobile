/**
 * Path Copilot calls (style A, owner #162-1). Contract: backend #1120, "Contract for the phone".
 *
 *   GET   /client/copilot                       the client's last three sent suggestions (404 while the server switch is off)
 *   POST  /client/copilot/suggestions/:id/send  hand one suggestion to the client's coach
 *   GET   /ai/gateway/drafts?order=oldest       the coach's waiting drafts, oldest sent first (Copilot rows filtered here)
 *   PATCH /ai/gateway/drafts/:id                Approve, Edit (one field on the live plan) or Decline with a one-line note
 *
 * Every read is parsed strictly. A server without these routes reads as "nothing new", never as an error
 * (capability check or truthful fallback): 404 on the client read, the old bare array on the coach read.
 */
import api from '../services/api';

export type SourceKind = 'plan' | 'check_in' | 'food_log' | 'workout_log';
/** One fact Roman used (b#1129). `n` is the [n] Roman cites; the label and detail are the server's words (CP-A-17). */
export interface CopilotSource { n: number; kind: SourceKind; label: string; detail: string | null }

type Sourced = { sources?: CopilotSource[] };
export type PathChange =
  | ({ kind: 'move_session'; assignment_id: string; workout: string; from_at: string; to_at: string } & Sourced)
  | ({ kind: 'set_calorie_target'; target_id: string; from_kcal: number; to_kcal: number } & Sourced);

export type SuggestionStatus = 'suggested' | 'pending' | 'approved' | 'rejected' | 'expired';

export interface CopilotSuggestion {
  id: string; status: SuggestionStatus; change: PathChange; reason: string | null; note: string | null;
  sent_at: string | null; decided_at: string | null;
}

export interface PathChangeDraft { id: string; clientId: string; change: PathChange; reason: string | null; sentAt: string }

export type DecideBody =
  | { decision: 'approved'; payload?: { to_at: string } | { to_kcal: number } }
  | { decision: 'rejected'; note?: string };

const STATUSES: readonly SuggestionStatus[] = ['suggested', 'pending', 'approved', 'rejected', 'expired'];
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const iso = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));
const kcal = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => (typeof v === 'string' ? v : null);
const KINDS: readonly SourceKind[] = ['plan', 'check_in', 'food_log', 'workout_log'];
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** The facts the phone can draw; unknown kinds and empty labels are left out. */
export function parseSources(v: unknown): CopilotSource[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x: unknown, i): CopilotSource[] =>
    rec(x) && KINDS.includes(x.kind as SourceKind) && str(x.label)
      ? [{ n: count(x.n) ? x.n : i + 1, kind: x.kind as SourceKind, label: x.label, detail: str(x.detail) ? x.detail : null }]
      : [],
  );
}

/** One change, or null for anything the phone cannot draw honestly (unknown kind, missing field). */
export function parseChange(v: unknown): PathChange | null {
  if (!rec(v)) return null;
  const sources = parseSources(v.sources);
  const tags = sources.length ? { sources } : {};
  if (v.kind === 'move_session' && str(v.assignment_id) && str(v.workout) && iso(v.from_at) && iso(v.to_at)) {
    return { kind: 'move_session', assignment_id: v.assignment_id, workout: v.workout, from_at: v.from_at, to_at: v.to_at, ...tags };
  }
  if (v.kind === 'set_calorie_target' && str(v.target_id) && kcal(v.from_kcal) && kcal(v.to_kcal)) {
    return { kind: 'set_calorie_target', target_id: v.target_id, from_kcal: v.from_kcal, to_kcal: v.to_kcal, ...tags };
  }
  return null;
}

export function parseSuggestion(v: unknown): CopilotSuggestion | null {
  if (!rec(v) || !str(v.id) || !STATUSES.includes(v.status as SuggestionStatus)) return null;
  const change = parseChange(v.change);
  if (!change) return null;
  return { id: v.id, status: v.status as SuggestionStatus, change, reason: optStr(v.reason), note: optStr(v.note),
    sent_at: iso(v.sent_at) ? v.sent_at : null, decided_at: iso(v.decided_at) ? v.decided_at : null };
}

/** The Copilot part of one Roman reply (done frame or message view). null: not a Copilot turn (an older server). */
export interface CopilotReply { sources: CopilotSource[]; suggestion: CopilotSuggestion | null }
export function parseReply(v: unknown): CopilotReply | null {
  return rec(v) ? { sources: parseSources(v.sources), suggestion: parseSuggestion(v.suggestion) } : null;
}

/** The week block (b#1129 `week`). */
export interface CopilotWeek {
  number: number | null;
  coach: string | null;
  target: { kcal: number; from: string; previous: number | null } | null;
  workouts: { done: number; total: number };
  lastCheckIn: string | null;
}
export function parseWeek(v: unknown): CopilotWeek | null {
  if (!rec(v)) return null;
  const t = v.target;
  const w: Record<string, unknown> = rec(v.workouts) ? v.workouts : {};
  return {
    number: count(v.number) && v.number > 0 ? v.number : null,
    coach: str(v.coach_first_name) ? v.coach_first_name : null,
    target: rec(t) && kcal(t.kcal) && iso(t.from) ? { kcal: t.kcal, from: t.from, previous: kcal(t.previous_kcal) ? t.previous_kcal : null } : null,
    workouts: { done: count(w.done) ? w.done : 0, total: count(w.total) ? w.total : 0 },
    lastCheckIn: str(v.last_check_in) && /^\d{4}-\d{2}-\d{2}$/.test(v.last_check_in) ? v.last_check_in : null,
  };
}

/** Status, machine code and server words of a failed call (axios shape), for the screens' own lines. */
export function copilotErrorOf(err: unknown): { status: number | null; code: string | null; message: string | null } {
  const res = rec(err) && rec(err.response) ? err.response : null;
  const body = res && rec(res.data) ? res.data : null;
  return { status: res && typeof res.status === 'number' ? res.status : null,
    code: body && str(body.code) ? body.code : null, message: body && str(body.message) ? body.message : null };
}

export const COPILOT_PATHS = {
  recent: '/client/copilot',
  send: (id: string) => `/client/copilot/suggestions/${encodeURIComponent(id)}/send`,
  drafts: '/ai/gateway/drafts',
  decide: (id: string) => `/ai/gateway/drafts/${encodeURIComponent(id)}`,
} as const;

/** The queue mixes every pending draft kind, oldest first, and older kinds never lapse: read on to the newer pages. */
export const PATH_DRAFTS_PAGE = 100;
export const PATH_DRAFTS_MAX_PAGES = 10;

export const copilotApi = {
  /** null: the server has no Copilot (switch off, 404). Rows the phone cannot draw are left out; no `week`: an older server. */
  async recent(): Promise<{ week: CopilotWeek | null; suggestions: CopilotSuggestion[] } | null> {
    try {
      const res = await api.get<unknown>(COPILOT_PATHS.recent);
      const body: Record<string, unknown> = rec(res.data) ? res.data : {};
      const list = Array.isArray(body.suggestions) ? body.suggestions : [];
      return { week: parseWeek(body.week), suggestions: list.map(parseSuggestion).filter((s): s is CopilotSuggestion => s !== null) };
    } catch (err) {
      if (copilotErrorOf(err).status === 404) return null;
      throw err;
    }
  },

  async send(id: string): Promise<CopilotSuggestion> {
    const res = await api.post<unknown>(COPILOT_PATHS.send(id));
    const row = parseSuggestion(res.data);
    if (!row) throw new Error('Copilot send: unexpected response');
    return row;
  },

  /** The coach's waiting Copilot changes, from every page (up to 1,000 rows). An older server answers the bare array: none. */
  async pathChangeDrafts(): Promise<PathChangeDraft[]> {
    const out: PathChangeDraft[] = [];
    let after: string | null = null;
    for (let page = 0; page < PATH_DRAFTS_MAX_PAGES; page += 1) {
      const params: Record<string, string> = { order: 'oldest', limit: String(PATH_DRAFTS_PAGE), ...(after ? { after } : null) };
      const res = await api.get<unknown>(COPILOT_PATHS.drafts, { params });
      if (!rec(res.data) || !Array.isArray(res.data.items)) return out;
      for (const d of res.data.items as unknown[]) {
        if (!rec(d) || d.capability !== 'client_path_change' || d.status !== 'pending' || !str(d.id) || !str(d.subject_user_id)) continue;
        const change = parseChange(d.payload);
        if (change && iso(d.created_at)) out.push({ id: d.id, clientId: d.subject_user_id, change, reason: optStr(d.rationale), sentAt: d.created_at });
      }
      after = str(res.data.next_cursor) ? res.data.next_cursor : null;
      if (!after) break;
    }
    return out;
  },

  async decide(id: string, body: DecideBody): Promise<void> {
    await api.patch(COPILOT_PATHS.decide(id), body);
  },
};
