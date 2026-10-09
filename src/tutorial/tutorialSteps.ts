/**
 * tutorialSteps — the Roman-led tour, declared as data (TOUR-133).
 *
 * Prototype 46-60 has seven beats: welcome, your plan on Train, the first
 * exercise, Food and its add control, the daily targets on Home, message
 * your coach, and the completion. They run on today's six tabs (owner 16:20:
 * our tabs and button counts stay). For a client without a coach, beat six
 * is the Roman beat instead (decision 28: nothing is locked, coaching is just
 * absent). Calendar, Community and connected devices are folded into the
 * completion line (decision 133-5 default).
 *
 * Each step is a sequence of gates. A gate is one of:
 *   - ack:    an explicit button (welcome, first exercise, Roman, completion).
 *   - route:  satisfied when the real navigator focuses one of `routes`.
 *   - signal: satisfied when the real product emits `signal` (see
 *             tutorialEvents.ts). `allowDefer` (any gate) adds an explicit
 *             "Later" that leaves the step.
 *
 * Copy is Roman's butler voice (AI_BUTLER_ROMAN_IDENTITY_SPEC §1): short,
 * complete sentences, no contractions, no exclamation points, no emoji, no
 * em dashes, no hype. The coach and client names and every number come from
 * the onboarding complete payload or the live macro endpoint; nothing is
 * invented, and the closing line repeats only what this tour really did.
 * `tutorialCopy.test.ts` enforces the voice rules; `tutorialTruth.test.tsx`
 * the state-driven lines.
 */
import type { MacroDisplayMode } from '../macros/macroDisplay';
import type {
  OnboardingMacros,
  OnboardingProgram,
  OnboardingSpace,
  TutorialSignal,
  TutorialStepId,
  TutorialStepOutcome,
} from './types';

export type TutorialTargetId =
  | 'tab:Home'
  | 'tab:WorkoutTab'
  | 'tab:Log'
  | 'tab:MoreTab'
  | 'tab:CommunityTab'
  | 'tab:CalendarTab'
  | 'plan-card'
  | 'first-exercise'
  | 'food-add'
  | 'macro-card'
  | 'home-message-coach'
  // MoreScreen still marks these rows; the tour no longer visits them.
  | 'more-connections'
  | 'more-health';

/** A cross-tab destination the overlay may offer as "Take me there". */
export interface TutorialNavTarget {
  tab: 'Home' | 'WorkoutTab' | 'Log' | 'MoreTab' | 'CommunityTab' | 'CalendarTab';
  screen?: string;
  params?: Record<string, unknown>;
}

export interface CopyContext {
  firstName: string | null;
  coachName: string;
  program: OnboardingProgram | null;
  macros: OnboardingMacros | null;
  spaces: OnboardingSpace[];
  platform: 'ios' | 'android' | 'other';
  /**
   * 'simple' while a never-tracker is in the lighter first week (contract v1
   * addition 8): Roman speaks calories and protein only and explains why.
   * Absent means 'full'.
   */
  macroMode?: MacroDisplayMode;
  /** A coach is linked to this client. Absent means no coach. */
  coachLinked?: boolean;
  /** The Calendar and Community tabs are in this build (completion line). */
  calendarAvailable?: boolean;
  communityAvailable?: boolean;
  /** How each step of this tour ended so far (the closing line reads it). */
  outcomes?: Partial<Record<TutorialStepId, TutorialStepOutcome>>;
}

type Line = (c: CopyContext) => string;

interface GateBase {
  line: Line;
  target?: TutorialTargetId;
  /** Centered card with no spotlight (welcome and completion). */
  center?: boolean;
  /** A quieter second paragraph (the completion card). */
  sub?: Line;
  /** An explicit "Later" that leaves the whole step (route or signal gates). */
  allowDefer?: boolean;
  /** Spoken hint on the Later button. */
  deferHint?: string;
}

export interface AckGate extends GateBase {
  kind: 'ack';
  cta: string;
}

export interface RouteGate extends GateBase {
  kind: 'route';
  routes: string[];
  takeMeThere?: TutorialNavTarget;
}

export interface SignalGate extends GateBase {
  kind: 'signal';
  signal: TutorialSignal;
}

export type TutorialGate = AckGate | RouteGate | SignalGate;

export type StepRequirement = 'program' | 'macros' | 'coach' | 'no_coach' | 'roman';

/** Beats in the progress indicator ("Step n of 7"), the completion included. */
export const TOUR_LENGTH = 7;

