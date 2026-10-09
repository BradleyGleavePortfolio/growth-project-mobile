/**
 * K5-K8 (COACH-CONSULT-M2-134) for the step registry: `STEP_COMPONENTS` in
 * ../registry.ts spreads this map (`...PRACTICE_STEPS`), so the flow shows
 * K5 Programming style, K6 Your personal link, K7 Import offer (importer
 * flag on and clients today only) and K8 Practice ready.
 */
import type { StepRegistry } from '../registry';
import K5ProgrammingStyle from './K5ProgrammingStyle';
import K6PersonalLink from './K6PersonalLink';
import K7ImportOffer from './K7ImportOffer';
import K8PracticeReady from './K8PracticeReady';

export const PRACTICE_STEPS: StepRegistry = {
  K5: K5ProgrammingStyle,
  K6: K6PersonalLink,
  K7: K7ImportOffer,
  K8: K8PracticeReady,
};
