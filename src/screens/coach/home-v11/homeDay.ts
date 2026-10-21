/**
 * The coach Home's day (spec #688 6295886580, Style A): GET /coach/command-center/overview?include=home
 * (b#1123, "Contract for the phone"). The overview fields are unchanged; `home` adds this week's wins and
 * today's three rings. An older server sends no `home`: the Home then draws only what the overview already
 * says (active today, check-ins) and no new number (guide rule 5). A malformed piece reads as absent.
 * Pure, so the screen and the tests share one rule.
 */
import api from '../../../services/api';
import { commandCenterApi, __USING_MOCK_DATA, type CommandCenterOverview } from '../../../services/commandCenterApi';

export interface HomeWinDraft { capability: 'draft.coach_message'; subject_user_id: string; message: string }

interface HomeWinBase { id: string; client_id: string; client_name: string; at: string; draft: HomeWinDraft }
export type HomeWin = HomeWinBase & (
  | { kind: 'checkin_streak'; streak_days: number }
  | { kind: 'lifting_best'; exercise: string; weight_lbs: number; reps: number }
  | { kind: 'goal_weight'; weight_lbs: number; goal_weight_lbs: number }
);

export interface HomeRings {
  check_ins: { reviewed: number; submitted: number };
  replies: { answered: number; received: number };
  reach_outs: { contacted: number; goal: number };
}

export interface CoachHomeDay {
  wins: { count: number; items: HomeWin[] };
  /** null when the server sent no readable rings: the Home then draws none. */
  rings: HomeRings | null;
}

export interface OverviewRead { overview: CommandCenterOverview; home: CoachHomeDay | null }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

function parseDraft(v: unknown, clientId: string): HomeWinDraft | null {
  if (!isObj(v) || v.capability !== 'draft.coach_message' || !text(v.message)) return null;
  // The draft is about this win's client and no one else.
  if (v.subject_user_id !== clientId) return null;
  return { capability: 'draft.coach_message', subject_user_id: clientId, message: v.message };
}

export function parseWin(v: unknown): HomeWin | null {
  if (!isObj(v) || !text(v.id) || !text(v.client_id) || !text(v.client_name) || !text(v.at)) return null;
  const draft = parseDraft(v.draft, v.client_id);
  if (!draft) return null;
  const base: HomeWinBase = { id: v.id, client_id: v.client_id, client_name: v.client_name.trim(), at: v.at, draft };
  switch (v.kind) {
    case 'checkin_streak':
      return count(v.streak_days) && v.streak_days > 0 ? { ...base, kind: 'checkin_streak', streak_days: v.streak_days } : null;
    case 'lifting_best':
      return text(v.exercise) && amount(v.weight_lbs) && count(v.reps) && v.reps > 0
        ? { ...base, kind: 'lifting_best', exercise: v.exercise.trim(), weight_lbs: v.weight_lbs, reps: v.reps }
        : null;
    case 'goal_weight':
      return amount(v.weight_lbs) && amount(v.goal_weight_lbs)
        ? { ...base, kind: 'goal_weight', weight_lbs: v.weight_lbs, goal_weight_lbs: v.goal_weight_lbs }
        : null;
    default:
      return null; // a kind this build does not know is left out, never shown as a code
  }
}

function parseRings(v: unknown): HomeRings | null {
  if (!isObj(v) || !isObj(v.check_ins) || !isObj(v.replies) || !isObj(v.reach_outs)) return null;
  const { check_ins: c, replies: r, reach_outs: o } = v;
  if (!count(c.reviewed) || !count(c.submitted) || !count(r.answered) || !count(r.received) || !count(o.contacted) || !count(o.goal)) {
    return null;
  }
  return {
    check_ins: { reviewed: c.reviewed, submitted: c.submitted },
    replies: { answered: r.answered, received: r.received },
    reach_outs: { contacted: o.contacted, goal: o.goal },
  };
}

/** The `home` block, or null when absent or unreadable (the wins count is the hero: without it, no `home`). */
export function parseHomeDay(v: unknown): CoachHomeDay | null {
  if (!isObj(v) || !isObj(v.wins) || !count(v.wins.count)) return null;
  const items = Array.isArray(v.wins.items) ? v.wins.items.map(parseWin).filter((w): w is HomeWin => w !== null) : [];
  return { wins: { count: v.wins.count, items }, rings: parseRings(v.rings) };
}

/** One read: the overview the Home always had, plus `home` when the server knows it. */
export async function fetchOverviewWithHome(): Promise<OverviewRead> {
  if (__USING_MOCK_DATA) return { overview: (await commandCenterApi.getOverview()).data, home: null };
  const res = await api.get<CommandCenterOverview & { home?: unknown }>('/coach/command-center/overview', { params: { include: 'home' } });
  const { home, ...overview } = res.data ?? ({} as CommandCenterOverview & { home?: unknown });
  return { overview: overview as CommandCenterOverview, home: parseHomeDay(home) };
}

// ─── Words ────────────────────────────────────────────────────────────────────

export const firstWord = (name: string) => name.trim().split(/\s+/)[0] || name;

export function winsHeadline(n: number): { value: string; unit: string } {
  return { value: String(n), unit: n === 1 ? 'win this week' : 'wins this week' };
}

const lb = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} lb`;

/** A win in a sentence, the client's first name first. */
export function winLine(w: HomeWin): string {
  const who = firstWord(w.client_name);
  switch (w.kind) {
    case 'checkin_streak':
      return `${who} hit a ${w.streak_days}-day check-in streak`;
    case 'lifting_best':
      return `${who} set a best: ${w.exercise}, ${lb(w.weight_lbs)} for ${w.reps}`;
    case 'goal_weight':
      return `${who} reached goal weight, ${lb(w.goal_weight_lbs)}`;
  }
}

/** The three wins shown under the hero; with more than three, the window moves on by one each turn. */
export function winWindow(items: HomeWin[], turn: number): HomeWin[] {
  if (items.length <= 3) return items;
  const start = ((turn % items.length) + items.length) % items.length;
  return [0, 1, 2].map((i) => items[(start + i) % items.length]);
}

export interface RingSpec { key: 'check_ins' | 'replies' | 'reach_outs'; label: string; done: number; of: number }

export function ringSpecs(r: HomeRings): RingSpec[] {
  return [
    { key: 'check_ins', label: 'Check-ins', done: Math.min(r.check_ins.reviewed, r.check_ins.submitted), of: r.check_ins.submitted },
    { key: 'replies', label: 'Replies', done: Math.min(r.replies.answered, r.replies.received), of: r.replies.received },
    { key: 'reach_outs', label: 'Reach-outs', done: Math.min(r.reach_outs.contacted, r.reach_outs.goal), of: r.reach_outs.goal },
  ];
}

export function ringsCaption(rings: RingSpec[], roster: number): string {
  if (roster === 0) return 'Your day fills in when your first client joins.';
  const open = rings.filter((r) => r.of > 0);
  if (open.length === 0) return 'Nothing to close yet today.';
  if (open.every((r) => r.done >= r.of)) return 'Every ring is closed for today.';
  return 'The day is in motion. Close the rings as you go.';
}

export const pct = (fraction: number) => `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
