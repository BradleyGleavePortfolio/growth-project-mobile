/**
 * The contract every coach consultation step builds against (K0-K8). The
 * flow (CoachConsultationFlow) owns order, saving and completion; a step only
 * renders, edits `answers` through `setAnswers` and calls `onNext`.
 */
import type { CoachConsultAnswers, CoachProgress } from '../../../lib/coachConsultation/types';

export interface CoachStepProps {
  answers: CoachConsultAnswers;
  /** Merge a patch into the answers; the flow writes the local draft. */
  setAnswers: (patch: Partial<CoachConsultAnswers>) => void;
  /** Next visible step; on the last step it completes the consultation. */
  onNext: () => void;
  /** Previous visible step; null on the first. */
  onBack: (() => void) | null;
  /** Save and pause (K1-K7). */
  onFinishLater: () => void;
  /** Chapter bar; null on K0 and K8. */
  progress: CoachProgress | null;
  /** "Your practice · 2 of 5", or "Your practice" when there is no bar. */
  eyebrow: string;
  /** The coach's first name ("" when unknown). */
  firstName: string;
  /** Completion in flight (the last step shows it on its button). A failed
   * completion is shown by the flow itself (problem screen with Try again). */
  completing: boolean;
}
