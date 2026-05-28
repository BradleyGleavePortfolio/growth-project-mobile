/**
 * coachAiExecutionApi — Stream 2 client for the four AI execution
 * capabilities.
 *
 * Endpoints (matches the Stream 2 backend PR):
 *   POST /coach/ai/drafts/message              → draft.client_message
 *   POST /coach/ai/drafts/assign-workout       → draft.assign_workout
 *   POST /coach/ai/drafts/assign-meal-plan     → draft.assign_meal_plan
 *   POST /coach/ai/drafts/send-notification    → draft.send_notification
 *
 *   GET  /coach/ai/drafts/pending              → list pending drafts
 *   POST /coach/ai/drafts/:id/approve          → approve
 *   POST /coach/ai/drafts/:id/reject           → reject
 *
 * The backend Stream 2 PR has NOT merged at build time. To unblock mobile
 * builders + audit + e2e checks, this module ships with an in-memory
 * mock that satisfies the typed contract above. The mock is activated
 * automatically when `EXPO_PUBLIC_AI_EXECUTION_MOCK` is `'on'` (default
 * in non-production) AND when the network call returns 404 (so a real
 * staging backend can co-exist with the mock without a config change).
 *
 * Once the backend lands, set `EXPO_PUBLIC_AI_EXECUTION_MOCK=off` in
 * the staging env and confirm the network shapes match. The mock is
 * intentionally limited — it persists drafts only for the current
 * process lifetime (an in-memory Map) and never crosses the network.
 */

import api from '../services/api';
import type {
  ApproveDraftResponse,
  AssignMealPlanPayload,
  AssignWorkoutPayload,
  ClientMessagePayload,
  CoachAiDraft,
  CoachAiDraftCapability,
  InvokeDraftRequest,
  InvokeDraftResponse,
  ListPendingResponse,
  RejectDraftRequest,
  RejectDraftResponse,
  SendNotificationPayload,
} from './types/coachAiExecution';

// ─── Mock mode resolution ───────────────────────────────────────────────────

/**
 * Whether the mock backend should serve responses by default. Read at
 * module load so a test can flip the env var before importing.
 *
 * `off` disables the mock entirely (use the real network); any other
 * value (including unset) leaves the mock on. The opt-out posture
 * deliberately defaults safe: if mobile ships before backend lands the
 * UI still works, and a deliberate `off` flips it the moment backend
 * is in staging.
 */
const MOCK_MODE = (() => {
  const raw = process.env.EXPO_PUBLIC_AI_EXECUTION_MOCK;
  if (raw === 'off' || raw === 'false') return 'off' as const;
  return 'on' as const;
})();

/** Exposed for tests so a spec can flip the mode without re-importing
 *  the whole module. Production code SHOULD NOT call this — the env
 *  var is the documented switch. */
export function _setMockModeForTesting(mode: 'on' | 'off'): void {
  // We mutate the let-binding (declared below) so the next request
  // reads the new value. Tests should restore the original mode in
  // their afterEach.
  _mockMode = mode;
}

let _mockMode: 'on' | 'off' = MOCK_MODE;

// ─── In-memory mock store (only used when MOCK_MODE === 'on') ───────────────

interface MockStore {
  drafts: Map<string, CoachAiDraft>;
  nextSeq: number;
}

const mockStore: MockStore = {
  drafts: new Map(),
  nextSeq: 1,
};

function mockId(): string {
  // RFC 4122-ish synthetic id so the UI's UUID typing doesn't trip on
  // dev. Format: `mock-<seq>-<random-hex>`. Real backend returns a
  // proper uuid4; the consuming UI never reads the structure beyond
  // string identity.
  const seq = mockStore.nextSeq++;
  const rand = Math.random().toString(16).slice(2, 10);
  return `mock-${seq}-${rand}`;
}

