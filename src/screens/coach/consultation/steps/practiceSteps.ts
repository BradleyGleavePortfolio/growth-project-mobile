/** K5-K8 for the step registry: ../registry.ts spreads this map into STEP_COMPONENTS after K4. */
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
