/**
 * broadcastsApi — coach broadcasts (backend src/broadcasts, b#726-#730).
 *
 *   GET  /coach/broadcasts?limit&cursor   { items: Broadcast[], next_cursor }
 *   GET  /coach/broadcasts/segment-options { roster_size, packages, programs, tags }
 *   POST /coach/broadcasts/preview         { recipient_count, excluded_blocked_count, roster_size }
 *   POST /coach/broadcasts                 Broadcast (Idempotency-Key header)
 *   POST /coach/broadcasts/:id/cancel | pause | resume
 *
 * Kill switch FEATURE_COACH_BROADCASTS (default off): every route answers
 * 503 `broadcasts.disabled`; a backend without the module answers 404.
 * `broadcastsAvailable` reports both as false so the entry stays hidden.
 *
 * Clients get each copy as an ordinary coach message in their own thread
 * (`{first_name}` replaced per client), so no client-side code is needed.
 * Responses are parsed with zod: a drifted shape throws here.
 */
import { z } from 'zod';
import api from '../services/api';

const StatsSchema = z.object({
  total: z.number(),
  delivered: z.number(),
  pending: z.number(),
  deferred: z.number(),
  skipped_blocked: z.number(),
  skipped_ineligible: z.number(),
  failed: z.number(),
  read: z.number(),
});

const RuleSchema = z.object({
  field: z.string(),
  op: z.string(),
  values: z.array(z.union([z.string(), z.number()])).optional(),
  value: z.number().optional(),
});

export const SegmentSchema = z.object({
  match: z.enum(['all', 'any']),
  rules: z.array(RuleSchema),
  exclude_client_ids: z.array(z.string()).optional(),
});

export const RecurrenceSchema = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly']),
  interval: z.number(),
  local_time: z.string(),
  by_weekday: z.array(z.number()).optional(),
  by_month_day: z.number().optional(),
  until: z.string().optional(),
  count: z.number().optional(),
  anchor_date: z.string().optional(),
});

export const BroadcastStatusSchema = z.enum([
  'draft',
  'scheduled',
  'sending',
  'sent',
  'paused',
  'canceled',
  'failed',
]);

export const BroadcastSchema = z.object({
  id: z.string(),
  status: BroadcastStatusSchema,
  body: z.string(),
  segment: SegmentSchema,
  timezone: z.string(),
  send_at: z.string().nullable(),
  recurrence: RecurrenceSchema.nullable(),
  next_run_at: z.string().nullable(),
  occurrences_sent: z.number(),
  last_run_at: z.string().nullable(),
  failure_code: z.string().nullable(),
  created_at: z.string(),
  stats: StatsSchema.optional(),
});

const ListSchema = z.object({
  items: z.array(BroadcastSchema),
  next_cursor: z.string().nullable(),
});

export const SegmentOptionsSchema = z.object({
  roster_size: z.number(),
  packages: z.array(z.object({ id: z.string(), name: z.string() })),
  programs: z.array(z.object({ id: z.string(), name: z.string() })),
  tags: z.array(z.object({ tag: z.string(), client_count: z.number() })),
});

const PreviewSchema = z.object({
  recipient_count: z.number(),
  excluded_blocked_count: z.number(),
  roster_size: z.number(),
});

export type Broadcast = z.infer<typeof BroadcastSchema>;
export type BroadcastStatus = z.infer<typeof BroadcastStatusSchema>;
export type BroadcastSegment = z.infer<typeof SegmentSchema>;
export type BroadcastRecurrence = z.infer<typeof RecurrenceSchema>;
export type BroadcastList = z.infer<typeof ListSchema>;
export type SegmentOptions = z.infer<typeof SegmentOptionsSchema>;
export type BroadcastPreview = z.infer<typeof PreviewSchema>;

/** Recurrence as sent on create (the server pins anchor_date itself). */
export interface RecurrenceInput {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  local_time: string;
  by_weekday?: number[];
  by_month_day?: number;
}

export interface CreateBroadcastInput {
  body: string;
  segment: BroadcastSegment;
  timezone: string;
  /** ISO instant; null sends now (or starts the series now). */
  send_at: string | null;
  recurrence: RecurrenceInput | null;
}

function responseOf(err: unknown): { status?: number; code?: string; message?: string } {
  const res = typeof err === 'object' && err !== null ? Reflect.get(err, 'response') : undefined;
  if (typeof res !== 'object' || res === null) return {};
  const status = Reflect.get(res, 'status');
  const data = Reflect.get(res, 'data');
  const code = typeof data === 'object' && data !== null ? Reflect.get(data, 'code') : undefined;
  const message = typeof data === 'object' && data !== null ? Reflect.get(data, 'message') : undefined;
  return {
    status: typeof status === 'number' ? status : undefined,
    code: typeof code === 'string' ? code : undefined,
    message: typeof message === 'string' ? message : undefined,
  };
}

/** True when the backend has broadcasts turned off (503) or has no module yet (404). */
export function broadcastsOff(err: unknown): boolean {
  const r = responseOf(err);
  return r.status === 404 && !r.code ? true : r.status === 503 && r.code === 'broadcasts.disabled';
}

/**
 * Plain-words copy for a failed broadcast call. Coded backend refusals carry
 * their own sentence (src/broadcasts/broadcast-errors.ts); everything else is
 * named by what happened. `action` is the verb phrase, e.g. "sent".
 */
export function broadcastErrorMessage(err: unknown, action: string): string {
  const r = responseOf(err);
  if (r.code && r.message && (r.code.startsWith('broadcast') || r.code.startsWith('card.'))) {
    return r.message;
  }
  if (r.status === undefined) {
    return `No connection, so nothing was ${action}. Check the connection and try again.`;
  }
  if (r.status === 429) return `Too many broadcasts in a minute, so this one was not ${action}. Wait a minute and try again.`;
  if (r.status >= 500) return `The server could not take this request, so nothing was ${action}. Try again in a minute.`;
  if (r.status === 403) return 'Only coaches can send broadcasts. Sign in with a coach account.';
  return `This request was refused (${r.status}), so nothing was ${action}. Refresh and try again.`;
}

export const broadcastsApi = {
  async list(cursor?: string | null): Promise<BroadcastList> {
    const res = await api.get('/coach/broadcasts', {
      params: { limit: 50, ...(cursor ? { cursor } : {}) },
    });
    return ListSchema.parse(res.data);
  },

  async segmentOptions(): Promise<SegmentOptions> {
    const res = await api.get('/coach/broadcasts/segment-options');
    return SegmentOptionsSchema.parse(res.data);
  },

  async preview(segment: BroadcastSegment): Promise<BroadcastPreview> {
    const res = await api.post('/coach/broadcasts/preview', { segment });
    return PreviewSchema.parse(res.data);
  },

  async create(input: CreateBroadcastInput, idempotencyKey: string): Promise<Broadcast> {
    const res = await api.post(
      '/coach/broadcasts',
      { ...input, status: 'scheduled' },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return BroadcastSchema.parse(res.data);
  },

  async transition(id: string, action: 'cancel' | 'pause' | 'resume'): Promise<Broadcast> {
    const res = await api.post(`/coach/broadcasts/${encodeURIComponent(id)}/${action}`);
    return BroadcastSchema.parse(res.data);
  },
};

/** Probe for the entry point: false when broadcasts are off or absent. */
export async function broadcastsAvailable(): Promise<boolean> {
  try {
    await api.get('/coach/broadcasts', { params: { limit: 1 } });
    return true;
  } catch (err) {
    if (broadcastsOff(err)) return false;
    throw err;
  }
}
