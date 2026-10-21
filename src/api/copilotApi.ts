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

export type PathChange =
  | { kind: 'move_session'; assignment_id: string; workout: string; from_at: string; to_at: string }
  | { kind: 'set_calorie_target'; target_id: string; from_kcal: number; to_kcal: number };

export type SuggestionStatus = 'suggested' | 'pending' | 'approved' | 'rejected' | 'expired';

export interface CopilotSuggestion {
  id: string;
  status: SuggestionStatus;
  change: PathChange;
  reason: string | null;
  note: string | null;
  sent_at: string | null;
  decided_at: string | null;
}

export interface PathChangeDraft {
  id: string;
  clientId: string;
  change: PathChange;
  reason: string | null;
  sentAt: string;
}

export type DecideBody =
  | { decision: 'approved'; payload?: { to_at: string } | { to_kcal: number } }
  | { decision: 'rejected'; note?: string };

const STATUSES: readonly SuggestionStatus[] = ['suggested', 'pending', 'approved', 'rejected', 'expired'];
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const iso = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v));
const kcal = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown) => (typeof v === 'string' ? v : null);

/** One change, or null for anything the phone cannot draw honestly (unknown kind, missing field). */
export function parseChange(v: unknown): PathChange | null {
  if (!rec(v)) return null;
  if (v.kind === 'move_session' && str(v.assignment_id) && str(v.workout) && iso(v.from_at) && iso(v.to_at)) {
    return { kind: 'move_session', assignment_id: v.assignment_id, workout: v.workout, from_at: v.from_at, to_at: v.to_at };
  }
  if (v.kind === 'set_calorie_target' && str(v.target_id) && kcal(v.from_kcal) && kcal(v.to_kcal)) {
    return { kind: 'set_calorie_target', target_id: v.target_id, from_kcal: v.from_kcal, to_kcal: v.to_kcal };
  }
  return null;
}

export function parseSuggestion(v: unknown): CopilotSuggestion | null {
  if (!rec(v) || !str(v.id) || !STATUSES.includes(v.status as SuggestionStatus)) return null;
  const change = parseChange(v.change);
  if (!change) return null;
  return {
    id: v.id,
    status: v.status as SuggestionStatus,
    change,
    reason: optStr(v.reason),
    note: optStr(v.note),
    sent_at: iso(v.sent_at) ? v.sent_at : null,
    decided_at: iso(v.decided_at) ? v.decided_at : null,
  };
}

/** Status, machine code and server words of a failed call (axios shape), for the screens' own lines. */
export function copilotErrorOf(err: unknown): { status: number | null; code: string | null; message: string | null } {
  const res = rec(err) && rec(err.response) ? err.response : null;
  const body = res && rec(res.data) ? res.data : null;
  return {
    status: res && typeof res.status === 'number' ? res.status : null,
    code: body && str(body.code) ? body.code : null,
    message: body && str(body.message) ? body.message : null,
  };
}

export const COPILOT_PATHS = {
  recent: '/client/copilot',
  send: (id: string) => `/client/copilot/suggestions/${encodeURIComponent(id)}/send`,
  drafts: '/ai/gateway/drafts',
  decide: (id: string) => `/ai/gateway/drafts/${encodeURIComponent(id)}`,
} as const;

/** One page is plenty for one coach (the queue is oldest first; paging is the queue screen's job). */
export const PATH_DRAFTS_PAGE = 50;

export const copilotApi = {
  /** null: the server has no Copilot (switch off, 404). Rows the phone cannot draw are left out. */
  async recent(): Promise<CopilotSuggestion[] | null> {
    try {
      const res = await api.get<unknown>(COPILOT_PATHS.recent);
      const list = rec(res.data) && Array.isArray(res.data.suggestions) ? res.data.suggestions : [];
      return list.map(parseSuggestion).filter((s): s is CopilotSuggestion => s !== null);
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

  /** The coach's waiting Copilot changes. An older server answers the bare array (no paging): nothing new to show. */
  async pathChangeDrafts(): Promise<PathChangeDraft[]> {
    const res = await api.get<unknown>(COPILOT_PATHS.drafts, { params: { order: 'oldest', limit: String(PATH_DRAFTS_PAGE) } });
    if (!rec(res.data) || !Array.isArray(res.data.items)) return [];
    return res.data.items.flatMap<PathChangeDraft>((d: unknown) => {
      if (!rec(d) || d.capability !== 'client_path_change' || d.status !== 'pending' || !str(d.id) || !str(d.subject_user_id)) return [];
      const change = parseChange(d.payload);
      return change && iso(d.created_at) ? [{ id: d.id, clientId: d.subject_user_id, change, reason: optStr(d.rationale), sentAt: d.created_at }] : [];
    });
  },

  async decide(id: string, body: DecideBody): Promise<void> {
    await api.patch(COPILOT_PATHS.decide(id), body);
  },
};
