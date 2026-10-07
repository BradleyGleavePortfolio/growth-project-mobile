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
const RowSchema = z.object({ sets: n, reps_or_duration_seconds: n, rest_seconds: n, weight_lbs: n }).nullable().optional();

const ChangeSchema = z.object({
  change_id: z.string().min(1), kind: z.enum(['added', 'changed', 'removed', 'moved', 'meta']),
  op: z.unknown(), // applied server-side by draft id; display only here
  before: RowSchema, after: RowSchema, reason: z.string(), warnings: z.array(z.string()),
  exercise: z.object({ id: z.string(), name: z.string(), thumbnail_url: z.string().nullable() }),
});
export type AiBuilderChange = z.infer<typeof ChangeSchema>;

const ProposalSchema = z.object({
  draft_id: z.string().min(1), summary: z.string(), changes: z.array(ChangeSchema), dropped: z.array(z.object({ reason: z.string() })),
  context_used: z.array(z.string()), screening_flag: z.boolean(), credits_remaining_pct: z.number().nullable().optional(),
});
export type AiBuilderProposal = z.infer<typeof ProposalSchema>;

const DecideSchema = z.object({
  status: z.string(),
  // lock_token (optional): when present the builder adopts the new head at once
  // and the header Undo reverts the AI change; when absent it re-reads the plan.
  materialised_ref: z
    .object({ plan_id: z.string(), revision_index: z.number().int().min(0), lock_token: z.string().regex(/^[0-9a-f]{16}$/).optional() })
    .nullable()
    .optional(),
});
export type AiBuilderRef = z.infer<typeof DecideSchema>['materialised_ref'];

export type AiBuilderErrorCode =
  | 'not_available' | 'paused' | 'no_credits' | 'consent_required' | 'stale'
  | 'no_safe_proposal' | 'rate_limited' | 'forbidden' | 'network' | 'server' | 'contract';

export class AiBuilderError extends Error {
  constructor(public readonly code: AiBuilderErrorCode, public readonly status: number, public readonly resetsAt: string | null = null) {
    super(`ai-builder: ${code} (${status})`);
    this.name = 'AiBuilderError';
    Object.setPrototypeOf(this, AiBuilderError.prototype);
  }
}

function field(data: unknown, key: string): unknown {
  return data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
}

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
  const byStatus: Record<number, AiBuilderErrorCode> = {
    401: 'forbidden', 403: 'forbidden', 404: 'not_available', 409: 'stale', 422: 'no_safe_proposal', 429: 'rate_limited', 503: 'paused',
  };
  return new AiBuilderError(byStatus[status] ?? 'server', status);
}

async function run<T>(schema: z.ZodType<T>, fn: () => Promise<{ data: unknown }>): Promise<T> {
  try {
    return schema.parse((await fn()).data);
  } catch (err) {
    throw toAiBuilderError(err);
  }
}

export interface ProposeBody {
  mode: 'create' | 'edit';
  plan_id: string;
  lock_token?: string; // omitted while the builder only holds the bootstrap token
  client_id?: string; // AIB-6 (client context); absent = template/library work, no client data
  instruction: string;
  quick_action?: AiBuilderQuickAction;
  injury_area?: AiBuilderInjuryArea;
}

const draftUrl = (id: string) => `/ai/gateway/drafts/${encodeURIComponent(id)}`;

export const aiBuilderApi = {
  /** null = this backend has no Ask AI (404): hide the entry. */
  async getStatus(): Promise<AiBuilderStatus | null> {
    try {
      return await run(StatusSchema, () => api.get('/ai/gateway/workout-builder/status'));
    } catch (err) {
      if (err instanceof AiBuilderError && err.code === 'not_available') return null;
      throw err;
    }
  },
  propose: (body: ProposeBody) =>
    run(ProposalSchema, () =>
      api.post(
        '/ai/gateway/workout-builder/propose',
        { ...body, instruction: body.instruction.slice(0, AI_BUILDER_INSTRUCTION_MAX) },
        { headers: { 'Idempotency-Key': generateIdempotencyKey() } },
      ),
    ),
  apply: (draftId: string, acceptedChangeIds: string[]) =>
    run(DecideSchema, () => api.patch(draftUrl(draftId), { decision: 'approved', accepted_change_ids: acceptedChangeIds })),
  discard: (draftId: string) => run(DecideSchema, () => api.patch(draftUrl(draftId), { decision: 'rejected' })),
};
