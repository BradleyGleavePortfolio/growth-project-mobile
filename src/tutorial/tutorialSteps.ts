/**
 * tutorialSteps — the Roman-led tour, declared as data.
 *
 * Calendar, Community and connected devices are no longer steps: the
 * completion names them in one quiet paragraph (TOUR-133, decision 133-5).
 *
 * Each step is a sequence of gates. A gate is one of:
 *   - ack:    a single explicit button (only the welcome, two "this is where
 *             it lives" beats after a real navigation, and the completion).
 *   - route:  satisfied when the real navigator focuses one of `routes`.
 *   - signal: satisfied when the real product emits `signal` (see
 *             tutorialEvents.ts). `allowDefer` adds an explicit "Later".
 *
 * Copy is Roman's butler voice (AI_BUTLER_ROMAN_IDENTITY_SPEC §1): short,
 * complete sentences, no contractions, no exclamation points, no emoji, no
 * em dashes, no hype. The coach and client names and every number come from
 * the onboarding complete payload or the live macro endpoint; nothing is
 * invented. Steps about a coach run only when a coach is linked, and the
 * closing line repeats only what this tour really did.
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
  | 'macro-card'
  | 'home-message-coach'
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
  allowDefer?: boolean;
  /** Spoken hint on the Later button. */
  deferHint?: string;
}

export type TutorialGate = AckGate | RouteGate | SignalGate;

export type StepRequirement = 'program' | 'macros' | 'coach';

export interface TutorialStepDef {
  id: TutorialStepId;
  /** Short accessible title, used by the progress indicator. */
  title: string;
  /** Every requirement must hold, or the step is skipped (see tutorialMachine). */
  requires?: StepRequirement | readonly StepRequirement[];
  gates: TutorialGate[];
  /** Roman's line on completion (shown with the check glyph). */
  doneLine?: Line;
  /** Shown instead of the step when its data is not ready yet. */
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

function macroLine(c: CopyContext): string {
  const m = c.macros;
  if (!m) return 'Tap How to use these numbers.';
  if (c.macroMode === 'simple') {
    return `This first week keeps it to two numbers: ${n(m.calories)} calories and ${n(m.protein_g)} grams of protein. Carbohydrate and fat are already worked out for you, and they will join these on Home when the week is done. Tap How to use these numbers.`;
  }
  return `Each day: ${n(m.calories)} calories, ${n(m.protein_g)} grams of protein, ${n(m.carbs_g)} grams of carbohydrate and ${n(m.fat_g)} grams of fat. Tap How to use these numbers.`;
}

/** No coach linked: no coach is named and only the meal is the client's turn. */
function welcomeLine(c: CopyContext): string {
  const hello = c.firstName ? `Welcome, ${c.firstName}. ` : 'Welcome. ';
  if (!c.coachLinked) {
    return `${hello}I am Roman. This takes a few minutes. I will show you where everything lives, and then you will log your first meal yourself.`;
  }
  return `${hello}I am Roman. I work with ${c.coachName} to help you get the most from ${c.program ? 'your plan' : 'your training'}. This takes about three minutes. I will show you where everything lives, and then you will try two things yourself.`;
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

function planSummary(c: CopyContext): string {
  const p = c.program;
  if (!p) return '';
  const parts: string[] = [];
  if (p.weeks) parts.push(`${p.weeks} weeks`);
  if (p.days_per_week) parts.push(`${p.days_per_week} days a week`);
  return parts.length ? `${p.name}: ${parts.join(', ')}.` : `${p.name}.`;
}

export const TUTORIAL_STEPS: readonly TutorialStepDef[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    gates: [
      {
        kind: 'ack',
        center: true,
        cta: 'Begin',
        line: welcomeLine,
      },
    ],
  },
  {
    id: 'plan',
    title: 'Your workout plan',
    requires: 'program',
    gates: [
      {
        kind: 'route',
        routes: ['WorkoutMain'],
        target: 'tab:WorkoutTab',
        line: (c) =>
          `This is Train. ${c.coachName} has assigned you ${c.program?.name ?? 'your plan'}. Tap Train to see it.`,
      },
      {
        kind: 'signal',
        signal: 'plan_card_opened',
        target: 'plan-card',
        line: (c) =>
          `${planSummary(c)} Tap Why this plan to see how it follows from your answers.`,
      },
    ],
    doneLine: () => 'Your plan stays pinned here on Train.',
    pendingLine: (c) =>
      `${c.coachName} is still setting up your first plan. It will appear on Train once it is ready. For now, the tour carries on.`,
  },
  {
    id: 'macros',
    title: 'Your daily targets',
    requires: 'macros',
    gates: [
      {
        kind: 'route',
        routes: ['HomeMain'],
        target: 'tab:Home',
        line: () => 'Your daily numbers live on Home. Tap Home.',
      },
      {
        kind: 'signal',
        signal: 'macro_card_opened',
        target: 'macro-card',
        line: macroLine,
      },
    ],
    doneLine: () => 'You know your numbers now. They stay pinned on Home.',
    pendingLine: (c) =>
      `${c.coachName} is finishing your numbers. They will appear on Home once they are ready.`,
  },
  {
    id: 'first_meal',
    title: 'Log your first meal',
    gates: [
      {
        kind: 'route',
        routes: ['Log'],
        target: 'tab:Log',
        line: () => 'Now it is your turn. Tap Log.',
      },
      {
        kind: 'signal',
        signal: 'meal_logged',
        line: () =>
          'Tap Add Food under any meal, choose one thing you have eaten today, and save it.',
      },
    ],
    doneLine: () => 'Recorded. This is the habit that matters most, day to day.',
  },
  {
    id: 'first_message',
    title: 'Message your coach',
    requires: 'coach',
    gates: [
      {
        kind: 'route',
        routes: ['Messages'],
        target: 'home-message-coach',
        takeMeThere: { tab: 'Home', screen: 'Messages' },
        line: (c) => `Last one. Open your conversation with ${c.coachName}.`,
      },
      {
        kind: 'signal',
        signal: 'message_sent',
        line: (c) =>
          `Write ${c.coachName} a short hello, or one thing about your goal, and tap send. Nothing sends until you do.`,
      },
    ],
    doneLine: (c) => `Sent. ${c.coachName} will see it in your conversation.`,
  },
  {
    id: 'complete',
    title: 'Complete',
    gates: [
      {
        kind: 'ack',
        center: true,
        cta: 'Done',
        line: completeLine,
        sub: completeSub,
      },
    ],
  },
];

/** Steps shown in the progress indicator (the completion moment is not one). */
export const COUNTED_STEPS = TUTORIAL_STEPS.filter((s) => s.id !== 'complete');

export function stepIndexOf(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((s) => s.id === id);
}
