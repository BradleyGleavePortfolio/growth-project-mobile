/**
 * coachAiExecutionApi — Stream 2 client for the three AI execution
 * capabilities exposed by the backend coach-AI-execution controller.
 *
 * Wire contract (R1 audit fix — was wrong on every URL, every payload, and
 * every response shape; now matches `/v1/coach/ai/draft/*` exactly):
 *
 *   POST  /v1/coach/ai/draft/assign-workout      → draft.assign_workout
 *   POST  /v1/coach/ai/draft/assign-meal-plan    → draft.assign_meal_plan
 *   POST  /v1/coach/ai/draft/send-notification   → draft.send_notification
 *
 *   GET   /ai/gateway/drafts?status=pending&clientId=&limit=
 *   PATCH /ai/gateway/drafts/:id   body: { decision: 'approved'|'rejected', note? }
 *
 * `draft.client_message` is no longer surfaced here — it was merged into
 * the existing PR #293 `draft.coach_message` flow, which mobile reaches via
 * `coachAi.ts`. The Ask AI sheet routes message-drafting to that flow.
 *
 * Mock mode (R1 audit fix — P0-1): the previous module defaulted to MOCK ON
 * unless `EXPO_PUBLIC_AI_EXECUTION_MOCK=off` was explicitly set, meaning
 * production builds silently swallowed every coach action. The default is
 * now MOCK OFF; opt-in requires (a) a dev build (`__DEV__ === true`)
 * AND (b) the env flag explicitly set to 'on' or 'true'. Production
 * release builds never run the mock.
 */

import api from '../services/api';
import type {
  AiActionDraftRow,
  AssignMealPlanInvokeRequest,
  AssignMealPlanProposedAction,
  AssignWorkoutInvokeRequest,
  AssignWorkoutProposedAction,
  DecideRequest,
  DecideResponse,
  InvokeDraftResponse,
  ListPendingResponse,
  SendNotificationInvokeRequest,
  SendNotificationProposedAction,
} from './types/coachAiExecution';

// ─── Mock mode resolution ───────────────────────────────────────────────────

declare const __DEV__: boolean | undefined;

/**
 * Posture: opt-in, dev-only. Production release builds never run the mock.
 * A misconfigured `EXPO_PUBLIC_AI_EXECUTION_MOCK=on` in a release build logs
 * a warning and falls through to the real API.
 */
const MOCK_MODE: 'on' | 'off' = (() => {
  const raw = process.env.EXPO_PUBLIC_AI_EXECUTION_MOCK;
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__ === true;
  if (!isDev) {
    if (raw === 'on' || raw === 'true') {
      // eslint-disable-next-line no-console
      console.warn(
        '[coachAiExecutionApi] ignoring EXPO_PUBLIC_AI_EXECUTION_MOCK=' +
          raw +
          ' in non-dev build; falling through to real API.',
      );
    }
    return 'off';
  }
  if (raw === 'on' || raw === 'true') return 'on';
  return 'off';
})();

let _mockMode: 'on' | 'off' = MOCK_MODE;

/** Test-only: flip mock mode without re-importing the module. No-op in
 *  non-test builds so a production binary cannot be coerced into mock mode
 *  via this export. */
export function _setMockModeForTesting(mode: 'on' | 'off'): void {
  if (process.env.NODE_ENV !== 'test') return;
  _mockMode = mode;
}

// ─── In-memory mock store (only used when _mockMode === 'on') ──────────────

interface MockStore {
  drafts: Map<string, AiActionDraftRow>;
  nextSeq: number;
}

const mockStore: MockStore = {
  drafts: new Map(),
  nextSeq: 1,
};

function mockId(): string {
  const seq = mockStore.nextSeq++;
  const rand = Math.random().toString(16).slice(2, 10);
  return `mock-${seq}-${rand}`;
}

