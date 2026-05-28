/**
 * coachAiExecutionApi — contract + mock-mode behaviour tests.
 *
 * Two layers under test:
 *   1. The pure helper exports from `types/coachAiExecution`
 *      (`capabilityLabel`, `previewFor`) — display logic the inbox
 *      + sheet rely on.
 *   2. The mock-mode behaviour of the API client. When backend Stream 2
 *      has not merged, the mock IS the wire contract; these tests pin
 *      its shape so a future swap to the real network is a one-flag
 *      change rather than a surprise.
 *
 * Doctrine-clean: no banned tokens in testIDs or assertion strings.
 */

import {
  capabilityLabel,
  previewFor,
  type AssignMealPlanPayload,
  type AssignWorkoutPayload,
  type ClientMessagePayload,
  type CoachAiDraft,
  type SendNotificationPayload,
} from '../types/coachAiExecution';
import { coachAiExecutionApi, _setMockModeForTesting } from '../coachAiExecutionApi';

describe('coachAiExecution — display helpers', () => {
  describe('capabilityLabel', () => {
    it.each([
      ['draft.client_message', 'Message draft'],
      ['draft.assign_workout', 'Workout suggestion'],
      ['draft.assign_meal_plan', 'Meal plan suggestion'],
      ['draft.send_notification', 'Check-in nudge'],
    ] as const)('%s → %s', (cap, label) => {
      expect(capabilityLabel(cap)).toBe(label);
    });
  });

  describe('previewFor', () => {
    it('message preview truncates long bodies at a word boundary', () => {
      const draft: CoachAiDraft = {
        id: 'd1',
        capability: 'draft.client_message',
        status: 'pending',
        tenantCoachId: 'coach-1',
        subjectClientId: 'client-1',
        subjectClientName: 'Sarah',
        createdAt: '2026-05-28T00:00:00Z',
        payload: {
          clientId: 'client-1',
          body: 'a '.repeat(200), // 400 chars
        } satisfies ClientMessagePayload,
      };
      const p = previewFor(draft);
      expect(p.length).toBeLessThanOrEqual(121); // 120 + ellipsis
      expect(p.endsWith('…')).toBe(true);
    });

    it('workout preview composes name + weeks + day-1 exercises', () => {
      const draft: CoachAiDraft = {
        id: 'd1',
        capability: 'draft.assign_workout',
        status: 'pending',
        tenantCoachId: 'coach-1',
        subjectClientId: 'client-1',
        subjectClientName: 'Sarah',
        createdAt: '2026-05-28T00:00:00Z',
        payload: {
          clientId: 'client-1',
          workoutName: 'Spring Strength',
          weekCount: 4,
          day1ExerciseCount: 6,
        } satisfies AssignWorkoutPayload,
      };
      expect(previewFor(draft)).toBe('Spring Strength — 4w, day 1 has 6 exercises');
    });

    it('meal plan preview composes name + days + macros', () => {
      const draft: CoachAiDraft = {
        id: 'd1',
        capability: 'draft.assign_meal_plan',
        status: 'pending',
        tenantCoachId: 'coach-1',
        subjectClientId: 'client-1',
        subjectClientName: 'Sarah',
        createdAt: '2026-05-28T00:00:00Z',
        payload: {
          clientId: 'client-1',
          planName: 'High-protein week',
          dayCount: 7,
          macroSummary: '180p / 220c / 70f',
        } satisfies AssignMealPlanPayload,
      };
      expect(previewFor(draft)).toBe('High-protein week — 7d, 180p / 220c / 70f');
    });

    it('notification preview composes title + truncated body', () => {
      const draft: CoachAiDraft = {
        id: 'd1',
        capability: 'draft.send_notification',
        status: 'pending',
        tenantCoachId: 'coach-1',
        subjectClientId: 'client-1',
        subjectClientName: 'Sarah',
        createdAt: '2026-05-28T00:00:00Z',
        payload: {
          clientId: 'client-1',
          title: 'Quick check-in',
          body: 'a '.repeat(100), // 200 chars
        } satisfies SendNotificationPayload,
      };
      const p = previewFor(draft);
      expect(p.startsWith('Quick check-in — ')).toBe(true);
      expect(p.endsWith('…')).toBe(true);
    });
  });
});

describe('coachAiExecutionApi — mock-mode behaviour', () => {
  beforeEach(() => {
    _setMockModeForTesting('on');
    coachAiExecutionApi._resetMockStore();
  });

  it('invokeClientMessage returns a pending draftId and the matching capability', async () => {
    const result = await coachAiExecutionApi.invokeClientMessage(
      { clientId: 'client-1', prompt: 'Ask Sarah how this week went.' },
      'Sarah',
    );
    expect(result.status).toBe('pending');
    expect(result.capability).toBe('draft.client_message');
    expect(typeof result.draftId).toBe('string');
    expect(result.draftId.length).toBeGreaterThan(0);
  });

  it('listPending surfaces every invoked draft in newest-first order', async () => {
    const r1 = await coachAiExecutionApi.invokeAssignWorkout(
      { clientId: 'client-1', prompt: 'Strength block, no overhead press.' },
      'Sarah',
    );
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await coachAiExecutionApi.invokeAssignMealPlan(
      { clientId: 'client-1', prompt: '180g protein, vegetarian.' },
      'Sarah',
    );
    const list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(2);
    // Newest first.
    expect(list.drafts[0].id).toBe(r2.draftId);
    expect(list.drafts[1].id).toBe(r1.draftId);
    // Discriminated union narrowed correctly.
    expect(list.drafts[0].capability).toBe('draft.assign_meal_plan');
    expect(list.drafts[1].capability).toBe('draft.assign_workout');
  });

  it('approveDraft removes the draft from the pending list', async () => {
    const { draftId } = await coachAiExecutionApi.invokeSendNotification(
      { clientId: 'client-1', prompt: 'Friendly check-in.' },
      'Sarah',
    );
    let list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(1);

    const approve = await coachAiExecutionApi.approveDraft(draftId);
    expect(approve.status).toBe('approved');
    expect(approve.materialisedRef).toMatch(/^mock-materialised-/);

    list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(0);
  });

  it('rejectDraft removes the draft from the pending list and accepts an optional reason', async () => {
    const { draftId } = await coachAiExecutionApi.invokeClientMessage(
      { clientId: 'client-1', prompt: 'Cancel reschedule.' },
      'Sarah',
    );
    const reject = await coachAiExecutionApi.rejectDraft(draftId, {
      reason: 'Wrong tone.',
    });
    expect(reject.status).toBe('rejected');

    const list = await coachAiExecutionApi.listPending();
    expect(list.drafts).toHaveLength(0);
  });

  it('rejectDraft accepts an empty body (no reason)', async () => {
    const { draftId } = await coachAiExecutionApi.invokeClientMessage(
      { clientId: 'client-1', prompt: 'Cancel reschedule.' },
      'Sarah',
    );
    const reject = await coachAiExecutionApi.rejectDraft(draftId);
    expect(reject.status).toBe('rejected');
  });

  it('approveDraft on a non-existent id throws', async () => {
    await expect(coachAiExecutionApi.approveDraft('does-not-exist')).rejects.toThrow();
  });

  it('_resetMockStore clears the in-memory backing', async () => {
    await coachAiExecutionApi.invokeAssignWorkout(
      { clientId: 'client-1', prompt: 'block 1' },
      'Sarah',
    );
    expect((await coachAiExecutionApi.listPending()).drafts).toHaveLength(1);
    coachAiExecutionApi._resetMockStore();
    expect((await coachAiExecutionApi.listPending()).drafts).toHaveLength(0);
  });
});
