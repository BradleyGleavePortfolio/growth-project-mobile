/**
 * coachAiExecution — DTO types for the Stream 2 AI execution capabilities.
 *
 * R1 audit fix (P0-2): the previous DTO shapes diverged from the backend
 * Zod schemas, response envelope, and URL paths. This rewrite mirrors the
 * backend exactly — see:
 *   - `src/ai/gateway/materialisers/assign-workout.materialiser.ts`
 *   - `src/ai/gateway/materialisers/assign-meal-plan.materialiser.ts`
 *   - `src/ai/gateway/materialisers/send-notification.materialiser.ts`
 *   - `src/ai/coach/coach-ai-execution.controller.ts` (DTOs lines 42-123)
 *   - `src/ai/gateway/ai-gateway.controller.ts` (list/decide endpoints)
 *
 * Wire contract:
 *
 *   POST /v1/coach/ai/draft/assign-workout       → draft.assign_workout
 *   POST /v1/coach/ai/draft/assign-meal-plan     → draft.assign_meal_plan
 *   POST /v1/coach/ai/draft/send-notification    → draft.send_notification
 *
 *   GET  /ai/gateway/drafts?status=pending&clientId=&limit=
 *   PATCH /ai/gateway/drafts/:id   body: { decision: 'approved' | 'rejected', note? }
 *
 * R1 audit fix (capability merge): `draft.client_message` was removed from
 * the backend and merged into the existing PR #293 `draft.coach_message`
 * surface, which is reached through `coachAi.ts` (the pre-Stream-2 module).
 * Stream 2 mobile no longer exposes `draft.client_message`; the Ask AI
 * sheet routes message-drafting to the existing coach-message flow.
 *
 * Approval surface returns the raw AiActionDraft row (snake_case Prisma
 * fields). Mobile mirrors that shape; helpers below normalise the
 * capability discriminant.
 */

// `draft.coach_message` is intentionally NOT included here — it predates
// Stream 2 and is handled by `coachAi.ts`. If the unified inbox needs to
// render a coach_message row, extend `CoachAiDraftCapability` + `previewFor`.
export type CoachAiDraftCapability =
  | 'draft.assign_workout'
  | 'draft.assign_meal_plan'
  | 'draft.send_notification';

/**
 * Statuses returned by the backend on the AiActionDraft row. The inbox only
 * ever renders 'pending' rows; approve/reject responses surface other states.
 */
export type CoachAiDraftStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired';

// ─── Per-capability proposed_action payload shapes ──────────────────────────
//
// Structured fields the backend Zod schemas demand at draft creation AND
// re-validate at materialisation. Field names + types MUST match exactly.

/** Payload for `draft.assign_workout`. */
export interface AssignWorkoutProposedAction {
  /** Existing WorkoutPlan UUID owned by the tenant coach. */
  workoutPlanId: string;
  /** Subject client UUID. */
  clientId: string;
  /** ISO 8601 date-time when the workout is due. */
  scheduledFor: string;
  /** Optional override copy for the push notification (≤160 chars). */
  notificationBody?: string;
}

/** Payload for `draft.assign_meal_plan`. */
export interface AssignMealPlanProposedAction {
  /** Existing DailyMealPlan UUID owned by the tenant coach. */
  dailyMealPlanId: string;
  /** Subject client UUID. */
  clientId: string;
  /** Plan window start (YYYY-MM-DD). */
  startsOn: string;
  /** Optional plan window end (YYYY-MM-DD, inclusive). Must be ≥ startsOn. */
  endsOn?: string;
  /** Optional override copy for the push notification (≤160 chars). */
  notificationBody?: string;
}

/** Payload for `draft.send_notification`. */
export interface SendNotificationProposedAction {
  /** Subject client UUID. */
  clientId: string;
  /** Notification kind tag (1-64 chars, e.g. 'coach_nudge'). */
  kind: string;
  /** Notification body text shown to the client (1-160 chars). */
  body: string;
  /** Optional tgp:// deep link (≤512 chars). */
  deepLink?: string;
  /** Delivery channel. Backend defaults to 'push' when omitted. */
  channel?: 'push' | 'inapp';
}

// ─── Invoke request envelopes ───────────────────────────────────────────────
//
// Camel-case keys mirror the controller DTOs (`coach-ai-execution.controller.ts:42-123`).
// NestJS class-validator unmarshals JSON keys as-is, so camelCase round-trips.