function makeMockRow(
  capability:
    | 'draft.assign_workout'
    | 'draft.assign_meal_plan'
    | 'draft.send_notification',
  payload: Record<string, unknown>,
  clientId: string,
): AiActionDraftRow {
  const now = new Date().toISOString();
  return {
    id: mockId(),
    capability,
    status: 'pending',
    tenant_coach_id: 'mock-coach',
    subject_user_id: clientId,
    requester_id: 'mock-coach',
    created_at: now,
    payload,
  };
}

function mockInvokeResponse(draftId: string): InvokeDraftResponse {
  return {
    request_id: mockId(),
    audit_id: mockId(),
    approval: {
      required: true,
      status: 'pending',
      draft_id: draftId,
    },
  };
}

// ─── Public API surface ─────────────────────────────────────────────────────

/** Centralised endpoint constants so a future route move is one file. */
export const COACH_AI_EXECUTION_PATHS = {
  invokeAssignWorkout: '/v1/coach/ai/draft/assign-workout',
  invokeAssignMealPlan: '/v1/coach/ai/draft/assign-meal-plan',
  invokeSendNotification: '/v1/coach/ai/draft/send-notification',
  listPending: '/ai/gateway/drafts',
  decide: (draftId: string) =>
    `/ai/gateway/drafts/${encodeURIComponent(draftId)}`,
} as const;

