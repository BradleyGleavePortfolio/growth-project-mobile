/**
 * TOUR-133 (decision 133-5): Calendar is no longer a tour step. With
 * featureFlags.clientCalendar ON the step list is unchanged, and
 * the completion folds Calendar in (with the welcome call for a coached
 * client), so the S-SCHED owner decision of 2026-10-01 still reaches the
 * client without a step of its own.
 */
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return { ...actual, featureFlags: { ...actual.featureFlags, clientCalendar: true, clientTutorial: true } };
});

import { TUTORIAL_STEPS } from '../tutorialSteps';
import { __resetTutorialStoreForTests, buildCopyContext, hydrateTutorial, useTutorialStore } from '../tutorialStore';

afterEach(() => __resetTutorialStoreForTests());

describe('clientCalendar on', () => {
  it('has no Calendar or welcome call step', () => {
    const ids: string[] = TUTORIAL_STEPS.map((s) => s.id);
    expect(ids).not.toContain('calendar');
    expect(ids).not.toContain('welcome_call');
  });

  it('the completion names Calendar and the welcome call with the real coach', async () => {
    await hydrateTutorial('u1', 'Maya', true);
    useTutorialStore.setState({ payload: { coach: { id: 'c1', display_name: 'Ana' } } });
    const ctx = buildCopyContext(useTutorialStore.getState(), 'full');
    expect(ctx.calendarAvailable).toBe(true);
    const sub = TUTORIAL_STEPS.find((s) => s.id === 'complete')!.gates[0].sub!(ctx);
    expect(sub).toContain('Calendar');
    expect(sub).toContain('Book your welcome call with Ana from Calendar when it suits you.');
  });
});
