/**
 * Which component renders each coach consultation step. A step that is not
 * listed is skipped by the flow (lib/coachConsultation/flow), so the
 * consultation always runs end to end. K5-K8: COACH-CONSULT-M2-134.
 */
import type React from 'react';
import type { CoachStepId } from '../../../lib/coachConsultation/types';
import type { CoachStepProps } from './types';
import K0Welcome from './steps/K0Welcome';
import K1Card from './steps/K1Card';
import K2Specialties from './steps/K2Specialties';
import K3ClientsToday from './steps/K3ClientsToday';
import K4CoachingTouch from './steps/K4CoachingTouch';
import { PRACTICE_STEPS } from './steps/practiceSteps';

export type StepRegistry = Partial<Record<CoachStepId, React.ComponentType<CoachStepProps>>>;

export const STEP_COMPONENTS: StepRegistry = {
  K0: K0Welcome,
  K1: K1Card,
  K2: K2Specialties,
  K3: K3ClientsToday,
  K4: K4CoachingTouch,
  ...PRACTICE_STEPS, // K5-K8 (COACH-CONSULT-M2-134)
};
