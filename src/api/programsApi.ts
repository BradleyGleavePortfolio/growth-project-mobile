/**
 * S-MWB — coach Programs library client (backend `/v1/coach/programs`,
 * FEATURE_MWB_TEMPLATES). A "program" is a master week-by-day plan the coach
 * builds once; each filled day is an ordinary workout plan the existing
 * CoachWorkoutBuilder edits (autosave when EXPO_PUBLIC_FF_MWB_AUTOSAVE is on).
 *
 * Every number shown in the Programs screens comes from these routes: filled
 * days, assigned count and package count are computed server-side.
 */
import api, { coachApi } from "../services/api";
import { generateIdempotencyKey } from "../utils/idempotency";

export type WorkoutType = "strength" | "cardio" | "mobility";
export type ProgramStatusFilter = "active" | "archived";

export const PROGRAM_MAX_WEEKS = 52;
export const PROGRAM_DAY_SLOTS = 7;
export const BULK_ASSIGN_CHUNK = 50;

export interface ProgramSummary {
  id: string;
  name: string;
  description: string | null;
  goal_tag: string | null;
  weeks: number;
  days_per_week: number;
  filled_days: number;
  assigned_count: number;
  package_count: number;
  is_regime: boolean;
  regime_display_name: string | null;
  version: number;
  can_edit: boolean;
  updated_at: string;
  archived_at: string | null;
}

export interface ProgramDay {
  week_index: number;
  day_index: number;
  plan_id: string;
  name: string;
  type: WorkoutType;
  duration_estimate_minutes: number | null;
  exercise_count: number;
  updated_at: string;
}

export interface ProgramPackageRef {
  content_id: string;
  package_id: string;
  package_name: string;
  cadence_kind: string;
}

export interface ProgramDetail extends ProgramSummary {
  days: ProgramDay[];
  packages: ProgramPackageRef[];
}

export interface ProgramListPage {
  items: ProgramSummary[];
  next_cursor: string | null;
  goal_tags: string[];
}

export interface SavedWorkout {
  id: string;
  name: string;
  type: WorkoutType;
  duration_estimate_minutes: number | null;
  exercise_count: number;
  updated_at: string;
}

export interface ProgramRevision {
  revision_index: number;
  cause: string;
  author_kind: string;
  created_at: string;
  name: string | null;
  weeks: number | null;
  days_per_week: number | null;
  day_count: number | null;
}

export interface ProgramAssignee {
  client_id: string;
  client_name: string;
  copy_program_id: string;
  start_date: string;
  end_date: string;
  workouts: number;
  completed: number;
}

export type BulkAssignStatus = "assigned" | "already_assigned" | "failed";

export interface BulkAssignResult {
  client_id: string;
  status: BulkAssignStatus;
  replayed?: boolean;
  program_id?: string;
  workouts?: number;
  first_scheduled_for?: string;
  last_scheduled_for?: string;
  code?: string;
  message?: string;
}

export interface BulkAssignResponse {
  program_id: string;
  start_date: string;
  results: BulkAssignResult[];
  summary: {
    total: number;
    assigned: number;
    already_assigned: number;
    failed: number;
  };
}

export interface ProgramInput {
  name: string;
  description?: string | null;
  goal_tag?: string | null;
  weeks: number;
  days_per_week: number;
}

export type SetDayInput =
  | { source: "blank"; name?: string; type?: WorkoutType }
  | { source: "saved_workout"; plan_id: string; name?: string }
  | {
      source: "copy_day";
      from_week_index: number;
      from_day_index: number;
      name?: string;
    };

export interface AssignableClient {
  id: string;
  name: string;
  email: string;
}

const BASE = "/v1/coach/programs";
const enc = encodeURIComponent;

function idem(key?: string) {
  return { headers: { "Idempotency-Key": key ?? generateIdempotencyKey() } };
}

