/**
 * aiBuilderApi — typed, zod-parsed client for "Ask AI" in the workout builder
 * (AIB-5). Contract: AI_MASTER_BUILDER_PLAN.md PART 2 section 3.
 *
 *   GET   /ai/gateway/workout-builder/status   (AIB-4; 404 on older backends)
 *   POST  /ai/gateway/workout-builder/propose  (AIB-2)
 *   PATCH /ai/gateway/drafts/:id               (existing; AIB-2 adds accepted_change_ids)
 *
 * The app must work against the CURRENT production backend, which has none of
 * the new routes: a 404 on status means "not available" and the screen hides
 * the entry. Every other refusal maps to one bounded `AiBuilderErrorCode` so
 * the sheet always shows a specific line, never a generic error.
 */
import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';

export const AI_BUILDER_INSTRUCTION_MAX = 1000;

export const AI_BUILDER_QUICK_ACTIONS = [
  'swap_for_injury',
  'progress',
  'deload',
  'shorten',
  'more_volume',
  'explain',
] as const;
export type AiBuilderQuickAction = (typeof AI_BUILDER_QUICK_ACTIONS)[number];

export const AI_BUILDER_INJURY_AREAS = [
  'knee',
  'shoulder',
  'lower_back',
  'hip',
  'elbow_wrist',
  'ankle_foot',
  'upper_back_neck',
] as const;
export type AiBuilderInjuryArea = (typeof AI_BUILDER_INJURY_AREAS)[number] | 'other';

const StatusSchema = z.object({
  state: z.enum(['on', 'paused', 'no_credits', 'not_configured']),
  create: z.boolean(),
  edit: z.boolean(),
  credits: z.object({
    remaining_pct: z.number().min(0).max(100).nullable(),
    resets_at: z.string().nullable(),
  }),
  label: z.string(),
});
export type AiBuilderStatus = z.infer<typeof StatusSchema>;

const RowSchema = z.object({
  exercise_external_id: z.string().optional(),
  sets: z.number().nullable().optional(),
  reps_or_duration_seconds: z.number().nullable().optional(),
  rest_seconds: z.number().nullable().optional(),
  weight_lbs: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type AiBuilderRow = z.infer<typeof RowSchema>;

const ChangeSchema = z.object({
  change_id: z.string().min(1),
  kind: z.enum(['added', 'changed', 'removed', 'moved', 'meta']),
  // The diff op is applied server-side by draft id; the app only displays it.
  op: z.unknown(),
  before: RowSchema.nullable().optional(),
  after: RowSchema.nullable().optional(),
  exercise: z.object({
    id: z.string(),
    name: z.string(),
    thumbnail_url: z.string().nullable(),
  }),
  reason: z.string().max(400),
  warnings: z.array(z.string()),
});
export type AiBuilderChange = z.infer<typeof ChangeSchema>;

const ProposalSchema = z.object({
  draft_id: z.string().min(1),
  summary: z.string(),
  changes: z.array(ChangeSchema),
  dropped: z.array(z.object({ reason: z.string() })),
  context_used: z.array(z.string()),
  screening_flag: z.boolean(),
  credits_remaining_pct: z.number().nullable().optional(),
});
export type AiBuilderProposal = z.infer<typeof ProposalSchema>;

const DecideSchema = z.object({
  status: z.string(),
  materialised_ref: z
    .object({
      plan_id: z.string(),
      revision_index: z.number().int().min(0),
      // Optional: when present the builder adopts the new head without a
      // second round trip; when absent it re-reads the plan (edited-elsewhere path).
      lock_token: z.string().regex(/^[0-9a-f]{16}$/).optional(),
    })
    .nullable()
    .optional(),
});
export type AiBuilderDecision = z.infer<typeof DecideSchema>;

export type AiBuilderErrorCode =
  | 'not_available'
  | 'paused'
  | 'no_credits'
  | 'consent_required'
  | 'stale'
  | 'no_safe_proposal'
  | 'rate_limited'
  | 'forbidden'
  | 'network'
  | 'server'
  | 'contract';

export class AiBuilderError extends Error {
  constructor(
    public readonly code: AiBuilderErrorCode,
    public readonly status: number,
    /** Reset date for `no_credits` (ISO), when the server sent one. */
    public readonly resetsAt: string | null = null,
  ) {
    super(`ai-builder: ${code} (${status})`);
    this.name = 'AiBuilderError';
    Object.setPrototypeOf(this, AiBuilderError.prototype);
  }
}

function bodyCode(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const rec = data as Record<string, unknown>;
  for (const key of ['code', 'error', 'message']) {
    const v = rec[key];
    if (typeof v === 'string') return v;
  }
  return null;
}

function bodyResetsAt(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const budget = (data as Record<string, unknown>).budget;
  if (!budget || typeof budget !== 'object') return null;
  const end = (budget as Record<string, unknown>).period_end;
  return typeof end === 'string' ? end : null;
}

/** Map any failure to one bounded code. Exported for tests. */
export function toAiBuilderError(err: unknown): AiBuilderError {
  if (err instanceof AiBuilderError) return err;
  if (err instanceof z.ZodError) return new AiBuilderError('contract', 0);
  if (!axios.isAxiosError(err) || !err.response) return new AiBuilderError('network', 0);
  const { status, data } = err.response;
  const code = bodyCode(data);
  if (code === 'COACH_AI_BUDGET_EXHAUSTED' || status === 402) {
    return new AiBuilderError('no_credits', status, bodyResetsAt(data));
  }
  if (code === 'ai_consent_required') return new AiBuilderError('consent_required', status);
  if (status === 404) return new AiBuilderError('not_available', status);
  if (status === 409) return new AiBuilderError('stale', status);
  if (status === 422) return new AiBuilderError('no_safe_proposal', status);
  if (status === 429) return new AiBuilderError('rate_limited', status);
  if (status === 503) return new AiBuilderError('paused', status);
  if (status === 401 || status === 403) return new AiBuilderError('forbidden', status);
  return new AiBuilderError('server', status);
}

async function run<T>(schema: z.ZodType<T>, fn: () => Promise<{ data: unknown }>): Promise<T> {
  try {
    const res = await fn();
    return schema.parse(res.data);
  } catch (err) {
    throw toAiBuilderError(err);
  }
}

export interface ProposeBody {
  mode: 'create' | 'edit';
  plan_id: string;
  lock_token?: string;
  client_id?: string;
  instruction: string;
  quick_action?: AiBuilderQuickAction;
  injury_area?: AiBuilderInjuryArea;
}

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

  propose(body: ProposeBody): Promise<AiBuilderProposal> {
    const payload: ProposeBody = {
      ...body,
      instruction: body.instruction.slice(0, AI_BUILDER_INSTRUCTION_MAX),
    };
    return run(ProposalSchema, () =>
      api.post('/ai/gateway/workout-builder/propose', payload, {
        headers: { 'Idempotency-Key': generateIdempotencyKey() },
      }),
    );
  },

  apply(draftId: string, acceptedChangeIds: string[]): Promise<AiBuilderDecision> {
    return run(DecideSchema, () =>
      api.patch(`/ai/gateway/drafts/${encodeURIComponent(draftId)}`, {
        decision: 'approved',
        accepted_change_ids: acceptedChangeIds,
      }),
    );
  },

  discard(draftId: string): Promise<AiBuilderDecision> {
    return run(DecideSchema, () =>
      api.patch(`/ai/gateway/drafts/${encodeURIComponent(draftId)}`, { decision: 'rejected' }),
    );
  },
};
