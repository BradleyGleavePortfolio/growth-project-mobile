/**
 * coachAiExecution — DTO types for the Stream 2 AI execution capabilities.
 *
 * Stream 2 extends the AI gateway with four "draft.*" capabilities that
 * let a coach ask the AI to propose a side-effecting action (message,
 * workout assignment, meal plan assignment, push notification). Every
 * draft requires the coach's explicit approval before the materialiser
 * emits the side-effect.
 *
 * Wire contract (matches the backend Stream 2 PR — see
 * `canonical_docs/STREAM_2_AI_EXECUTION_SPEC.md` §2 + §4.1):
 *
 *   Capability                  Endpoint
 *   draft.client_message        POST /coach/ai/drafts/message
 *   draft.assign_workout        POST /coach/ai/drafts/assign-workout
 *   draft.assign_meal_plan      POST /coach/ai/drafts/assign-meal-plan
 *   draft.send_notification     POST /coach/ai/drafts/send-notification
 *
 *   List pending                GET  /coach/ai/drafts/pending
 *   Approve                     POST /coach/ai/drafts/:id/approve
 *   Reject                      POST /coach/ai/drafts/:id/reject
 *
 * Status: backend PR not yet merged at build time. The mobile mocks the
 * API at the axios layer (see `src/api/coachAiExecutionApi.ts`'s
 * `_isMocked` export) and will swap to the real network once the
 * backend lands. The DTO shapes here are the source of truth the
 * backend was specced against; if the backend response diverges the
 * fix is to update these types + the axios adapter, NOT the consuming
 * UI.
 */

/**
 * The four Stream 2 capabilities. Names match the backend's
 * `AiActionDraft.capability` column so a single string round-trips from
 * the controller's request body, through the gateway, to the
 * materialiser registry, and back out on the pending-drafts list.
 *
 * `draft.coach_message` (existing from PR #293) is intentionally NOT
 * included — it's reachable from the messages surface, not from the
 * Stream 2 sheet on the client-detail screen.
 */
export type CoachAiDraftCapability =
  | 'draft.client_message'
  | 'draft.assign_workout'
  | 'draft.assign_meal_plan'
  | 'draft.send_notification';

/** Status values surfaced on the pending-drafts list. The full
 *  backend enum includes more states (e.g. `expired`); the inbox only
 *  ever lists `pending` rows, so the runtime value will always be
 *  'pending' on a successful list response. Other states surface only
 *  as the result of approve/reject. */
export type CoachAiDraftStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'racing';

// ─── Per-capability payload shapes ──────────────────────────────────────────
// These mirror the backend Zod schemas (see
// `src/ai/gateway/materialisers/*.materialiser.ts` in the Stream 2 PR).
// Keep the shapes minimal — the materialiser is the source of truth and
// re-validates the payload at materialise time.

/** Outbound coach → client direct message proposed by the AI. */
export interface ClientMessagePayload {
  clientId: string;
  /** 1..4000 chars after trim. Never whitespace-only. */
  body: string;
}

/** A workout assignment the AI is proposing for a client. The backend
 *  materialiser inserts the actual `ClientWorkoutAssignment` row. We
 *  carry only the surface fields the coach reviews in the inbox card. */
export interface AssignWorkoutPayload {
  clientId: string;
  /** Short human-readable name. Drives the inbox card title. */
  workoutName: string;
  /** Number of weeks the assignment covers. Used in the card subtitle. */
  weekCount: number;
  /** Exercise count on day 1 — gives the coach a single glanceable
   *  cue for how dense the first session is. */
  day1ExerciseCount: number;
  /** Optional rationale the model emitted. Kept short; the inbox card
   *  truncates and the full string is available in a detail screen. */
  rationale?: string;
}

/** A meal plan assignment proposed by the AI. */
export interface AssignMealPlanPayload {
  clientId: string;
  planName: string;
  /** Day count of the plan (typically 7). */
  dayCount: number;
  /** Macro summary line for the inbox card — e.g. "180p / 220c / 70f". */
  macroSummary: string;
  rationale?: string;
}

/** A push notification proposed by the AI. */
export interface SendNotificationPayload {
  clientId: string;
  /** 1..120 chars. */
  title: string;
  /** 1..240 chars. */
  body: string;
  /** Optional ISO8601 scheduled-for time. Null/undefined means send-now. */
  scheduledFor?: string | null;
}

/** Discriminated-union shape returned by `listPending` so the inbox can
 *  switch on `capability` to pick the right card renderer. */