export interface TutorialStepDef {
  id: TutorialStepId;
  /** 1-based beat number shown as "Step n of 7" (both forms of beat 6 are 6). */
  ordinal: number;
  /** Short accessible title, used by the progress indicator. */
  title: string;
  /** Every requirement must hold, or the step is skipped (see tutorialMachine). */
  requires?: StepRequirement | readonly StepRequirement[];
  gates: TutorialGate[];
  /** Roman's line on completion (shown with the check glyph). */
  doneLine?: Line;
  /** Shown, with Continue, when the step's data is not ready yet (66). */
  pendingLine?: Line;
}

/** The requirements of a step as a list (none, one or several). */
export function stepRequirements(step: Pick<TutorialStepDef, 'requires'>): readonly StepRequirement[] {
  const r = step.requires;
  if (!r) return [];
  return typeof r === 'string' ? [r] : r;
}

const n = (v: number): string => Math.round(v).toLocaleString('en-US');

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function assigned(c: CopyContext): string {
  const name = c.program?.name ?? 'your plan';
  return c.coachLinked ? `${c.coachName} assigned you ${name}.` : `Your plan is ${name}.`;
}

function macroLine(c: CopyContext): string {
  const m = c.macros;
  const tail = 'Tap How to use these numbers any time for what each one means.';
  if (!m) return tail;
  const setBy = c.coachLinked ? `${c.coachName} set these for you.` : 'They come from your answers.';
  if (c.macroMode === 'simple') {
    return `This first week keeps it to two numbers: ${n(m.calories)} calories and ${n(m.protein_g)} grams of protein. Carbohydrate and fat are already worked out for you, and they will join these on Home when the week is done. ${tail}`;
  }
  return `Here are your daily numbers: ${n(m.calories)} calories, ${n(m.protein_g)} grams of protein, ${n(m.carbs_g)} grams of carbohydrate and ${n(m.fat_g)} grams of fat. ${setBy} ${tail}`;
}

/** No coach linked: no coach is named. */
function welcomeLine(c: CopyContext): string {
  const hello = c.firstName ? `Welcome, ${c.firstName}. ` : 'Welcome. ';
  const what = c.program ? 'your plan' : 'your training';
  const who = c.coachLinked ? `I work with ${c.coachName} to help you` : 'I am here to help you';
  return `${hello}I am Roman. ${who} get the most from ${what}. This takes about two minutes. I will show you where everything lives.`;
}

/** Each clause needs its step to have ended 'done' in this tour. */
function completeLine(c: CopyContext): string {
  const o = c.outcomes ?? {};
  const facts: string[] = [];
  if (o.plan === 'done') facts.push('your plan is set');
  if (o.macros === 'done') facts.push('your numbers are set');
  if (o.first_message === 'done') facts.push(`${c.coachName} has your message`);
  const said = joinAnd(facts);
  const summary = said ? ` ${said.charAt(0).toUpperCase()}${said.slice(1)}.` : '';
  return `That is everything${c.firstName ? `, ${c.firstName}` : ''}.${summary}`;
}

/** Calendar, Community and devices, folded in (decision 133-5). */
function completeSub(c: CopyContext): string {
  const tabs = [c.calendarAvailable ? 'Calendar' : '', c.communityAvailable ? 'Community' : ''].filter(Boolean);
  const where = tabs.length
    ? `${joinAnd(tabs)} ${tabs.length > 1 ? 'have their own tabs' : 'has its own tab'}, and connected devices live under You.`
    : 'Connected devices live under You.';
  const call =
    c.calendarAvailable && c.coachLinked ? ` Book your welcome call with ${c.coachName} from Calendar when it suits you.` : '';
  return `${where}${call} One thing at a time. You do not need to be perfect, just consistent.`;
}

/** The single push ask after the completion (prototype 61). */
export function pushPrimingLine(c: CopyContext): string {
  return c.coachLinked
    ? `Want a nudge when ${c.coachName} messages you, or when the day's workout is ready? I will only ask once.`
    : "Want a nudge when the day's workout is ready? I will only ask once.";
}

