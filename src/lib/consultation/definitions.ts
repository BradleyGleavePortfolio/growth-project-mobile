/**
 * Consultation screen definitions (consult-v1), as data.
 *
 * Copy is taken from the approved prototype (proto/js/screens-consult.js)
 * with the owner rulings applied: one "I agree" box at P0 (straight after
 * W1, before any answer is collected) that covers the training waiver and
 * data visibility, Roman sees every answer, and the P8
 * message gives general guidance and a safe next step before the physician
 * line. `{coach}` / `{Coach}` and `{first}` are filled at render time by
 * `fillCopy` so a missing coach name reads "your coach" / "Your coach".
 */
import type { ChapterId, ScreenDef } from './types';

export const CONSULTATION_VERSION = 'consult-v1' as const;

export const CHAPTER_NAMES: Record<ChapterId, string> = {
  0: 'Welcome',
  1: 'Goals',
  2: 'Body basics',
  3: 'Lifestyle',
  4: 'Training',
  5: 'Schedule',
  6: 'Nutrition',
  7: 'Safety',
  8: 'Commitment',
};

export const TOTAL_CHAPTERS = 8;

export function chapterEyebrow(ch: ChapterId): string {
  return `Chapter ${ch} of ${TOTAL_CHAPTERS} · ${CHAPTER_NAMES[ch]}`;
}

const YES_NO = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes', noAutoAdvance: true },
];

export const SCREENING_QUESTIONS: readonly string[] = [
  'Has a doctor ever told you that you have a heart condition, or that you should only do physical activity recommended by a doctor?',
  'Do you feel pain or discomfort in your chest during physical activity, or have you in the past month?',
  'Have you lost your balance because of dizziness, or lost consciousness, in the last 12 months?',
  'Do you have a bone, joint, or soft-tissue problem (for example, back, knee, hip, or shoulder) that could get worse with exercise?',
  'Is a doctor currently prescribing you medication for blood pressure or a heart condition?',
  'Are you currently pregnant, or have you given birth in the last 6 months?',
  'Is there any other reason, such as an injury, a surgery, or a chronic condition, that makes you concerned about starting an exercise program?',
];

export const SCREENING_KEYS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;

function screeningScreen(n: number): ScreenDef {
  const key = `P${n}`;
  return {
    id: key,
    chapter: 7,
    template: 'yesno',
    eyebrow: chapterEyebrow(7),
    sub: `Question ${n} of 7`,
    roman: n === 1 ? 'Last, a standard trainer screening. It keeps your start safe.' : undefined,
    question: SCREENING_QUESTIONS[n - 1],
    longQuestion: true,
    why: 'Standard trainer screening. Every answer leads to a plan that fits you.',
    timeLeft: n < 5 ? 'About 2 minutes left' : 'About 1 minute left',
    pause: true,
    options: YES_NO,
    autoAdvance: true,
    cta: 'Continue',
    screeningIndex: n,
    validation: { required: true, detailMaxLength: 280 },
    detail: {
      when: { key, equals: 'yes' },
      textKey: `${key}_note`,
      textLabel: 'Tell {coach} more (optional)',
      textMaxLength: 280,
      textMultiline: true,
    },
  };
}

