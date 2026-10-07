/**
 * aiBuilderApi — zod-parsed Ask AI client (AIB-5; contract: AI_MASTER_BUILDER_PLAN.md PART 2 section 3). GET status (AIB-4;
 * 404 on older backends -> entry hidden), POST propose (AIB-2), PATCH drafts/:id (accepted_change_ids). One code per refusal.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';

export const AI_BUILDER_INSTRUCTION_MAX = 1000;
export const AI_BUILDER_QUICK_ACTIONS = ['swap_for_injury', 'progress', 'deload', 'shorten', 'more_volume', 'explain'] as const;
export type AiBuilderQuickAction = (typeof AI_BUILDER_QUICK_ACTIONS)[number];
export const AI_BUILDER_INJURY_AREAS = ['knee', 'shoulder', 'lower_back', 'hip', 'elbow_wrist', 'ankle_foot', 'upper_back_neck'] as const;
export type AiBuilderInjuryArea = (typeof AI_BUILDER_INJURY_AREAS)[number];

const StatusSchema = z.object({
  state: z.enum(['on', 'paused', 'no_credits', 'not_configured']), create: z.boolean(), edit: z.boolean(), label: z.string(),
  credits: z.object({ remaining_pct: z.number().nullable(), resets_at: z.string().nullable() }),
});
export type AiBuilderStatus = z.infer<typeof StatusSchema>;

const n = z.number().nullable().optional();
const RowSchema = z.object({ exercise_external_id: z.string().optional(), sets: n, reps_or_duration_seconds: n, rest_seconds: n, weight_lbs: n }).nullable().optional();

const ChangeSchema = z.object({
  change_id: z.string().min(1), kind: z.enum(['added', 'changed', 'removed', 'moved', 'meta']),
  op: z.unknown(), // applied server-side by draft id; display only here. b#809: exercise is null for remove, reorder and meta.
  before: RowSchema, after: RowSchema, reason: z.string(), warnings: z.array(z.string()),
  exercise: z.object({ id: z.string(), name: z.string(), thumbnail_url: z.string().nullable() }).nullable(),
});
export type AiBuilderChange = z.infer<typeof ChangeSchema>;

// b#809: draft_id is null for explain (no draft is written): the sheet shows the summary and Done, with no apply or discard call.
const ProposalSchema = z.object({
  draft_id: z.string().min(1).nullable(), summary: z.string(), changes: z.array(ChangeSchema), dropped: z.array(z.object({ reason: z.string() })),
  context_used: z.array(z.string()), screening_flag: z.boolean(), credits_remaining_pct: z.number().nullable().optional(),
});
export type AiBuilderProposal = z.infer<typeof ProposalSchema>;

// Approve replies with the AiActionDraft row: materialised_ref = plan id STRING (main, b#809) -> null, the screen re-reads; a section 3 object -> adopt.
const RefSchema = z.object({ plan_id: z.string(), revision_index: z.number().int().min(0), lock_token: z.string().regex(/^[0-9a-f]{16}$/).optional() });
const DecideSchema = z.object({ status: z.string(), materialised_ref: z.union([RefSchema, z.string()]).nullable().optional().transform((r) => (typeof r === 'string' ? null : r ?? null)) });
export type AiBuilderRef = z.infer<typeof DecideSchema>['materialised_ref'];

export type AiBuilderErrorCode = 'not_available' | 'paused' | 'no_credits' | 'consent_required' | 'stale' | 'no_safe_proposal' | 'rate_limited' | 'forbidden' | 'network' | 'server' | 'contract';

export class AiBuilderError extends Error {
  constructor(public readonly code: AiBuilderErrorCode, public readonly status: number, public readonly resetsAt: string | null = null) {
    super(`ai-builder: ${code} (${status})`);
    this.name = 'AiBuilderError';
    Object.setPrototypeOf(this, AiBuilderError.prototype);
  }
}

const field = (data: unknown, key: string): unknown => (data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined);

/** Map any failure to one bounded code. */
export function toAiBuilderError(err: unknown): AiBuilderError {
  if (err instanceof AiBuilderError) return err;
  if (err instanceof z.ZodError) return new AiBuilderError('contract', 0);
  if (!axios.isAxiosError(err) || !err.response) return new AiBuilderError('network', 0);
  const { status, data } = err.response;
  const code = field(data, 'code') ?? field(data, 'error') ?? field(data, 'message');
  if (code === 'COACH_AI_BUDGET_EXHAUSTED' || status === 402) {
    const end = field(field(data, 'budget'), 'period_end');
    return new AiBuilderError('no_credits', status, typeof end === 'string' ? end : null);
  }
  if (code === 'ai_consent_required') return new AiBuilderError('consent_required', status);
  if (code === 'AI_NOT_CONFIGURED') return new AiBuilderError('server', status); // b#809 503: the model did not answer (not the kill switch)
  const byStatus: Record<number, AiBuilderErrorCode> = { 401: 'forbidden', 403: 'forbidden', 404: 'not_available', 409: 'stale', 422: 'no_safe_proposal', 429: 'rate_limited', 503: 'paused' };
  return new AiBuilderError(byStatus[status] ?? 'server', status);
}

const run = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, fn: () => Promise<{ data: unknown }>): Promise<T> =>
  Promise.resolve().then(fn).then((res) => schema.parse(res.data)).catch((err: unknown) => Promise.reject(toAiBuilderError(err)));

// lock_token is omitted until the builder holds a real head token (none yet, or the bootstrap one); client_id arrives with AIB-6 (client context).
export type ProposeBody = { mode: 'create' | 'edit'; plan_id: string; lock_token?: string; client_id?: string; instruction: string; quick_action?: AiBuilderQuickAction; injury_area?: AiBuilderInjuryArea };

const draftUrl = (id: string) => `/ai/gateway/drafts/${encodeURIComponent(id)}`;

export const aiBuilderApi = {
  /** null = this backend has no Ask AI (404): hide the entry. */
  getStatus: (): Promise<AiBuilderStatus | null> => run(StatusSchema, () => api.get('/ai/gateway/workout-builder/status'))
    .catch((err: unknown) => (err instanceof AiBuilderError && err.code === 'not_available' ? null : Promise.reject(err))),
  propose: (body: ProposeBody) => run(ProposalSchema, () => api.post('/ai/gateway/workout-builder/propose',
    { ...body, instruction: body.instruction.slice(0, AI_BUILDER_INSTRUCTION_MAX) }, { headers: { 'Idempotency-Key': generateIdempotencyKey() } })),
  apply: (draftId: string, acceptedChangeIds: string[]) =>
    run(DecideSchema, () => api.patch(draftUrl(draftId), { decision: 'approved', accepted_change_ids: acceptedChangeIds })),
  discard: (draftId: string) => run(DecideSchema, () => api.patch(draftUrl(draftId), { decision: 'rejected' })),
};