export const coachAiExecutionApi = {
  /**
   * `draft.assign_workout` — AI proposes assigning an existing WorkoutPlan
   * to a client at a scheduled time. On approval, the materialiser inserts
   * a `ClientWorkoutAssignment` row and fires a workout-assigned push.
   */
  async invokeAssignWorkout(
    req: AssignWorkoutInvokeRequest,
  ): Promise<InvokeDraftResponse> {
    if (_mockMode === 'on') {
      const payload: AssignWorkoutProposedAction = {
        workoutPlanId: req.workoutPlanId,
        clientId: req.clientId,
        scheduledFor: req.scheduledFor,
        notificationBody: req.notificationBody,
      };
      const row = makeMockRow(
        'draft.assign_workout',
        payload as unknown as Record<string, unknown>,
        req.clientId,
      );
      mockStore.drafts.set(row.id, row);
      return mockInvokeResponse(row.id);
    }
    const res = await api.post<InvokeDraftResponse>(
      COACH_AI_EXECUTION_PATHS.invokeAssignWorkout,
      req,
    );
    return res.data;
  },

  /** `draft.assign_meal_plan` — AI proposes a meal plan assignment window. */
  async invokeAssignMealPlan(
    req: AssignMealPlanInvokeRequest,
  ): Promise<InvokeDraftResponse> {
    if (_mockMode === 'on') {
      const payload: AssignMealPlanProposedAction = {
        dailyMealPlanId: req.dailyMealPlanId,
        clientId: req.clientId,
        startsOn: req.startsOn,
        endsOn: req.endsOn,
        notificationBody: req.notificationBody,
      };
      const row = makeMockRow(
        'draft.assign_meal_plan',
        payload as unknown as Record<string, unknown>,
        req.clientId,
      );
      mockStore.drafts.set(row.id, row);
      return mockInvokeResponse(row.id);
    }
    const res = await api.post<InvokeDraftResponse>(
      COACH_AI_EXECUTION_PATHS.invokeAssignMealPlan,
      req,
    );
    return res.data;
  },

  /** `draft.send_notification` — AI drafts a check-in push for the coach
   *  to approve. The notification IS the artifact — coach approval IS
   *  delivery (subject to OS-level mute + backend per-kind rate-limit). */
  async invokeSendNotification(
    req: SendNotificationInvokeRequest,
  ): Promise<InvokeDraftResponse> {
    if (_mockMode === 'on') {
      const payload: SendNotificationProposedAction = {
        clientId: req.clientId,
        kind: req.kind,
        body: req.body,
        deepLink: req.deepLink,
        channel: req.channel,
      };
      const row = makeMockRow(
        'draft.send_notification',
        payload as unknown as Record<string, unknown>,
        req.clientId,
      );
      mockStore.drafts.set(row.id, row);
      return mockInvokeResponse(row.id);
    }
    const res = await api.post<InvokeDraftResponse>(
      COACH_AI_EXECUTION_PATHS.invokeSendNotification,
      req,
    );
    return res.data;
  },

  /** Fetch the coach's pending AI drafts via the generic gateway endpoint.
   *  The gateway returns rows across ALL capabilities for the tenant coach;
   *  the inbox filters with `isStream2Capability` for renderable rows. */
  async listPending(
    options: { clientId?: string; limit?: number } = {},
  ): Promise<ListPendingResponse> {
    if (_mockMode === 'on') {
      const drafts = Array.from(mockStore.drafts.values())
        .filter((d) => d.status === 'pending')
        .filter((d) => !options.clientId || d.subject_user_id === options.clientId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { drafts };
    }
    const params: Record<string, string> = { status: 'pending' };
    if (options.clientId) params.clientId = options.clientId;
    if (options.limit) params.limit = String(options.limit);
    const res = await api.get<ListPendingResponse | AiActionDraftRow[]>(
      COACH_AI_EXECUTION_PATHS.listPending,
      { params },
    );
    // Normalise both possible shapes (Prisma findMany returns a bare array;
    // a future pagination wrapper would return an envelope).
    if (Array.isArray(res.data)) return { drafts: res.data };
    return res.data;
  },

  /** Approve a draft. PATCH the gateway decide endpoint. Returns the
   *  updated row. On materialisation failure backend returns a 500 with
   *  AI_MATERIALISATION_FAILED; the draft stays `pending` so the coach
   *  can retry. */
  async approveDraft(draftId: string, note?: string): Promise<DecideResponse> {
    const body: DecideRequest = { decision: 'approved', note };
    if (_mockMode === 'on') {
      const draft = mockStore.drafts.get(draftId);
      if (!draft) throw new Error(`Mock: draft ${draftId} not found`);
      const next: AiActionDraftRow = {
        ...draft,
        status: 'approved',
        decided_at: new Date().toISOString(),
        decision_note: note ?? null,
        materialised_ref: `mock-materialised-${draftId}`,
      };
      mockStore.drafts.set(draftId, next);
      return next;
    }
    const res = await api.patch<DecideResponse>(
      COACH_AI_EXECUTION_PATHS.decide(draftId),
      body,
    );
    return res.data;
  },

  /** Reject a draft. Optional reason surfaces in the audit log. */
  async rejectDraft(draftId: string, note?: string): Promise<DecideResponse> {
    const body: DecideRequest = { decision: 'rejected', note };
    if (_mockMode === 'on') {
      const draft = mockStore.drafts.get(draftId);
      if (!draft) throw new Error(`Mock: draft ${draftId} not found`);
      const next: AiActionDraftRow = {
        ...draft,
        status: 'rejected',
        decided_at: new Date().toISOString(),
        decision_note: note ?? null,
      };
      mockStore.drafts.set(draftId, next);
      return next;
    }
    const res = await api.patch<DecideResponse>(
      COACH_AI_EXECUTION_PATHS.decide(draftId),
      body,
    );
    return res.data;
  },

  // ─── Test-only helpers (no-op outside NODE_ENV=test) ─────────────────────
  /** Wipe the in-memory mock store. */
  _resetMockStore(): void {
    if (process.env.NODE_ENV !== 'test') return;
    mockStore.drafts.clear();
    mockStore.nextSeq = 1;
  },
  /** Seed the mock store with a pre-built draft row. */
  _seedMockDraft(row: AiActionDraftRow): void {
    if (process.env.NODE_ENV !== 'test') return;
    mockStore.drafts.set(row.id, row);
  },
};

/** Whether the API is currently running against the mock store. Production
 *  builds always return false. */
export function isMockMode(): boolean {
  return _mockMode === 'on';
}
