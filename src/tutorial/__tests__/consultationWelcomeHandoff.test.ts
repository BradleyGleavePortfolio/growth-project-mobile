/**
 * S-SCHED-4: the #310 consultation hand-off and the S-SCHED tour agree.
 * ConsultationFlow.finish calls startClientTutorial(result) with the
 * POST /me/onboarding/complete body; with clientCalendar on, that tour walks
 * Calendar after messaging the coach and ends with "Book your welcome call
 * with <coach>", which opens booking with the welcome type preselected. The
 * coach name comes from the consultation result.
 */
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, clientCalendar: true, clientTutorial: true },
  };
});

import type { CompleteOnboardingResponse } from '../../api/consultationApi';
import { TUTORIAL_STEPS, type SignalGate } from '../tutorialSteps';
import {
  __resetTutorialStoreForTests,
  buildCopyContext,
  startClientTutorial,
  useTutorialStore,
} from '../tutorialStore';

const RESULT: CompleteOnboardingResponse = {
  macros: { calories: 2100, protein_g: 150, carbs_g: 220, fat_g: 70, method: 'mifflin', floor_applied: false },
  program: { id: 'p1', name: 'Gentle start', days_per_week: 3, weeks: 4, why: [] },
  spaces: [],
  coach: { id: 'coach-1', display_name: 'Coach Kim' },
};

afterEach(() => __resetTutorialStoreForTests());

describe('consultation (#310) -> tour -> welcome call', () => {
  it('the tour has Calendar after coach_messages and ends with the welcome call before complete', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id);
    expect(ids.indexOf('calendar')).toBe(ids.indexOf('coach_messages') + 1);
    expect(ids.slice(-2)).toEqual(['welcome_call', 'complete']);
  });

  it('startClientTutorial(result) names the consultation coach in the welcome call action, which opens welcome booking', () => {
    expect(startClientTutorial(RESULT)).toBe(true);
    const ctx = buildCopyContext(useTutorialStore.getState(), 'full');
    expect(ctx.coachName).toBe('Coach Kim');
    const step = TUTORIAL_STEPS.find((s) => s.id === 'welcome_call');
    const gate = step?.gates[0] as SignalGate | undefined;
    expect(gate?.kind).toBe('signal');
    expect(gate?.allowDefer).toBe(true);
    expect(gate?.action?.label(ctx)).toBe('Book your welcome call with Coach Kim');
    expect(gate?.action?.target).toEqual({
      tab: 'CalendarTab',
      screen: 'CalendarBook',
      params: { welcome: true },
    });
  });
});