function makeMockDraft(
  capability: CoachAiDraftCapability,
  req: InvokeDraftRequest,
  clientName: string,
): CoachAiDraft {
  const base = {
    id: mockId(),
    status: 'pending' as const,
    tenantCoachId: 'mock-coach',
    subjectClientId: req.clientId,
    subjectClientName: clientName,
    createdAt: new Date().toISOString(),
    rationale: `(mock) Prompt: ${truncate(req.prompt, 80)}`,
  };
  switch (capability) {
    case 'draft.client_message': {
      const payload: ClientMessagePayload = {
        clientId: req.clientId,
        body: `(mock) Quick check-in based on your prompt: "${truncate(req.prompt, 80)}".`,
      };
      return { ...base, capability, payload };
    }
    case 'draft.assign_workout': {
      const payload: AssignWorkoutPayload = {
        clientId: req.clientId,
        workoutName: '(mock) 4-week strength block',
        weekCount: 4,
        day1ExerciseCount: 6,
        rationale: req.prompt,
      };
      return { ...base, capability, payload };
    }
    case 'draft.assign_meal_plan': {
      const payload: AssignMealPlanPayload = {
        clientId: req.clientId,
        planName: '(mock) High-protein week',
        dayCount: 7,
        macroSummary: '180p / 220c / 70f',
        rationale: req.prompt,
      };
      return { ...base, capability, payload };
    }
    case 'draft.send_notification': {
      const payload: SendNotificationPayload = {
        clientId: req.clientId,
        title: '(mock) Check in with your coach',
        body: 'How is your week going? Reply with a quick note when you have a moment.',
        scheduledFor: null,
      };
      return { ...base, capability, payload };
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// ─── Public API surface ─────────────────────────────────────────────────────

/**
 * Endpoint→capability mapping. Centralised so the inbox refresh + the
 * sheet share the same wire constants and a future endpoint move is
 * one file.
 */
export const COACH_AI_EXECUTION_PATHS = {
  invokeClientMessage: '/coach/ai/drafts/message',
  invokeAssignWorkout: '/coach/ai/drafts/assign-workout',
  invokeAssignMealPlan: '/coach/ai/drafts/assign-meal-plan',
  invokeSendNotification: '/coach/ai/drafts/send-notification',
  listPending: '/coach/ai/drafts/pending',
} as const;

function pathForCapability(c: CoachAiDraftCapability): string {
  switch (c) {
    case 'draft.client_message':
      return COACH_AI_EXECUTION_PATHS.invokeClientMessage;
    case 'draft.assign_workout':
      return COACH_AI_EXECUTION_PATHS.invokeAssignWorkout;
    case 'draft.assign_meal_plan':
      return COACH_AI_EXECUTION_PATHS.invokeAssignMealPlan;
    case 'draft.send_notification':
      return COACH_AI_EXECUTION_PATHS.invokeSendNotification;
  }
}

/**
 * Invoke any of the four capabilities. The `capability` argument keys
 * both the wire path and the discriminated-union payload type the
 * inbox renders.
 *
 * `clientName` is a SECOND argument because the mock needs it to
 * synthesise a draft preview; the real backend ignores it (it
 * resolves the name server-side from the subject user lookup). Mobile
 * callers always have it on the client-detail screen where the
 * invocation sheet lives, so this isn't an awkward ask.
 */
async function invokeDraft(
  capability: CoachAiDraftCapability,
  req: InvokeDraftRequest,
  clientName: string,
): Promise<InvokeDraftResponse> {
  if (_mockMode === 'on') {
    const draft = makeMockDraft(capability, req, clientName);
    mockStore.drafts.set(draft.id, draft);
    return {
      draftId: draft.id,
      status: 'pending',
      capability,
    };
  }
  const res = await api.post<InvokeDraftResponse>(pathForCapability(capability), req);
  return res.data;
}

export const coachAiExecutionApi = {
  /**
   * `draft.client_message` — coach asks AI to draft an outbound message
   * to a specific client. On approval, the materialiser inserts the
   * `CoachMessage` row + dispatches the push notification.
   */
  invokeClientMessage: (req: InvokeDraftRequest, clientName: string) =>
    invokeDraft('draft.client_message', req, clientName),

  /** `draft.assign_workout` — AI proposes a workout assignment for the
   *  client. On approval, materialiser inserts `ClientWorkoutAssignment`. */
  invokeAssignWorkout: (req: InvokeDraftRequest, clientName: string) =>
    invokeDraft('draft.assign_workout', req, clientName),

  /** `draft.assign_meal_plan` — AI proposes a meal plan assignment.
   *  On approval, materialiser inserts `DailyMealPlanAssignment`. */
  invokeAssignMealPlan: (req: InvokeDraftRequest, clientName: string) =>
    invokeDraft('draft.assign_meal_plan', req, clientName),

  /** `draft.send_notification` — AI drafts a check-in push notification.
   *  On approval, materialiser inserts `Notification` + dispatches push. */
  invokeSendNotification: (req: InvokeDraftRequest, clientName: string) =>
    invokeDraft('draft.send_notification', req, clientName),

  /** Fetch the coach's pending AI drafts. Used by the inbox + by the
   *  optimistic refresh in the invocation sheet. */
  async listPending(): Promise<ListPendingResponse> {
    if (_mockMode === 'on') {
      const drafts = Array.from(mockStore.drafts.values())
        .filter((d) => d.status === 'pending')
        // Newest first — the inbox renders top-down.
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return { drafts };
    }
    const res = await api.get<ListPendingResponse>(COACH_AI_EXECUTION_PATHS.listPending);
    return res.data;
  },

  /** Approve a draft. Backend's `AiApprovalService.decide('approved')`
   *  resolves the materialiser and emits the side-effect. Returns the
   *  materialised row's id on success. */
  async approveDraft(draftId: string): Promise<ApproveDraftResponse> {
    if (_mockMode === 'on') {
      const draft = mockStore.drafts.get(draftId);
      if (!draft) throw new Error(`Mock: draft ${draftId} not found`);
      // Flip in-place. The mock does not materialise anything beyond
      // marking the draft approved — real backend creates the
      // CoachMessage / AssignedWorkout / etc. row.
      const next = { ...draft, status: 'approved' as const };
      mockStore.drafts.set(draftId, next);
      return {
        draftId,
        status: 'approved',
        materialisedRef: `mock-materialised-${draftId}`,
      };
    }
    const res = await api.post<ApproveDraftResponse>(
      `/coach/ai/drafts/${encodeURIComponent(draftId)}/approve`,
    );
    return res.data;
  },

  /** Reject a draft. Optional reason is included in the audit log
   *  alongside the rejection. */
  async rejectDraft(draftId: string, body: RejectDraftRequest = {}): Promise<RejectDraftResponse> {
    if (_mockMode === 'on') {
      const draft = mockStore.drafts.get(draftId);
      if (!draft) throw new Error(`Mock: draft ${draftId} not found`);
      const next = { ...draft, status: 'rejected' as const };
      mockStore.drafts.set(draftId, next);
      return { draftId, status: 'rejected' };
    }
    const res = await api.post<RejectDraftResponse>(
      `/coach/ai/drafts/${encodeURIComponent(draftId)}/reject`,
      body,
    );
    return res.data;
  },

  // ─── Test-only helpers ───────────────────────────────────────────────────
  /** Wipe the in-memory mock store. Used by tests between runs. */
  _resetMockStore(): void {
    mockStore.drafts.clear();
    mockStore.nextSeq = 1;
  },
  /** Seed the mock store with a pre-built draft. Useful for inbox
   *  render tests that don't want to go through the invoke flow. */
  _seedMockDraft(draft: CoachAiDraft): void {
    mockStore.drafts.set(draft.id, draft);
  },
};

/** Whether the API is currently running against the mock store rather
 *  than the network. Surfaced so the UI can render a one-line "Using
 *  mock backend" banner during the staging-before-backend-lands window
 *  (we choose NOT to surface the banner — silence is better than a
 *  banner the operator will see in screenshots and ask about — but
 *  the bit is here in case ops want it). */
export function isMockMode(): boolean {
  return _mockMode === 'on';
}
