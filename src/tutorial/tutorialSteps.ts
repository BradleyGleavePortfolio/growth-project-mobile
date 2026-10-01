/**
 * tutorialSteps — the nine-step Roman-led tour, declared as data.
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
 * invented. `tutorialCopy.test.ts` enforces the voice rules.
 */
import type {
  OnboardingMacros,
  OnboardingProgram,
  OnboardingSpace,
  TutorialSignal,
  TutorialStepId,
} from './types';

export type TutorialTargetId =
  | 'tab:Home'
  | 'tab:WorkoutTab'
  | 'tab:Log'
  | 'tab:MoreTab'
  | 'tab:CommunityTab'
  | 'plan-card'
  | 'macro-card'
  | 'home-message-coach'
  | 'more-connections'
  | 'more-health';

/** A cross-tab destination the overlay may offer as "Take me there". */
export interface TutorialNavTarget {
  tab: 'Home' | 'WorkoutTab' | 'Log' | 'MoreTab' | 'CommunityTab';
  screen?: string;
}

export interface CopyContext {
  firstName: string | null;
  coachName: string;
  program: OnboardingProgram | null;
  macros: OnboardingMacros | null;
  spaces: OnboardingSpace[];
  platform: 'ios' | 'android' | 'other';
}

type Line = (c: CopyContext) => string;

interface GateBase {
  line: Line;
  target?: TutorialTargetId;
  /** Centered card with no spotlight (welcome and completion). */
  center?: boolean;
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
}

export type TutorialGate = AckGate | RouteGate | SignalGate;

export type StepRequirement = 'program' | 'macros' | 'community';

export interface TutorialStepDef {
  id: TutorialStepId;
  /** Short accessible title, used by the progress indicator. */
  title: string;
  requires?: StepRequirement;
  gates: TutorialGate[];
  /** Roman's line on completion (shown with the check glyph). */
  doneLine?: Line;
  /** Shown instead of the step when its data is not ready yet. */
  pendingLine?: Line;
}

const n = (v: number): string => Math.round(v).toLocaleString('en-US');

export function wearableName(c: CopyContext): string {
  if (c.platform === 'ios') return 'Apple Health';
  if (c.platform === 'android') return 'Health Connect';
  return 'your health app';
}

function spacesSentence(c: CopyContext): string {
  const names = c.spaces.map((s) => s.name).filter(Boolean);
  if (names.length === 0) {
    return `You are in the community ${c.coachName} keeps for everyone training together.`;
  }
  if (names.length === 1) return `You are a member of ${names[0]}.`;
  const last = names[names.length - 1];
  return `You are a member of ${names.slice(0, -1).join(', ')} and ${last}.`;
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
        line: (c) =>
          `${c.firstName ? `Welcome, ${c.firstName}. ` : 'Welcome. '}I am Roman. I work with ${c.coachName} to help you get the most from your plan. This takes about three minutes. I will show you where everything lives, and then you will try two things yourself.`,
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
      `${c.coachName} is still setting up your first plan. I will let you know the moment it is ready. For now, we will carry on.`,
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
        line: (c) =>
          c.macros
            ? `Each day: ${n(c.macros.calories)} calories, ${n(c.macros.protein_g)} grams of protein, ${n(c.macros.carbs_g)} grams of carbohydrate and ${n(c.macros.fat_g)} grams of fat. Tap How to use these numbers.`
            : 'Tap How to use these numbers.',
      },
    ],
    doneLine: () => 'You know your numbers now. They stay pinned on Home.',
    pendingLine: (c) =>
      `${c.coachName} is finishing your numbers. I will let you know the moment they are ready.`,
  },
  {
    id: 'community',
    title: 'Community',
    requires: 'community',
    gates: [
      {
        kind: 'route',
        routes: ['CommunityTab'],
        target: 'tab:CommunityTab',
        line: (c) =>
          `This is Community, where the people training with ${c.coachName} talk. Tap Community.`,
      },
      {
        kind: 'ack',
        cta: 'Continue',
        line: (c) =>
          `${spacesSentence(c)} Post when you like and read when you prefer. ${c.coachName} is here too.`,
      },
    ],
    doneLine: () => 'Very good.',
  },
  {
    id: 'coach_messages',
    title: 'Messaging your coach',
    gates: [
      {
        kind: 'route',
        routes: ['Messages'],
        target: 'home-message-coach',
        takeMeThere: { tab: 'Home', screen: 'Messages' },
        line: (c) =>
          `To reach ${c.coachName} directly, go to Home and tap Message your coach. This is a real person, not me.`,
      },
      {
        kind: 'ack',
        cta: 'Continue',
        line: (c) =>
          `This is your conversation with ${c.coachName}. Ask about your plan, your schedule, or anything in the way. You will send your first note at the end of the tour.`,
      },
    ],
    doneLine: () => 'Noted.',
  },
  {
    id: 'wearables',
    title: 'Wearables, health and sleep',
    gates: [
      {
        kind: 'route',
        routes: ['Connections'],
        target: 'more-connections',
        takeMeThere: { tab: 'MoreTab', screen: 'Connections' },
        line: (c) =>
          `Your phone or watch can share steps, heart rate and sleep through ${wearableName(c)}. Open Profile and more, then Connected devices.`,
      },
      {
        kind: 'signal',
        signal: 'wearable_connected',
        allowDefer: true,
        line: (c) =>
          `Choose ${wearableName(c)} and allow access. If you would rather do this later, tap Later. Nothing is lost.`,
      },
      {
        kind: 'route',
        routes: ['Health'],
        target: 'more-health',
        takeMeThere: { tab: 'MoreTab', screen: 'Health' },
        line: () =>
          'Your health and sleep data live in one place. Open Profile and more, then Health and sleep.',
      },
      {
        kind: 'ack',
        cta: 'Continue',
        line: () =>
          'Fitness holds your steps and activity. Recovery holds your sleep. It fills in once a device is connected.',
      },
    ],
    doneLine: () => 'That is where to look.',
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
          'Add one thing you have eaten or drunk today, and save it. A glass of water counts.',
      },
    ],
    doneLine: () => 'Recorded. This is the habit that matters most, day to day.',
  },
  {
    id: 'first_message',
    title: 'Message your coach',
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
    doneLine: (c) => `Sent. ${c.coachName} will reply soon.`,
  },
  {
    id: 'complete',
    title: 'Complete',
    gates: [
      {
        kind: 'ack',
        center: true,
        cta: 'Done',
        line: (c) =>
          `That is everything${c.firstName ? `, ${c.firstName}` : ''}. Your plan is set, your numbers are set, and ${c.coachName} has your message. One thing at a time. Consistency matters more than perfection.`,
      },
    ],
  },
];

/** Steps shown in the progress indicator (the completion moment is not one). */
export const COUNTED_STEPS = TUTORIAL_STEPS.filter((s) => s.id !== 'complete');

export function stepIndexOf(id: TutorialStepId): number {
  return TUTORIAL_STEPS.findIndex((s) => s.id === id);
}
