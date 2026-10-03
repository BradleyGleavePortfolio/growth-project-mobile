/**
 * romanAdjustApi — Roman approve-to-adjust (coach side).
 *
 * Backend (growth-project-backend, src/roman-adjust):
 *   GET  /coach/adjustments              { proposals: RomanAdjustment[] }
 *   POST /coach/adjustments/:id/approve  RomanAdjustment
 *   POST /coach/adjustments/:id/edit     { volume_pct } | { sets: [{ order, sets }] }
 *   POST /coach/adjustments/:id/dismiss  { reason? }
 *   POST /coach/adjustments/:id/undo     RomanAdjustment
 *
 * Kill switch FEATURE_ROMAN_ADJUST_ENABLED (default off): every route 404s,
 * which this client reports as `{ enabled: false }` so the section hides.
 *
 * Responses are parsed with zod: a shape that drifts from the backend throws
 * here instead of feeding malformed data into the card.
 */
import { z } from 'zod';
import api from '../services/api';

const SignalSchema = z.object({
  key: z.enum(['hrv_drop', 'rhr_rise', 'short_sleep', 'low_readiness', 'load_spike', 'high_effort']),
  marked: z.boolean(),
  value: z.number(),
  baseline: z.number().nullable(),
});

const ChangeSchema = z.object({
  volume_pct: z.number(),
  sets_before: z.number(),
  sets_after: z.number(),
  exercises: z.array(
    z.object({
      order: z.number(),
      exercise_external_id: z.string(),
      sets_before: z.number(),
      sets_after: z.number(),
    }),
  ),
});

export const RomanAdjustmentSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'approved', 'edited', 'dismissed', 'undone', 'expired', 'withdrawn']),
  severity: z.enum(['moderate', 'marked']),
  roman_text: z.string(),
  client: z.object({ id: z.string(), first_name: z.string() }),
  workout: z.object({ assignment_id: z.string(), plan_name: z.string(), scheduled_for: z.string() }),
  signals: z.array(SignalSchema),
  proposed_change: ChangeSchema,
  applied_change: ChangeSchema.nullable(),
  /** Display names by exercise_external_id; an id without a name is absent. */
  exercise_names: z.record(z.string(), z.string()).default({}),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  undo_until: z.string().nullable(),
});

export type RomanAdjustment = z.infer<typeof RomanAdjustmentSchema>;
export type RomanAdjustSignal = z.infer<typeof SignalSchema>;
export type RomanAdjustChange = z.infer<typeof ChangeSchema>;

const ListSchema = z.object({ proposals: z.array(RomanAdjustmentSchema) });

export type DismissReason = 'not_now' | 'disagree' | 'client_feels_fine' | 'other';
export type EditInput = { volume_pct: number } | { sets: Array<{ order: number; sets: number }> };

function statusOf(err: unknown): number | undefined {
  const res = typeof err === 'object' && err !== null ? Reflect.get(err, 'response') : undefined;
  const status = typeof res === 'object' && res !== null ? Reflect.get(res, 'status') : undefined;
  return typeof status === 'number' ? status : undefined;
}

/** `{ enabled: false }` when the kill switch is off (404), else the list. */
export async function listAdjustments(): Promise<{ enabled: boolean; proposals: RomanAdjustment[] }> {
  try {
    const res = await api.get('/coach/adjustments');
    return { enabled: true, proposals: ListSchema.parse(res.data).proposals };
  } catch (err) {
    if (statusOf(err) === 404) return { enabled: false, proposals: [] };
    throw err;
  }
}

export async function approveAdjustment(id: string): Promise<RomanAdjustment> {
  const res = await api.post(`/coach/adjustments/${encodeURIComponent(id)}/approve`);
  return RomanAdjustmentSchema.parse(res.data);
}

export async function editAdjustment(id: string, input: EditInput): Promise<RomanAdjustment> {
  const res = await api.post(`/coach/adjustments/${encodeURIComponent(id)}/edit`, input);
  return RomanAdjustmentSchema.parse(res.data);
}

export async function dismissAdjustment(id: string, reason: DismissReason | null): Promise<RomanAdjustment> {
  const res = await api.post(`/coach/adjustments/${encodeURIComponent(id)}/dismiss`, reason ? { reason } : {});
  return RomanAdjustmentSchema.parse(res.data);
}

export async function undoAdjustment(id: string): Promise<RomanAdjustment> {
  const res = await api.post(`/coach/adjustments/${encodeURIComponent(id)}/undo`);
  return RomanAdjustmentSchema.parse(res.data);
}
