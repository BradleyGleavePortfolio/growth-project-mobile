/**
 * The consultation hand-off (#310) and the tour agree: ConsultationFlow.finish
 * calls startClientTutorial(result) with the POST /me/onboarding/complete body
 * after "Show me around", and the tour speaks that result's coach, plan and
 * numbers (TOUR-133).
 */
jest.mock('../../config/featureFlags', () => {
  const actual = jest.requireActual('../../config/featureFlags');
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, clientCalendar: true, clientTutorial: true },
  };
});

import type { CompleteOnboardingResponse } from '../../api/consultationApi';
import { TUTORIAL_STEPS } from '../tutorialSteps';
import {
  __resetTutorialStoreForTests,
  buildCopyContext,
  hydrateTutorial,
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

describe('consultation (#310) -> tour', () => {
  it('startClientTutorial(result) starts on the welcome and names the consultation coach and plan', async () => {
    await hydrateTutorial('u1', 'Maya', true);
    expect(startClientTutorial(RESULT)).toBe(true);
    const s = useTutorialStore.getState();
    expect(s.tutorial.status).toBe('active');
    const ctx = buildCopyContext(s, 'full');
    expect(ctx.coachName).toBe('Coach Kim');
    const plan = TUTORIAL_STEPS.find((st) => st.id === 'plan')!;
    expect(plan.gates[0].line(ctx)).toBe('This is Train. Coach Kim has assigned you Gentle start. Tap Train to see it.');
    expect(TUTORIAL_STEPS.find((st) => st.id === 'macros')!.gates[1].line(ctx)).toContain('2,100 calories');
  });
});