export const programsApi = {
  list: async (params: {
    q?: string;
    goal_tag?: string;
    status?: ProgramStatusFilter;
    cursor?: string;
  }): Promise<ProgramListPage> => {
    const query: Record<string, string> = {};
    if (params.q && params.q.trim() !== "") query.q = params.q.trim();
    if (params.goal_tag) query.goal_tag = params.goal_tag;
    if (params.status) query.status = params.status;
    if (params.cursor) query.cursor = params.cursor;
    const res = await api.get<ProgramListPage>(BASE, { params: query });
    return res.data;
  },

  get: async (id: string): Promise<ProgramDetail> =>
    (await api.get<ProgramDetail>(`${BASE}/${enc(id)}`)).data,

  create: async (input: ProgramInput, key?: string): Promise<ProgramDetail> =>
    (await api.post<ProgramDetail>(BASE, input, idem(key))).data,

  update: async (
    id: string,
    input: Partial<ProgramInput> & { expected_version: number },
    key?: string,
  ): Promise<ProgramDetail> =>
    (await api.patch<ProgramDetail>(`${BASE}/${enc(id)}`, input, idem(key)))
      .data,

  setDay: async (
    id: string,
    week: number,
    day: number,
    input: SetDayInput,
    key?: string,
  ): Promise<ProgramDetail> =>
    (
      await api.put<ProgramDetail>(
        `${BASE}/${enc(id)}/days/${week}/${day}`,
        input,
        idem(key),
      )
    ).data,

  clearDay: async (
    id: string,
    week: number,
    day: number,
    key?: string,
  ): Promise<ProgramDetail> =>
    (
      await api.delete<ProgramDetail>(
        `${BASE}/${enc(id)}/days/${week}/${day}`,
        idem(key),
      )
    ).data,

  duplicate: async (
    id: string,
    name: string | undefined,
    key?: string,
  ): Promise<ProgramDetail> =>
    (
      await api.post<ProgramDetail>(
        `${BASE}/${enc(id)}/duplicate`,
        name ? { name } : {},
        idem(key),
      )
    ).data,

  archive: async (id: string, key?: string): Promise<ProgramDetail> =>
    (await api.post<ProgramDetail>(`${BASE}/${enc(id)}/archive`, {}, idem(key)))
      .data,

  restore: async (id: string, key?: string): Promise<ProgramDetail> =>
    (await api.post<ProgramDetail>(`${BASE}/${enc(id)}/restore`, {}, idem(key)))
      .data,

  revisions: async (id: string): Promise<{ items: ProgramRevision[] }> =>
    (
      await api.get<{ items: ProgramRevision[] }>(
        `${BASE}/${enc(id)}/revisions`,
      )
    ).data,

  assignees: async (id: string): Promise<{ items: ProgramAssignee[] }> =>
    (
      await api.get<{ items: ProgramAssignee[] }>(
        `${BASE}/${enc(id)}/assignees`,
      )
    ).data,

  unassign: async (
    id: string,
    clientId: string,
    key?: string,
  ): Promise<{ removed_workouts: number; kept_workouts: number }> =>
    (
      await api.delete<{ removed_workouts: number; kept_workouts: number }>(
        `${BASE}/${enc(id)}/assignees/${enc(clientId)}`,
        idem(key),
      )
    ).data,

  /**
   * One request (at most BULK_ASSIGN_CHUNK clients). The key MUST be reused
   * when retrying the same clients so the server never assigns twice.
   */
  assign: async (
    id: string,
    body: { client_ids: string[]; start_date: string; allow_repeat?: boolean },
    key: string,
  ): Promise<BulkAssignResponse> =>
    (
      await api.post<BulkAssignResponse>(
        `${BASE}/${enc(id)}/assign`,
        body,
        idem(key),
      )
    ).data,

  savedWorkouts: async (
    params: { q?: string; cursor?: string } = {},
  ): Promise<{
    items: SavedWorkout[];
    next_cursor: string | null;
  }> => {
    const query: Record<string, string> = {};
    if (params.q && params.q.trim() !== "") query.q = params.q.trim();
    if (params.cursor) query.cursor = params.cursor;
    return (
      await api.get<{ items: SavedWorkout[]; next_cursor: string | null }>(
        `${BASE}/saved-workouts`,
        {
          params: query,
        },
      )
    ).data;
  },

  /** FEATURE_NAMED_REGIMES: flip a program into a named regime. */
  promoteToRegime: async (
    id: string,
    displayName: string | undefined,
  ): Promise<unknown> =>
    (
      await api.post(
        `/coach/regimes/${enc(id)}/promote-from-program`,
        displayName ? { regime_display_name: displayName } : {},
      )
    ).data,

  /** Active clients the coach can assign to (the coach roster route). */
  assignableClients: async (): Promise<AssignableClient[]> => {
    const res = await coachApi.getClients("active");
    const rows: unknown = res.data;
    if (!Array.isArray(rows)) return [];
    const out: AssignableClient[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const r = row as {
        id?: unknown;
        name?: unknown;
        email?: unknown;
        archived_at?: unknown;
      };
      if (typeof r.id !== "string" || r.archived_at) continue;
      const email = typeof r.email === "string" ? r.email : "";
      const name =
        typeof r.name === "string" && r.name.trim() !== ""
          ? r.name.trim()
          : email || "Unnamed client";
      out.push({ id: r.id, name, email });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },
};

// ─── pure helpers (unit-tested) ────────────────────────────────────────────

/** Split client ids into request-sized chunks (server cap 50). */
export function chunkClientIds(
  ids: string[],
  size: number = BULK_ASSIGN_CHUNK,
): string[][] {
  const unique = Array.from(new Set(ids));
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size)
    out.push(unique.slice(i, i + size));
  return out;
}

/** Local calendar date as YYYY-MM-DD (what the coach sees on the device). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Next Monday strictly after `from` (a common program start). */
export function nextMonday(from: Date): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const delta = (8 - d.getDay()) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d;
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((p) => Number(p));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Map of "week:day" -> day for the grid. */
export function indexDays(days: ProgramDay[]): Map<string, ProgramDay> {
  const map = new Map<string, ProgramDay>();
  for (const d of days) map.set(`${d.week_index}:${d.day_index}`, d);
  return map;
}

export const DAY_LABELS = [
  "Day 1",
  "Day 2",
  "Day 3",
  "Day 4",
  "Day 5",
  "Day 6",
  "Day 7",
] as const;