export interface AssignWorkoutInvokeRequest {
  workoutPlanId: string;
  clientId: string;
  scheduledFor: string;
  prompt: string;
  notificationBody?: string;
}

export interface AssignMealPlanInvokeRequest {
  dailyMealPlanId: string;
  clientId: string;
  startsOn: string;
  endsOn?: string;
  prompt: string;
  notificationBody?: string;
}

export interface SendNotificationInvokeRequest {
  clientId: string;
  kind: string;
  body: string;
  prompt: string;
  deepLink?: string;
  channel?: 'push' | 'inapp';
}

// ─── Invoke response envelope (matches gateway draftResponse) ───────────────
//
// `coach-ai-execution.controller.ts:279-295` returns:
//   { request_id, audit_id, approval: { required, status, draft_id } }

export type ApprovalStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired';

export interface InvokeDraftResponse {
  request_id: string;
  audit_id: string;
  approval: {
    required: boolean;
    status: ApprovalStatus;
    draft_id: string | null;
  };
}

// ─── List pending / decide response shapes ─────────────────────────────────
//
// `ai-gateway.controller.ts` returns the raw Prisma row. AiActionDraft
// fields are snake_case; `payload` is the structured JSON.

export interface AiActionDraftRow {
  id: string;
  /** Includes Stream 2 capabilities AND pre-Stream-2 (e.g. draft.coach_message). */
  capability: string;
  status: CoachAiDraftStatus;
  tenant_coach_id: string | null;
  subject_user_id: string | null;
  requester_id: string | null;
  created_at: string;
  decided_at?: string | null;
  decided_by_id?: string | null;
  decision_note?: string | null;
  materialised_ref?: string | null;
  payload: Record<string, unknown>;
}

export interface ListPendingResponse {
  drafts: AiActionDraftRow[];
}

export interface DecideRequest {
  decision: 'approved' | 'rejected';
  note?: string;
}

/** Decide returns the updated row. */
export type DecideResponse = AiActionDraftRow;

// ─── Display helpers ────────────────────────────────────────────────────────

/** Whether the row's capability belongs to Stream 2 and the inbox knows how
 *  to render it. The inbox tolerates unknown capabilities so an older
 *  draft.coach_message row co-existing in the queue doesn't blow up. */
export function isStream2Capability(c: string): c is CoachAiDraftCapability {
  return (
    c === 'draft.assign_workout' ||
    c === 'draft.assign_meal_plan' ||
    c === 'draft.send_notification'
  );
}

/** Human-readable card title per capability. */
export function capabilityLabel(c: CoachAiDraftCapability): string {
  switch (c) {
    case 'draft.assign_workout':
      return 'Workout suggestion';
    case 'draft.assign_meal_plan':
      return 'Meal plan suggestion';
    case 'draft.send_notification':
      return 'Check-in nudge';
  }
}

/**
 * One-line preview string for a Stream 2 draft. Reads from `row.payload`
 * via the per-capability structured-payload type. Callers should pre-filter
 * with `isStream2Capability`.
 */
export function previewFor(row: AiActionDraftRow): string {
  switch (row.capability) {
    case 'draft.assign_workout': {
      const p = row.payload as Partial<AssignWorkoutProposedAction>;
      const when = p.scheduledFor ? formatScheduledFor(p.scheduledFor) : 'unscheduled';
      const note = p.notificationBody ? ` — ${truncate(p.notificationBody, 80)}` : '';
      return `Workout · ${when}${note}`;
    }
    case 'draft.assign_meal_plan': {
      const p = row.payload as Partial<AssignMealPlanProposedAction>;
      const window =
        p.startsOn && p.endsOn
          ? `${p.startsOn} → ${p.endsOn}`
          : p.startsOn
            ? `from ${p.startsOn}`
            : 'no window';
      const note = p.notificationBody ? ` — ${truncate(p.notificationBody, 80)}` : '';
      return `Meal plan · ${window}${note}`;
    }
    case 'draft.send_notification': {
      const p = row.payload as Partial<SendNotificationProposedAction>;
      return p.body ? truncate(p.body, 120) : '(no body)';
    }
    default:
      return '';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max).trimEnd();
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max - 20 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

function formatScheduledFor(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
