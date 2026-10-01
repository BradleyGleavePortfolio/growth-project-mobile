/**
 * Consultation engine types.
 *
 * Every consultation screen is described as data (`ScreenDef`): its id,
 * chapter, template, copy, options, validation and visibility conditions.
 * The renderer (`src/screens/consultation`) and the pure engine
 * (`./engine.ts`) both read these definitions, so adding, removing or
 * re-ordering a question is a data change, not a navigation change.
 */

/** Template ids. Names follow the approved prototype (T-A .. T-E). */
export type TemplateId =
  | 'intro' // T-A: Roman welcome, no progress bar
  | 'rows' // T-B: single-select rows, auto-advance
  | 'chips' // T-C: chips, single or multi select
  | 'dob' // T-D: date of birth wheels
  | 'measure' // T-D: height and weight wheels with unit tabs
  | 'goalWeight' // T-D: optional goal weight wheel
  | 'yesno' // T-E: yes / no with an optional detail block on yes
  | 'consent' // P0: the single "I agree" box
  | 'message'; // P8: Roman message, never blocks

/** Chapter numbers. 0 is the welcome; 1-8 carry the progress bar. */
export type ChapterId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface OptionDef {
  value: string;
  label: string;
  sub?: string;
  /** Rows only: selecting this option does not auto-advance. */
  noAutoAdvance?: boolean;
}

/** Visibility conditions. Pure data, evaluated by `evaluateCondition`. */
export type Condition =
  | { key: string; equals: string }
  | { key: string; notEquals: string }
  | { key: string; includes: string }
  | { all: Condition[] }
  | { any: Condition[] };

export interface ValidationRule {
  /** The primary answer must be present (non-empty). */
  required?: boolean;
  /** Multi-select lower bound (when present). */
  minSelections?: number;
  /** Multi-select upper bound (the cap, "Up to three."). */
  maxSelections?: number;
  /** Date of birth: inclusive age range in whole years. */
  ageRange?: { min: number; max: number };
  /** Text detail max length (other / notes). */
  detailMaxLength?: number;
}

/** A detail block revealed on the same screen by an answer (T3 yes, P yes, other). */
export interface DetailDef {
  /** Shown when the primary answer satisfies this condition. */
  when: Condition;
  /** Optional chips block (e.g. T3 injury areas). */
  chipsKey?: string;
  chipsLabel?: string;
  chipsOptions?: OptionDef[];
  /** Chips block needs at least one selection when shown. */
  chipsRequired?: boolean;
  /** Optional free-text field. */
  textKey?: string;
  textLabel?: string;
  textMaxLength?: number;
  textMultiline?: boolean;
}

export interface ScreenDef {
  id: string;
  chapter: ChapterId;
  template: TemplateId;
  /** Answer key written by the primary control. Defaults to `id`. */
  answerKey?: string;
  eyebrow?: string;
  /** Roman's chapter line, shown with his face above the question. */
  roman?: string;
  question: string;
  /** Smaller question style for long questions (T3, P1-P7). */
  longQuestion?: boolean;
  sub?: string;
  why?: string;
  /** "About 3 minutes left" caption, from chapter 5 on. */
  timeLeft?: string;
  options?: OptionDef[];
  /** Options computed at render time from the clock (C1). */
  dynamicOptions?: 'firstSessionDays';
  /** Default value applied when the screen is first shown (C1). */
  defaultValue?: 'tomorrow';
  /** Chips: single select. */
  single?: boolean;
  /** Chips: this option clears every other selection. */
  exclusive?: string;
  /** Chips: large numeral chips. */
  big?: boolean;
  /** Single-select auto-advance after a tap (rows and single chips). */
  autoAdvance?: boolean;
  /** Optional screens show "Skip". */
  skippable?: boolean;
  /** Custom skip label (B4 "No number, just the goal"). */
  skipLabel?: string;
  /** Safety chapter shows "Pause" instead of "Finish later". */
  pause?: boolean;
  /** Primary CTA label when a CTA is shown. */
  cta?: string;
  /** Screening question number (P1-P7) for "Question n of 7". */
  screeningIndex?: number;
  validation?: ValidationRule;
  detail?: DetailDef;
  /** Screen is shown only when this condition holds. */
  showWhen?: Condition;
}

/** A single answer value. Arrays for multi-select, objects for paired inputs. */
export type AnswerValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | MeasureAnswer
  | ConsentAnswer;

export interface MeasureAnswer {
  height_cm: number;
  weight_lbs: number;
  unit: 'imperial' | 'metric';
}

export interface ConsentAnswer {
  agreed: true;
  copy_version: string;
  agreed_at: string;
}

export type Answers = Record<string, AnswerValue | undefined>;

export interface ValidationResult {
  valid: boolean;
  /** Calm, user-facing reason. Never shown for an untouched optional screen. */
  message?: string;
}

export interface ChapterProgress {
  chapter: ChapterId;
  /** 1-based position of the screen inside its chapter (visible screens only). */
  position: number;
  /** Visible screens in the chapter. */
  count: number;
  /** Chapters 1-8 shown by the progress bar. */
  totalChapters: number;
}
