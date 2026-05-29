/**
 * coachAiExecutionApi — contract + mock-mode behaviour tests.
 *
 * Coverage:
 *   1. Display helpers from `types/coachAiExecution` (`capabilityLabel`,
 *      `previewFor`, `isStream2Capability`) used by the inbox + sheet.
 *   2. Mock-mode wire behaviour for the three Stream 2 capabilities:
 *      `invokeAssignWorkout`, `invokeAssignMealPlan`, `invokeSendNotification`.
 *   3. listPending + approveDraft + rejectDraft round-trip + invariants.
 *   4. Mock defaults to OFF; explicit opt-in via `_setMockModeForTesting`.
 *
 * Wire shapes mirror the backend Zod schemas + gateway response envelope
 * exactly (R1 audit fix). `draft.client_message` was removed and is NOT
 * tested here — that flow lives in the existing PR #293 coach-message
 * surface and has its own coverage in `coachAi.test.ts`.
 *
 * Doctrine-clean: no banned tokens in testIDs or assertion strings.
 */

import {
  capabilityLabel,
  isStream2Capability,
  previewFor,
  type AiActionDraftRow,
} from '../types/coachAiExecution';
import {
  coachAiExecutionApi,
  isMockMode,
  _setMockModeForTesting,
} from '../coachAiExecutionApi';

describe('coachAiExecution — display helpers', () => {
  describe('capabilityLabel', () => {
    it.each([
      ['draft.assign_workout', 'Workout suggestion'],
      ['draft.assign_meal_plan', 'Meal plan suggestion'],
      ['draft.send_notification', 'Check-in nudge'],
    ] as const)('%s → %s', (cap, label) => {
      expect(capabilityLabel(cap)).toBe(label);
    });
  });

  describe('isStream2Capability', () => {
    it('accepts the three Stream 2 capabilities', () => {
      expect(isStream2Capability('draft.assign_workout')).toBe(true);
      expect(isStream2Capability('draft.assign_meal_plan')).toBe(true);
      expect(isStream2Capability('draft.send_notification')).toBe(true);
    });

    it('rejects pre-Stream-2 capabilities so the inbox skips them', () => {
      expect(isStream2Capability('draft.coach_message')).toBe(false);
      expect(isStream2Capability('chat.client_self')).toBe(false);
      expect(isStream2Capability('')).toBe(false);
    });
  });

  describe('previewFor', () => {
    it('renders a workout suggestion with scheduled date + optional body', () => {
      const row: AiActionDraftRow = {
        id: 'd1',
        capability: 'draft.assign_workout',
        status: 'pending',
        tenant_coach_id: 'coach-1',
        subject_user_id: 'client-1',
        requester_id: 'coach-1',
        created_at: '2026-05-28T00:00:00Z',
        payload: {
          workoutPlanId: '11111111-1111-1111-1111-111111111111',
          clientId: 'client-1',
          scheduledFor: '2026-06-02T15:00:00Z',
          notificationBody: 'Ready for week one — start with a short warmup.',
        },
      };
      const p = previewFor(row);
      expect(p.startsWith('Workout · ')).toBe(true);
      expect(p).toContain('Ready for week one');
    });

    it('renders a meal plan suggestion with a date window', () => {
      const row: AiActionDraftRow = {
        id: 'd1',
        capability: 'draft.assign_meal_plan',
        status: 'pending',
        tenant_coach_id: 'coach-1',
        subject_user_id: 'client-1',
        requester_id: 'coach-1',
        created_at: '2026-05-28T00:00:00Z',
        payload: {
          dailyMealPlanId: '22222222-2222-2222-2222-222222222222',
          clientId: 'client-1',
          startsOn: '2026-06-01',
          endsOn: '2026-06-07',
        },
      };
      expect(previewFor(row)).toBe('Meal plan · 2026-06-01 → 2026-06-07');
    });

    it('renders a notification body, truncating long copy', () => {
      const row: AiActionDraftRow = {
        id: 'd1',
        capability: 'draft.send_notification',
        status: 'pending',
        tenant_coach_id: 'coach-1',
        subject_user_id: 'client-1',
        requester_id: 'coach-1',
        created_at: '2026-05-28T00:00:00Z',
        payload: {
          clientId: 'client-1',
          kind: 'coach_nudge',
          body: 'a '.repeat(100),
        },
      };
      const p = previewFor(row);
      expect(p.length).toBeLessThanOrEqual(121);
      expect(p.endsWith('…')).toBe(true);
    });

    it('returns empty string for unknown capabilities (the inbox filters them)', () => {
      const row: AiActionDraftRow = {
        id: 'd1',
        capability: 'draft.coach_message',
        status: 'pending',
        tenant_coach_id: 'coach-1',
        subject_user_id: 'client-1',
        requester_id: 'coach-1',
        created_at: '2026-05-28T00:00:00Z',
        payload: { body: 'Hello there.' },
      };
      expect(previewFor(row)).toBe('');
    });
  });
});