export const SCREENS: readonly ScreenDef[] = [
  // ── Chapter 0 · Welcome ────────────────────────────────────────────────
  {
    id: 'W1',
    chapter: 0,
    template: 'intro',
    eyebrow: 'Your consultation',
    question: '{greeting},\n{first}.',
    roman:
      "I'm Roman. Before {coach} builds anything for you, I'd like to understand you properly, the way a good trainer would at a first consultation. It takes about five minutes. You can pause at any point, and I'll keep your place.",
    sub: "You'll leave with your daily targets and a plan built around your week.",
    timeLeft: 'About five minutes.',
    cta: 'Begin my consultation',
  },

  // P0, the single "I agree" box (owner ruling 16:31 #5, operator decision on
  // Sol A-02): it comes straight after the welcome, before any answer is
  // collected, so nothing is uploaded until it is ticked and recorded.
  {
    id: 'P0',
    chapter: 0,
    template: 'consent',
    eyebrow: 'Your consultation',
    question: 'Before we get started',
    longQuestion: true,
    cta: 'Continue',
    validation: { required: true },
  },

  // ── Chapter 1 · Goals ──────────────────────────────────────────────────
  {
    id: 'G1',
    chapter: 1,
    template: 'rows',
    eyebrow: chapterEyebrow(1),
    roman: "Let's start with what you want, and why it matters.",
    question: 'What would you most like from training right now?',
    why: 'Your goal sets the direction of your daily calories.',
    options: [
      { value: 'fat_loss', label: 'Lose body fat' },
      { value: 'muscle_gain', label: 'Build muscle and strength' },
      { value: 'maintenance', label: 'Maintain and feel better' },
      { value: 'performance', label: 'Train for a sport or event' },
    ],
    autoAdvance: true,
    validation: { required: true },
  },
  {
    id: 'G2',
    chapter: 1,
    template: 'chips',
    eyebrow: chapterEyebrow(1),
    question: 'And why does that matter to you?',
    sub: 'Choose up to three.',
    why: 'Your reasons help Roman and {coach} keep you going on harder days.',
    options: [
      { value: 'energy', label: 'More energy day to day' },
      { value: 'strength', label: 'Feel stronger' },
      { value: 'confidence', label: 'Feel confident in my body' },
      { value: 'family', label: 'Keep up with family' },
      { value: 'event', label: 'An event is coming up' },
      { value: 'longevity', label: 'Stay active for the long run' },
      { value: 'other', label: 'Something else' },
    ],
    skippable: true,
    cta: 'Continue',
    validation: { minSelections: 1, maxSelections: 3, detailMaxLength: 140 },
    detail: {
      when: { key: 'G2', includes: 'other' },
      textKey: 'G2_other',
      textLabel: 'In your words',
      textMaxLength: 140,
      textMultiline: true,
    },
  },

  // ── Chapter 2 · Body basics ────────────────────────────────────────────
  {
    id: 'B1',
    chapter: 2,
    template: 'rows',
    eyebrow: chapterEyebrow(2),
    roman: 'A few measurements, so your numbers are yours and not an average.',
    question: 'For your energy estimate, which formula should I use?',
    why: 'Resting energy differs by sex. This only changes the math.',
    options: [
      { value: 'female', label: 'Female' },
      { value: 'male', label: 'Male' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say' },
    ],
    autoAdvance: true,
    validation: { required: true },
  },
  {
    id: 'B2',
    chapter: 2,
    template: 'dob',
    eyebrow: chapterEyebrow(2),
    question: 'When were you born?',
    why: 'Energy needs change with age.',
    cta: 'Continue',
    validation: { required: true, ageRange: { min: 16, max: 100 } },
  },
  {
    id: 'B3',
    chapter: 2,
    template: 'measure',
    eyebrow: chapterEyebrow(2),
    question: 'Your height and weight.',
    why: 'These are the two biggest inputs in your daily targets.',
    cta: 'Continue',
    validation: { required: true },
  },
  {
    id: 'B4',
    chapter: 2,
    template: 'goalWeight',
    eyebrow: chapterEyebrow(2),
    question: 'Do you have a goal weight in mind?',
    why: 'Protein is set from your goal weight.',
    skippable: true,
    skipLabel: 'No number, just the goal',
    cta: 'Continue',
  },

  // ── Chapter 3 · Lifestyle ──────────────────────────────────────────────
  {
    id: 'L1',
    chapter: 3,
    template: 'rows',
    eyebrow: chapterEyebrow(3),
    roman: 'Now your normal week, outside the gym and in it.',
    question: 'Counting work, walking and exercise, how active is a typical week?',
    why: 'This scales your resting energy to your real day.',
    options: [
      { value: 'sedentary', label: 'Mostly sitting', sub: 'Desk day, little exercise' },
      { value: 'light', label: 'Lightly active', sub: 'Light exercise 1 to 3 days' },
      { value: 'moderate', label: 'Moderately active', sub: 'Exercise 3 to 5 days' },
      { value: 'active', label: 'Very active', sub: 'Hard exercise 6 to 7 days' },
      { value: 'very_active', label: 'Physically demanding', sub: 'Hard training plus a physical job' },
    ],
    autoAdvance: true,
    validation: { required: true },
  },
  {
    id: 'L2',
    chapter: 3,
    template: 'chips',
    eyebrow: chapterEyebrow(3),
    question: 'How much do you usually sleep?',
    why: 'Sleep shapes recovery and hunger.',
    options: [
      { value: 'lt_6', label: 'Under 6 hours' },
      { value: '6_7', label: '6 to 7' },
      { value: '7_8', label: '7 to 8' },
      { value: 'gt_8', label: 'More than 8' },
    ],
    single: true,
    autoAdvance: true,
    skippable: true,
  },

  // ── Chapter 4 · Training ───────────────────────────────────────────────
  {
    id: 'T1',
    chapter: 4,
    template: 'rows',
    eyebrow: chapterEyebrow(4),
    roman: 'Tell me about your training so far.',
    question: 'How familiar are you with structured training?',
    why: 'So your first weeks feel right, not too easy or too hard.',
    options: [
      { value: 'beginner', label: 'New to it', sub: "I haven't followed a program" },
      { value: 'intermediate', label: 'Some experience', sub: "I've trained on and off" },
      { value: 'advanced', label: 'Experienced', sub: 'I train consistently and know the main lifts' },
    ],
    autoAdvance: true,
    validation: { required: true },
  },
  {
    id: 'T2',
    chapter: 4,
    template: 'chips',
    eyebrow: chapterEyebrow(4),
    question: 'What have you enjoyed before?',
    why: '{Coach} can build around what you already like.',
    options: [
      { value: 'weights', label: 'Weights' },
      { value: 'classes', label: 'Classes' },
      { value: 'running', label: 'Running' },
      { value: 'sports', label: 'Sports' },
      { value: 'yoga_pilates', label: 'Yoga or Pilates' },
      { value: 'home', label: 'Home workouts' },
      { value: 'swim_cycle', label: 'Swimming or cycling' },
      { value: 'none', label: 'Nothing yet' },
    ],
    exclusive: 'none',
    skippable: true,
    cta: 'Continue',
    validation: { minSelections: 1 },
  },
  {
    id: 'T3',
    chapter: 4,
    template: 'yesno',
    eyebrow: chapterEyebrow(4),
    question:
      'Is any part of your body asking for extra care right now? An injury, a sore joint, or a recent surgery.',
    longQuestion: true,
    why: "We'll start you with moves that respect it.",
    options: YES_NO,
    autoAdvance: true,
    cta: 'Continue',
    validation: { required: true, detailMaxLength: 280 },
    detail: {
      when: { key: 'T3', equals: 'yes' },
      chipsKey: 'T3_areas',
      chipsLabel: 'Where?',
      chipsRequired: true,
      chipsOptions: [
        { value: 'lower_back', label: 'Lower back' },
        { value: 'upper_back_neck', label: 'Upper back or neck' },
        { value: 'shoulder', label: 'Shoulder' },
        { value: 'elbow_wrist', label: 'Elbow or wrist' },
        { value: 'hip', label: 'Hip' },
        { value: 'knee', label: 'Knee' },
        { value: 'ankle_foot', label: 'Ankle or foot' },
        { value: 'other', label: 'Other' },
      ],
      textKey: 'T3_note',
      textLabel: 'Anything {coach} should know? (optional)',
      textMaxLength: 280,
      textMultiline: true,
    },
  },
  {
    id: 'T4',
    chapter: 4,
    template: 'chips',
    eyebrow: chapterEyebrow(4),
    question: 'How long can a typical session be?',
    why: 'So a session fits your day.',
    options: [
      { value: '20_30', label: '20 to 30 min' },
      { value: '30_45', label: '30 to 45' },
      { value: '45_60', label: '45 to 60' },
      { value: '60_plus', label: 'Over an hour' },
    ],
    single: true,
    autoAdvance: true,
    skippable: true,
  },

  // ── Chapter 5 · Schedule ───────────────────────────────────────────────
  {
    id: 'S1',
    chapter: 5,
    template: 'chips',
    eyebrow: chapterEyebrow(5),
    timeLeft: 'About 3 minutes left',
    roman: 'Now the practical part: when and where.',
    question: 'Realistically, how many days a week can you train?',
    why: 'Your plan is built around the days you actually have.',
    options: [
      { value: '2', label: '1 to 2' },
      { value: '3', label: '3' },
      { value: '4', label: '4' },
      { value: '5', label: '5 or more' },
    ],
    single: true,
    big: true,
    autoAdvance: true,
    validation: { required: true },
  },
  {
    id: 'S2',
    chapter: 5,
    template: 'chips',
    eyebrow: chapterEyebrow(5),
    timeLeft: 'About 3 minutes left',
    question: 'When do you prefer to train?',
    why: "So reminders arrive when they're useful.",
    options: [
      { value: 'morning', label: 'Morning' },
      { value: 'midday', label: 'Midday' },
      { value: 'evening', label: 'Evening' },
      { value: 'varies', label: 'It varies' },
    ],
    single: true,
    autoAdvance: true,
    skippable: true,
  },
  {
    id: 'S3',
    chapter: 5,
    template: 'rows',
    eyebrow: chapterEyebrow(5),
    timeLeft: 'About 3 minutes left',
    question: 'Where will you train most often?',
    why: 'Every exercise in your plan will match what you have.',
    options: [
      { value: 'gym', label: 'A gym' },
      { value: 'home_some', label: 'At home, with some equipment' },
      { value: 'none', label: 'At home or anywhere, no equipment' },
      { value: 'mix', label: 'A mix of gym and home' },
    ],
    autoAdvance: true,
    validation: { required: true },
  },
  {
    id: 'S3b',
    chapter: 5,
    template: 'chips',
    eyebrow: chapterEyebrow(5),
    timeLeft: 'About 3 minutes left',
    question: 'What do you have at home?',
    why: "I'll only use what's in your space.",
    options: [
      { value: 'dumbbells', label: 'Dumbbells' },
      { value: 'kettlebells', label: 'Kettlebells' },
      { value: 'resistance_bands', label: 'Resistance bands' },
      { value: 'barbell', label: 'Barbell' },
      { value: 'pull_up_bar', label: 'Pull-up bar' },
      { value: 'cardio_machine', label: 'Cardio machine' },
      { value: 'other', label: 'Something else' },
    ],
    cta: 'Continue',
    validation: { required: true, minSelections: 1 },
    showWhen: { key: 'S3', equals: 'home_some' },
  },

  // ── Chapter 6 · Nutrition ──────────────────────────────────────────────
  {
    id: 'N1',
    chapter: 6,
    template: 'rows',
    eyebrow: chapterEyebrow(6),
    timeLeft: 'About 2 minutes left',
    roman: 'A few questions about how you eat. There are no wrong answers.',
    question: 'Do you follow a particular way of eating?',
    why: 'So examples and suggestions fit how you eat.',
    options: [
      { value: 'none', label: 'No particular pattern' },
      { value: 'vegetarian', label: 'Vegetarian' },
      { value: 'vegan', label: 'Vegan' },
      { value: 'pescatarian', label: 'Pescatarian' },
      { value: 'keto', label: 'Keto' },
      { value: 'paleo', label: 'Paleo' },
      { value: 'other', label: 'Something else' },
    ],
    autoAdvance: true,
    validation: { required: true },
  },
  {
    id: 'N2',
    chapter: 6,
    template: 'chips',
    eyebrow: chapterEyebrow(6),
    timeLeft: 'About 2 minutes left',
    question: "Anything you can't or won't eat?",
    why: 'So nothing we suggest is something you avoid.',
    options: [
      { value: 'nothing', label: 'Nothing' },
      { value: 'dairy', label: 'Dairy' },
      { value: 'gluten', label: 'Gluten' },
      { value: 'nuts', label: 'Nuts' },
      { value: 'shellfish', label: 'Shellfish' },
      { value: 'eggs', label: 'Eggs' },
      { value: 'soy', label: 'Soy' },
      { value: 'pork', label: 'Pork' },
      { value: 'halal', label: 'Halal only' },
      { value: 'kosher', label: 'Kosher only' },
      { value: 'other', label: 'Something else' },
    ],
    exclusive: 'nothing',
    cta: 'Continue',
    validation: { required: true, minSelections: 1, detailMaxLength: 140 },
    detail: {
      when: { key: 'N2', includes: 'other' },
      textKey: 'N2_other',
      textLabel: 'What else?',
      textMaxLength: 140,
    },
  },
  {
    id: 'N3',
    chapter: 6,
    template: 'chips',
    eyebrow: chapterEyebrow(6),
    timeLeft: 'About 2 minutes left',
    question: 'How many times do you usually eat in a day?',
    why: 'Roman can split your protein across your meals.',
    options: [
      { value: '2', label: '2' },
      { value: '3', label: '3' },
      { value: '4', label: '4' },
      { value: '5', label: '5 or more' },
    ],
    single: true,
    big: true,
    autoAdvance: true,
    skippable: true,
  },
  {
    id: 'N4',
    chapter: 6,
    template: 'rows',
    eyebrow: chapterEyebrow(6),
    timeLeft: 'About 2 minutes left',
    question: 'Have you tracked food before?',
    why: 'So I explain your numbers at the right depth.',
    options: [
      { value: 'never', label: 'Never' },
      { value: 'some', label: 'A little' },
      { value: 'regular', label: 'Regularly' },
    ],
    autoAdvance: true,
    skippable: true,
  },
  {
    id: 'N5',
    chapter: 6,
    template: 'chips',
    eyebrow: chapterEyebrow(6),
    timeLeft: 'About 2 minutes left',
    question: 'What makes eating well hardest for you?',
    why: '{Coach} will focus on what actually gets in your way.',
    options: [
      { value: 'time', label: 'Time' },
      { value: 'cravings', label: 'Cravings' },
      { value: 'eating_out', label: 'Eating out' },
      { value: 'late_nights', label: 'Late nights' },
      { value: 'not_sure', label: 'Not sure what to eat' },
      { value: 'other', label: 'Something else' },
    ],
    skippable: true,
    cta: 'Continue',
    validation: { minSelections: 1, maxSelections: 3 },
  },

  // ── Chapter 7 · Safety (readiness screening; the agreement is P0, after W1) ──
  screeningScreen(1),
  screeningScreen(2),
  screeningScreen(3),
  screeningScreen(4),
  screeningScreen(5),
  screeningScreen(6),
  screeningScreen(7),
  {
    id: 'P8',
    chapter: 7,
    template: 'message',
    eyebrow: chapterEyebrow(7),
    pause: true,
    question: 'Thank you for answering so carefully, {first}.',
    longQuestion: true,
    roman: 'That helps me look after you properly.',
    cta: 'Continue',
    showWhen: {
      any: SCREENING_KEYS.map((k) => ({ key: k, equals: 'yes' })),
    },
  },

  // ── Chapter 8 · Commitment ─────────────────────────────────────────────
  {
    id: 'C1',
    chapter: 8,
    template: 'chips',
    eyebrow: chapterEyebrow(8),
    timeLeft: 'Under a minute left',
    roman: "One small promise, and then I'll prepare everything.",
    question: 'When will you do your first session?',
    dynamicOptions: 'firstSessionDays',
    defaultValue: 'tomorrow',
    single: true,
    cta: 'Continue',
    validation: { required: true },
  },
];

export function screenById(id: string): ScreenDef | undefined {
  return SCREENS.find((s) => s.id === id);
}
