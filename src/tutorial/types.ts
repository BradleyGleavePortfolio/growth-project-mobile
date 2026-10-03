/**
 * Client tutorial (C08 explanations + C09 Roman-led tour) — shared types.
 *
 * `OnboardingCompletePayload` mirrors the 200 body of
 * `POST /api/me/onboarding/complete` (and the `complete` block of
 * `GET /api/me/onboarding`) from the clinic onboarding contract v1. Every
 * field is treated as optional at runtime: the tutorial must never crash or
 * invent numbers when the server omits something. Missing data marks the
 * dependent step `pending` (resumable) instead.
 */

export interface OnboardingMacros {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  method?: string;
  floor_applied?: boolean;
}

export interface OnboardingProgram {
  id: string;
  name: string;
  days_per_week?: number;
  weeks?: number;
  /** Up to three short reasons tied to the client's answers. */
  why?: string[];
}

export interface OnboardingSpace {
  id: string;
  name: string;
}

export interface OnboardingCoach {
  id: string;
  display_name: string;
}

export interface OnboardingCompletePayload {
  macros?: OnboardingMacros | null;
  program?: OnboardingProgram | null;
  spaces?: OnboardingSpace[] | null;
  coach?: OnboardingCoach | null;
}

/** The nine steps, in the owner-mandated order. */
export type TutorialStepId =
  | 'welcome'
  | 'plan'
  | 'macros'
  | 'community'
  | 'coach_messages'
  | 'calendar'
  | 'wearables'
  | 'first_meal'
  | 'first_message'
  | 'welcome_call'
  | 'complete';

/**
 * How a step ended.
 *  - done:        every gate satisfied by a real action.
 *  - deferred:    the client explicitly chose "Later" (wearables only).
 *  - pending:     data the step explains is not ready yet (no plan / no
 *                 macros); resumable once it lands.
 *  - unavailable: the surface is not in this build (community tab flag off).
 */
export type TutorialStepOutcome = 'done' | 'deferred' | 'pending' | 'unavailable';

export type TutorialStatus = 'not_started' | 'active' | 'paused' | 'completed';

export interface TutorialState {
  version: 1;
  status: TutorialStatus;
  stepIndex: number;
  gateIndex: number;
  outcomes: Partial<Record<TutorialStepId, TutorialStepOutcome>>;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

/** Real-world signals the app emits; the machine only advances on these. */
export type TutorialSignal =
  | 'plan_card_opened'
  | 'macro_card_opened'
  | 'meal_logged'
  | 'message_sent'
  | 'wearable_connected'
  | 'welcome_call_booked';

/** What the step machine knows about the world when it enters a step. */
export interface TutorialContext {
  hasProgram: boolean;
  hasMacros: boolean;
  communityAvailable: boolean;
  /** S-SCHED: featureFlags.clientCalendar. Absent means off. */
  calendarAvailable?: boolean;
}
