/**
 * Coach consultation (prototype 77-85, K0-K8): the answers a new coach gives
 * and the shape the flow, the local draft and the server share. Wire keys and
 * vocabularies match the backend contract (COACH-CONSULT-BE-134, /coach/consultation).
 */

export type CoachStepId = 'K0' | 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | 'K7' | 'K8';

export type Specialty =
  | 'fat_loss'
  | 'strength'
  | 'muscle'
  | 'beginners'
  | 'older'
  | 'sports'
  | 'mobility'
  | 'nutrition'
  | 'busy'
  | 'other';

export type ClientsToday = 'none' | '1_10' | '11_25' | '26_50' | '50_plus';
export type CoachingTouch = 'close' | 'balanced' | 'light';
export type ProgrammingStyle = 'own' | 'templates' | 'help';

export interface CoachConsultAnswers {
  /** K1, required at completion, trimmed 1-80. */
  display_name?: string;
  /** K1, optional, 0-80. */
  business_name?: string;
  /** K1 "how do you help people", optional, 0-280. */
  bio?: string;
  /** K2, optional, up to five. */
  specialties?: Specialty[];
  /** K3, required; gates K7 (only when not 'none'). */
  clients_today?: ClientsToday;
  /** K4, optional. */
  coaching_touch?: CoachingTouch;
  /** K5, optional. */
  programming_style?: ProgrammingStyle;
  /** K6: copied or shared on this phone. Local only, never sent. */
  link_shared?: boolean;
  /** K7 (importer flag on only). Local only, never sent. */
  import_choice?: 'show_me' | 'later';
}

/** The chapter bar: five chapters, K4 and K5 share chapter 4. */
export interface CoachProgress {
  chapter: 1 | 2 | 3 | 4 | 5;
  position: number;
  count: number;
  total: 5;
}

export interface OptionItem<T extends string> {
  value: T;
  label: string;
  sub?: string;
}