describe('coachAiExecutionApi — mock default + opt-in posture', () => {
  it('defaults to MOCK OFF when no env var is set (R1 audit fix P0-1)', () => {
    // Module-load-time evaluation: jest defines NODE_ENV='test' and
    // __DEV__ is undefined in the bare jest environment. The IIFE returns
    // 'off' under both branches. We assert via isMockMode().
    expect(isMockMode()).toBe(false);
  });
});

describe('coachAiExecutionApi — mock-mode behaviour', () => {
  beforeEach(() => {
    _setMockModeForTesting('on');
    coachAiExecutionApi._resetMockStore();
  });

  afterAll(() => {
    _setMockModeForTesting('off');
  });

  const baseAssignWorkout = {
    workoutPlanId: '11111111-1111-1111-1111-111111111111',
    clientId: 'client-1',
    scheduledFor: '2026-06-02T15:00:00Z',
    prompt: 'Strength block, no overhead press.',
  };

  const baseAssignMealPlan = {
    dailyMealPlanId: '22222222-2222-2222-2222-222222222222',
    clientId: 'client-1',
    startsOn: '2026-06-01',
    prompt: '180g protein, vegetarian.',
  };

  const baseSendNotification = {
    clientId: 'client-1',
    kind: 'coach_nudge',
    body: 'How is the new week going?',
    prompt: 'Friendly check-in for a slow week.',
  };

  it('invokeAssignWorkout returns the gateway response envelope', async () => {
    const result = await coachAiExecutionApi.invokeAssignWorkout(baseAssignWorkout);
    expect(result.approval.required).toBe(true);
    expect(result.approval.status).toBe('pending');
    expect(typeof result.approval.draft_id).toBe('string');
    expect(typeof result.request_id).toBe('string');
    expect(typeof result.audit_id).toBe('string');
  });

  it('invokeAssignMealPlan persists the structured payload', async () => {
    const result = await coachAiExecutionApi.invokeAssignMealPlan({
      ...baseAssignMealPlan,
      endsOn: '2026-06-07',
    });
    const list = await coachAiExecutionApi.listPending();
    const draft = list.drafts.find((d) => d.id === result.approval.draft_id);
    expect(draft?.capability).toBe('draft.assign_meal_plan');
    expect(draft?.payload).toMatchObject({
      dailyMealPlanId: baseAssignMealPlan.dailyMealPlanId,
      clientId: baseAssignMealPlan.clientId,
      startsOn: baseAssignMealPlan.startsOn,
      endsOn: '2026-06-07',
    });
  });

  it('listPending surfaces every invoked draft in newest-first order', async () => {
    const r1 = await coachAiExecutionApi.invokeAssignWorkout(baseAssignWorkout);
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await coachAiExecutionApi.invokeAssignMealPlan(baseAssignMealPlan);
    const list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(2);
    expect(list.drafts[0].id).toBe(r2.approval.draft_id);
    expect(list.drafts[1].id).toBe(r1.approval.draft_id);
  });

  it('listPending filters by clientId when supplied', async () => {
    await coachAiExecutionApi.invokeAssignWorkout(baseAssignWorkout);
    await coachAiExecutionApi.invokeSendNotification({
      ...baseSendNotification,
      clientId: 'client-2',
    });
    const onlyClient1 = await coachAiExecutionApi.listPending({ clientId: 'client-1' });
    expect(onlyClient1.drafts).toHaveLength(1);
    expect(onlyClient1.drafts[0].subject_user_id).toBe('client-1');
  });

  it('approveDraft removes the row from pending + sets materialised_ref', async () => {
    const { approval } = await coachAiExecutionApi.invokeSendNotification(
      baseSendNotification,
    );
    const draftId = approval.draft_id!;
    let list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(1);

    const approve = await coachAiExecutionApi.approveDraft(draftId);
    expect(approve.status).toBe('approved');
    expect(approve.materialised_ref).toMatch(/^mock-materialised-/);

    list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(0);
  });

  it('rejectDraft removes the row + accepts an optional reason note', async () => {
    const { approval } = await coachAiExecutionApi.invokeSendNotification(
      baseSendNotification,
    );
    const draftId = approval.draft_id!;
    const reject = await coachAiExecutionApi.rejectDraft(draftId, 'Wrong tone.');
    expect(reject.status).toBe('rejected');
    expect(reject.decision_note).toBe('Wrong tone.');

    const list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(0);
  });

  it('rejectDraft accepts no note (audit field stays null)', async () => {
    const { approval } = await coachAiExecutionApi.invokeSendNotification(
      baseSendNotification,
    );
    const reject = await coachAiExecutionApi.rejectDraft(approval.draft_id!);
    expect(reject.status).toBe('rejected');
    expect(reject.decision_note).toBeNull();
  });

  it('approveDraft on a non-existent id throws (mock surfaces a clear error)', async () => {
    await expect(coachAiExecutionApi.approveDraft('does-not-exist')).rejects.toThrow();
  });

  it('_resetMockStore clears the in-memory backing', async () => {
    await coachAiExecutionApi.invokeAssignWorkout(baseAssignWorkout);
    expect((await coachAiExecutionApi.listPending()).drafts).toHaveLength(1);
    coachAiExecutionApi._resetMockStore();
    expect((await coachAiExecutionApi.listPending()).drafts).toHaveLength(0);
  });
});