export type CoachAiDraft =
  | (CoachAiDraftBase & { capability: 'draft.client_message'; payload: ClientMessagePayload })
  | (CoachAiDraftBase & { capability: 'draft.assign_workout'; payload: AssignWorkoutPayload })
  | (CoachAiDraftBase & { capability: 'draft.assign_meal_plan'; payload: AssignMealPlanPayload })
  | (CoachAiDraftBase & { capability: 'draft.send_notification'; payload: SendNotificationPayload });

export interface CoachAiDraftBase {
  /** Server-assigned UUID. The approve/reject endpoints key off this. */
  id: string;
  status: CoachAiDraftStatus;
  /** Mirrors `tenant_coach_id` from the backend — present on every
   *  Stream 2 draft because the four new capabilities are coach-scoped. */
  tenantCoachId: string;
  /** Subject client — never null for Stream 2 (every capability targets
   *  exactly one client). */
  subjectClientId: string;
  /** Display name for the client. Server resolves this at list-time so
   *  the inbox doesn't have to fan out a per-row user lookup. */
  subjectClientName: string;
  /** ISO8601. Used for the per-card timestamp. */
  createdAt: string;
  /** Optional 1-line model-emitted rationale. Surfaced as the card
   *  subtitle when the per-capability payload doesn't carry its own. */
  rationale?: string | null;
}

// ─── Per-endpoint request / response shapes ─────────────────────────────────

/** Common shape for the four invocation requests. The coach's prompt is
 *  the only user-supplied free text; everything else (clientId, tenant
 *  coach id) is bound server-side from the JWT + path params. */
export interface InvokeDraftRequest {
  clientId: string;
  /** Coach's natural-language prompt. 1..500 chars. */
  prompt: string;
}

export interface InvokeDraftResponse {
  /** The draft id the materialiser will use as its idempotency key. */
  draftId: string;
  /** Initial status — typically 'pending'. */
  status: CoachAiDraftStatus;
  /** Mirror of the chosen capability so the inbox can refresh
   *  immediately without re-fetching. */
  capability: CoachAiDraftCapability;
}

export interface ListPendingResponse {
  drafts: CoachAiDraft[];
}

export interface ApproveDraftResponse {
  draftId: string;
  status: CoachAiDraftStatus;
  /** The materialised row's id (e.g. CoachMessage.id, AssignedWorkout.id).
   *  Null only on `racing` outcomes where the materialiser refused to
   *  commit the side-effect — the UI should re-fetch the inbox. */
  materialisedRef?: string | null;
}

export interface RejectDraftRequest {
  /** Optional 1..240 char reason — surfaces in the audit log. */
  reason?: string;
}

export interface RejectDraftResponse {
  draftId: string;
  status: CoachAiDraftStatus;
}

// ─── Display helpers (pure functions — no React deps) ───────────────────────
// Kept in the types module so tests + the inbox + the sheet can share
// the same label resolution without re-implementing it.

/** Human-readable card title per capability. Centralised so a future
 *  copy tweak only changes one file. */
export function capabilityLabel(c: CoachAiDraftCapability): string {
  switch (c) {
    case 'draft.client_message':
      return 'Message draft';
    case 'draft.assign_workout':
      return 'Workout suggestion';
    case 'draft.assign_meal_plan':
      return 'Meal plan suggestion';
    case 'draft.send_notification':
      return 'Check-in nudge';
  }
}

/** One-line preview string for a draft, used by the inbox card subtitle
 *  and by the sheet's optimistic "submitted" state. The function is
 *  intentionally narrow — long previews live on the detail screen
 *  (when/if we add one); the inbox stays a single line per card. */
export function previewFor(draft: CoachAiDraft): string {
  switch (draft.capability) {
    case 'draft.client_message':
      return truncate(draft.payload.body, 120);
    case 'draft.assign_workout':
      return `${draft.payload.workoutName} — ${draft.payload.weekCount}w, day 1 has ${draft.payload.day1ExerciseCount} exercises`;
    case 'draft.assign_meal_plan':
      return `${draft.payload.planName} — ${draft.payload.dayCount}d, ${draft.payload.macroSummary}`;
    case 'draft.send_notification':
      return `${draft.payload.title} — ${truncate(draft.payload.body, 80)}`;
  }
}

/** Truncate a string at the nearest word boundary at or below `max`
 *  chars and append a Unicode ellipsis. Used by `previewFor`. */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const slice = s.slice(0, max).trimEnd();
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max - 20 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}