export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  {
    id: 'welcome',
    ordinal: 1,
    title: 'Welcome',
    gates: [{ kind: 'ack', center: true, cta: 'Begin', line: welcomeLine }],
  },
  {
    id: 'plan',
    ordinal: 2,
    title: 'Your plan',
    requires: 'program',
    gates: [
      {
        kind: 'route',
        routes: ['WorkoutMain'],
        target: 'tab:WorkoutTab',
        line: (c) => `This is Train. ${assigned(c)} Tap Train to see it.`,
      },
      {
        // Opened from the plan card's first day (the real assignment).
        kind: 'route',
        routes: ['WorkoutAssignmentDetail', 'ClientWorkoutViewer'],
        target: 'plan-card',
        line: (c) => `${assigned(c)} Tap your first day on the card to see it.`,
      },
    ],
    doneLine: (c) =>
      `This is your first day. Each move lists its sets, reps and a short cue${c.coachLinked ? ` from ${c.coachName}` : ''}.`,
    pendingLine: (c) =>
      `${c.coachLinked ? `${c.coachName} is still setting up your first plan.` : 'Your first plan is still being set up.'} It will appear on Train once it is ready. For now, the tour carries on with Food.`,
  },
  {
    id: 'first_exercise',
    ordinal: 3,
    title: 'Your first exercise',
    requires: 'program',
    gates: [
      {
        kind: 'ack',
        target: 'first-exercise',
        cta: 'Continue',
        line: () =>
          'Start with the first move. When you are ready to train, tap Start workout. There is no need to do that now.',
      },
    ],
  },
  {
    id: 'first_meal',
    ordinal: 4,
    title: 'Log your first meal',
    gates: [
      {
        kind: 'route',
        routes: ['Log'],
        target: 'tab:Log',
        line: () => 'This is Food. Log anything you have eaten today. One entry is enough to start. Tap Food.',
      },
      {
        kind: 'signal',
        signal: 'meal_logged',
        target: 'food-add',
        line: () => 'Tap Add food under any meal, choose one thing you have eaten today, and save it.',
      },
    ],
    doneLine: () => 'Logged. This is the single habit that matters most, day to day.',
  },
  {
    id: 'macros',
    ordinal: 5,
    title: 'Your daily targets',
    requires: 'macros',
    gates: [
      {
        kind: 'route',
        routes: ['HomeMain'],
        target: 'tab:Home',
        line: () => 'Your daily numbers live on Home. Tap Home.',
      },
      { kind: 'signal', signal: 'macro_card_opened', target: 'macro-card', line: macroLine },
    ],
    doneLine: () => 'You know your numbers now.',
    pendingLine: (c) =>
      `${c.coachLinked ? `${c.coachName} is finishing your numbers.` : 'Your numbers are still being worked out.'} They will appear on Home once they are ready.`,
  },
  {
    id: 'first_message',
    ordinal: 6,
    title: 'Message your coach',
    requires: 'coach',
    gates: [
      {
        kind: 'route',
        routes: ['Messages'],
        target: 'home-message-coach',
        takeMeThere: { tab: 'Home', screen: 'Messages' },
        // The most-skipped beat; skipping is fully allowed (Tutorial 4).
        allowDefer: true,
        deferHint: 'Message your coach another time from Home',
        line: (c) =>
          `This is where you talk with ${c.coachName} directly. A real person, not me. Tap Message your coach.`,
      },
      {
        // Freely skippable (prototype Tutorial 4): Later moves on.
        kind: 'signal',
        signal: 'message_sent',
        allowDefer: true,
        deferHint: 'Message your coach another time from Home',
        line: (c) =>
          `Send ${c.coachName} a quick hello, or one thing about your goal. Nothing sends until you tap send.`,
      },
    ],
    doneLine: (c) => `Sent. ${c.coachName} will see it in your conversation.`,
  },
  {
    // Beat six for a client without a coach (decision 28). Owner 10-09 00:0x
    // (m#651): Roman opens once the client joins a coach, so the line says
    // that instead of offering Roman now. Coached clients get first_message.
    id: 'roman',
    ordinal: 6,
    title: 'Roman with a coach',
    requires: ['no_coach', 'roman'],
    gates: [
      {
        kind: 'ack',
        target: 'tab:MoreTab',
        cta: 'Continue',
        line: () => ROMAN_BEAT_COACHLESS_LINE,
      },
    ],
  },
  {
    id: 'complete',
    ordinal: 7,
    title: 'Complete',
    gates: [{ kind: 'ack', center: true, cta: 'Got it', line: completeLine, sub: completeSub }],
  },
];

/** Beat six for a client with no coach: true after m#651 (Roman needs a coach). */
export const ROMAN_BEAT_COACHLESS_LINE =
  "I work from a coach's guidance, so I open once you join a coach. You will find me under You when you do.";

export function stepIndexOf(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((s) => s.id === id);
}
