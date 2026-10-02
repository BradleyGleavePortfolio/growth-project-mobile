/**
 * Consultation copy that is longer than a single definition field: the P0
 * agreement text (versioned, two boxes), the P8 message, and the
 * deterministic summary.
 *
 * P0 copy is consent copy (D2 contract, ops/CONSENT_D2_CONTRACT.md, copy v2
 * approved by the owner 2026-10-01 09:07, implemented verbatim with straight
 * apostrophes so the R2a server copy hashes match). Paragraph 4's last
 * sentence is the client-ai-v4 retention line (owner 2026-10-01 20:32: Roman
 * chats are kept until the client deletes them or their account; backend
 * #635), which moved P0 to consult-consent-v3. Any change to the P0 paragraphs, either box label
 * or the footer must bump CONSULT_CONSENT_COPY_VERSION (and, for paragraph 4
 * or box 2, AI_CONSENT_VERSION), update the pinned hashes below, and goes
 * through T4 review (privacy / data path).
 */
import { anyScreeningYes, ageOn } from './engine';
import type { Answers, MeasureAnswer } from './types';

export { CONSULT_CONSENT_COPY_VERSION, CONSENT_BINDING, AI_CONSENT_VERSION, WAIVER_VERSION } from './consentVersion';

export const CONSENT_TITLE = 'Before we start';

/** Paragraphs 1-3: shown above box 1 (waiver, collection and use for coaching). */
export const CONSENT_PARAGRAPHS: readonly string[] = [
  'The Growth Project provides personal training and nutrition guidance only. We do not diagnose, treat, or give medical advice. Nothing in this app replaces the advice of a physician or other qualified health provider.',
  'Exercise carries some risk of injury. You choose how hard to work, you stop if something hurts, and you take part at your own risk.',
  'To coach you, The Growth Project and your coach collect and use what you share here: your profile, this consultation including the screening questions, your targets, food and workout logs, check-ins, any health, sleep or wearable data you choose to connect, your messages with your coach, and posts you write in the community. We use it only to provide your training. We never sell it. If you joined through a clinic, the clinic does not see it.',
];

/** Box 1 (required to continue). */
export const CONSENT_CHECKBOX_LABEL =
  'I agree to the training waiver, and to The Growth Project and my coach collecting and using my information to coach me.';

/** Paragraph 4: shown above box 2, and again in Settings > Privacy > Roman and AI. */
export const AI_CONSENT_PARAGRAPH =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Only your own data is used, never another client's, and never your coach's private notes. Your conversations with Roman are private from your coach and are kept until you delete them or delete your account.";

/** Box 2 (optional, unticked by default). */
export const AI_CONSENT_CHECKBOX_LABEL =
  "Optional: I allow Roman and my coach's AI tools to use my information, processed by Anthropic.";

export const CONSENT_FOOTER =
  "Nothing is sent until you continue. You can change the optional choice at any time in Settings > Privacy. Roman's guided tour works either way.";

/**
 * Exact text of the whole P0 screen, in display order (title, paragraphs
 * 1-3, box 1, paragraph 4, box 2, footer). Its sha256 is sent as the P0
 * record's `text_sha256` (backend #607 stores what was shown).
 */
export function consentCopyText(): string {
  return [
    CONSENT_TITLE,
    ...CONSENT_PARAGRAPHS,
    CONSENT_CHECKBOX_LABEL,
    AI_CONSENT_PARAGRAPH,
    AI_CONSENT_CHECKBOX_LABEL,
    CONSENT_FOOTER,
  ].join('\n\n');
}

/**
 * Exact text box 2 covers (paragraph 4 and the box 2 label). Its sha256 is
 * the `copy_sha256` of POST /me/ai-consent/roman; the R2a server copy for
 * `client-ai-v4` must hash to the same value.
 */
export function aiConsentCopyText(): string {
  return [AI_CONSENT_PARAGRAPH, AI_CONSENT_CHECKBOX_LABEL].join('\n\n');
}

/**
 * Pinned sha256 (lowercase hex) of consentCopyText() and aiConsentCopyText().
 * A unit test recomputes both from the text, so the copy cannot change
 * without these (and the versions) changing too. Pinned rather than hashed
 * at runtime so the record never depends on a native digest call.
 */
export const CONSENT_COPY_SHA256 = '79ceeb6b8316ee9e3f583fe678e2463584c6dda4c93b5c95746dfe5c52ef31c9';
export const AI_CONSENT_COPY_SHA256 = 'fbf821401d4313c6a301a6cc08d3870bb117c293fbb970e321bf87f49abe34f4';

/** P8: general guidance and a safe next step, then the physician line. */
export const P8_COPY = {
  intro:
    'One of your answers means we will start gently, and give your physician a say before anything demanding.',
  guidanceTitle: 'Until then, a few good habits',
  guidance: [
    'Choose an effort where you can still hold a conversation. If you are breathless, ease off.',
    'Warm up for five minutes, and rest fully between sets.',
    'Stop if you feel chest discomfort, unusual shortness of breath, dizziness or sharp pain. Rest, and tell {coach}.',
  ],
  nextTitle: "Here's what happens next",
  next: [
    'You can finish setting up today and explore the app.',
    'Your plan will start with our gentlest, lowest-impact program as a safe default.',
    '{Coach} will be told, so they can check in with you.',
    'Your safest next step: book a visit with your physician and mention you are starting a training program. Once you have their OK, message {coach} and your plan can be adjusted.',
  ],
  physician:
    'Based on your answers, we recommend you check with your physician before starting a new exercise program. This is a standard precaution, not a diagnosis.',
  emergency:
    'If you ever have chest pain, trouble breathing or feel faint, call 911. If you are struggling emotionally, call or text 988.',
  disclaimer:
    'This app provides workout and dietary guidance only. It does not diagnose or treat any medical condition, and it is not a substitute for professional medical advice.',
};

// ── Summary ───────────────────────────────────────────────────────────────

const GOAL: Record<string, string> = {
  fat_loss: 'Lose body fat',
  muscle_gain: 'Build muscle and strength',
  maintenance: 'Maintain and feel better',
  performance: 'Train for a sport or event',
};
const REASON: Record<string, string> = {
  energy: 'more energy',
  strength: 'to feel stronger',
  confidence: 'to feel confident in your body',
  family: 'to keep up with family',
  event: 'an event coming up',
  longevity: 'to stay active for the long run',
};
const ACTIVITY: Record<string, string> = {
  sedentary: 'Mostly sitting',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Very active',
  very_active: 'Physically demanding days',
};
const EXPERIENCE: Record<string, string> = {
  beginner: 'New to structured training',
  intermediate: 'Some training experience',
  advanced: 'Experienced with training',
};
const DAYS: Record<string, string> = { '2': 'One to two', '3': 'Three', '4': 'Four', '5': 'Five or more' };
const TIME: Record<string, string> = { morning: 'mornings', midday: 'midday', evening: 'evenings', varies: 'at varying times' };
const WHERE: Record<string, string> = {
  gym: 'at a gym',
  home_some: 'at home',
  none: 'anywhere, with no equipment',
  mix: 'at a mix of gym and home',
};
const EQUIPMENT: Record<string, string> = {
  dumbbells: 'dumbbells',
  kettlebells: 'kettlebells',
  resistance_bands: 'bands',
  barbell: 'a barbell',
  pull_up_bar: 'a pull-up bar',
  cardio_machine: 'a cardio machine',
  other: 'other equipment',
};
const LENGTH: Record<string, string> = {
  '20_30': 'Twenty to thirty minutes each.',
  '30_45': 'Thirty to forty-five minutes each.',
  '45_60': 'Forty-five to sixty minutes each.',
  '60_plus': 'Over an hour each.',
};
const AREAS: Record<string, string> = {
  lower_back: 'lower back',
  upper_back_neck: 'upper back or neck',
  shoulder: 'shoulder',
  elbow_wrist: 'elbow or wrist',
  hip: 'hip',
  knee: 'knee',
  ankle_foot: 'ankle or foot',
  other: 'another area',
};
const PATTERN: Record<string, string> = {
  none: 'No particular pattern',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  keto: 'Keto',
  paleo: 'Paleo',
  other: 'Your own way of eating',
};
const AVOID: Record<string, string> = {
  dairy: 'dairy',
  gluten: 'gluten',
  nuts: 'nuts',
  shellfish: 'shellfish',
  eggs: 'eggs',
  soy: 'soy',
  pork: 'pork',
  halal: 'halal only',
  kosher: 'kosher only',
  other: 'a few other foods',
};
const NUMBER_WORDS: Record<string, string> = { '2': 'two', '3': 'three', '4': 'four', '5': 'five or more' };

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

export function formatHeight(cm: number, unit: 'imperial' | 'metric'): string {
  if (unit === 'metric') return `${Math.round(cm)} cm`;
  const inches = Math.round(cm / 2.54);
  return `${Math.floor(inches / 12)} ft ${inches % 12} in`;
}

export function formatWeight(lbs: number, unit: 'imperial' | 'metric'): string {
  if (unit === 'metric') return `${Math.round(lbs * 0.453592)} kg`;
  return `${Math.round(lbs)} lb`;
}

export interface SummarySection {
  title: string;
  body: string;
  /** Chapter the Edit link jumps to (null: no Edit, e.g. screening). */
  editChapter: 1 | 2 | 3 | 4 | 6 | null;
}

export function buildSummary(a: Answers, now: Date = new Date()): SummarySection[] {
  const NA = 'Not answered.';

  // Goal
  const goal = GOAL[String(a.G1)] ?? NA;
  const reasons = arr(a.G2)
    .map((r) => (r === 'other' ? (typeof a.G2_other === 'string' && a.G2_other.trim() ? a.G2_other.trim() : 'your own reasons') : REASON[r]))
    .filter(Boolean);
  const goalBody = GOAL[String(a.G1)] ? `${goal}${reasons.length ? `, for ${joinList(reasons)}` : ''}.` : NA;

  // Body
  const m = a.B3 as MeasureAnswer | undefined;
  let bodyBody = NA;
  if (m && typeof m === 'object' && 'height_cm' in m) {
    const goalW = typeof a.B4 === 'number' ? `, aiming for ${formatWeight(a.B4, m.unit)}` : '';
    const age = typeof a.B2 === 'string' ? ageOn(a.B2, now) : NaN;
    const agePart = Number.isNaN(age) ? '' : `${age} years, `;
    bodyBody = `${agePart}${formatHeight(m.height_cm, m.unit)} and ${formatWeight(m.weight_lbs, m.unit)}${goalW}.`;
  }

  // Week
  const parts: string[] = [];
  if (ACTIVITY[String(a.L1)]) parts.push(`${ACTIVITY[String(a.L1)]}.`);
  if (EXPERIENCE[String(a.T1)]) parts.push(`${EXPERIENCE[String(a.T1)]}.`);
  if (DAYS[String(a.S1)]) {
    let s = `${DAYS[String(a.S1)]} sessions a week`;
    if (TIME[String(a.S2)]) s += `, ${TIME[String(a.S2)]}`;
    if (WHERE[String(a.S3)]) s += `, ${WHERE[String(a.S3)]}`;
    const eq = a.S3 === 'home_some' ? arr(a.S3b).map((e) => EQUIPMENT[e]).filter(Boolean) : [];
    if (eq.length) s += ` with ${joinList(eq)}`;
    parts.push(`${s}.`);
  }
  if (LENGTH[String(a.T4)]) parts.push(LENGTH[String(a.T4)]);
  const weekBody = parts.length ? parts.join(' ') : NA;

  // Care notes
  let care = NA;
  if (a.T3 === 'no') care = 'Nothing noted.';
  if (a.T3 === 'yes') {
    const areas = arr(a.T3_areas).map((x) => AREAS[x]).filter(Boolean);
    care = areas.length ? `Extra care for your ${joinList(areas)}.` : 'Extra care noted.';
  }

  // Eating
  let eat = NA;
  if (PATTERN[String(a.N1)]) {
    const avoid = arr(a.N2).filter((x) => x !== 'nothing').map((x) => AVOID[x]).filter(Boolean);
    const avoidPart = arr(a.N2).includes('nothing') ? ', nothing avoided' : avoid.length ? `, avoiding ${joinList(avoid)}` : '';
    const meals = NUMBER_WORDS[String(a.N3)] ? `, ${NUMBER_WORDS[String(a.N3)]} meals a day` : '';
    eat = `${PATTERN[String(a.N1)]}${avoidPart}${meals}.`;
  }

  const screening = anyScreeningYes(a)
    ? 'Complete. Please check with your physician before starting.'
    : 'Complete.';

  return [
    { title: 'Your goal', body: goalBody, editChapter: 1 },
    { title: 'Your body', body: bodyBody, editChapter: 2 },
    { title: 'Your week', body: weekBody, editChapter: 3 },
    { title: 'Care notes', body: care, editChapter: 4 },
    { title: 'How you eat', body: eat, editChapter: 6 },
    { title: 'Safety screening', body: screening, editChapter: null },
  ];
}

const PLANT_BASED = new Set(['vegetarian', 'vegan']);

/** Macro reveal: Roman's short line, by goal. */
export function macroRomanLine(goal: unknown, firstName: string | null | undefined, floorApplied: boolean): string {
  const name = firstName?.trim() ? `, ${firstName.trim()}` : '';
  const aim =
    goal === 'fat_loss'
      ? 'This is set to help you lose fat at a steady pace.'
      : goal === 'muscle_gain'
        ? 'This is set to help you build muscle steadily.'
        : 'This is set to keep you fuelled and steady.';
  const floor = floorApplied
    ? " I've kept this at a steady minimum so you have enough energy to train."
    : '';
  return `Here are your daily targets${name}. ${aim}${floor} Aim for close, not perfect.`;
}

export function proteinExample(eatingPattern: unknown, proteinG: number): string {
  const servings = Math.max(1, Math.round(proteinG / 30));
  const foods = eatingPattern === 'vegan'
    ? 'tofu, tempeh, or lentils'
    : PLANT_BASED.has(String(eatingPattern))
      ? 'tofu, lentils, or eggs'
      : 'chicken, fish, or tofu';
  return `Your target is ${proteinG} g, about the amount in ${servings} palm-sized servings of ${foods}.`;
}

const WEEKS_WORDS: Record<number, string> = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 8: 'Eight', 12: 'Twelve' };
export function weeksEyebrow(weeks: number): string {
  const w = WEEKS_WORDS[weeks] ?? String(weeks);
  return `Your plan · ${w} ${weeks === 1 ? 'week' : 'weeks'}`;
}

/** Training days (0 = Monday) spread across a week for a days-per-week count. */
export function trainingDayPattern(daysPerWeek: number): number[] {
  const map: Record<number, number[]> = {
    1: [2],
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 3, 4],
    6: [0, 1, 2, 3, 4, 5],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return map[Math.min(7, Math.max(1, Math.round(daysPerWeek)))] ?? [];
}

/** "Your first session is Thursday." from the C1 ISO date. */
export function firstSessionLine(c1: unknown, now: Date = new Date()): string | null {
  if (typeof c1 !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c1);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Your first session is today.';
  if (diff === 1) return 'Your first session is tomorrow.';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `Your first session is ${names[d.getDay()]}.`;
}

/**
 * Shown once when unticking box 2 could not be confirmed after one retry
 * (Opus B-310-2, Sol B-310-5). Box 2 shows the client's choice (unticked);
 * the withdrawal stays pending and is retried on the next save, the next
 * launch and in Settings. It says "not confirmed" because nothing proves
 * either state: the grant may or may not be on file.
 */
export const AI_WITHDRAW_NOTICE = {
  title: 'Roman and AI',
  body: 'I could not confirm that Roman and AI is switched off yet, so it may still be allowed for now. I will keep trying, including the next time you open the app. You can also switch it off in Settings > Privacy > Roman and AI.',
} as const;

/** Under box 2 on P0 while that withdrawal is not confirmed (Sol B-310-5). */
/**
 * C-310-9: the saved AI help choice could not be read before box 2 became
 * tappable. Says what happened and where to check; not part of the consent
 * text or its hash.
 */
export const AI_CHOICE_UNKNOWN_LINE =
  'Your saved AI help choice could not be loaded. Leaving this box as it is changes nothing. You can check it in Settings > Privacy > Roman and AI.';

export const AI_WITHDRAW_UNCONFIRMED_LINE =
  'Switching this off is not confirmed yet. I will keep trying. You can check it in Settings > Privacy > Roman and AI.';

/**
 * Shown when a ticked box 2 was sent but no answer confirmed or refused it
 * (lost response, timeout, server error: Sol B-310-5). The grant may be on
 * file, so this never says it is off; box 2 stays ticked as chosen.
 */
export const AI_GRANT_UNCONFIRMED_NOTICE = {
  title: 'Roman and AI',
  body: 'I could not confirm your Roman and AI choice just now, so it may or may not be saved yet. Your training is not affected. You can check or change it at any time in Settings > Privacy > Roman and AI.',
} as const;

/**
 * Shown when the ledger refused a ticked box 2 (Opus C-310-6): a 4xx such as
 * 400 / 401 / 403 / 429, answered before anything is written. Never shown
 * while the ledger is not deployed or switched off (404 / 503: skipped
 * silently by contract), nor when the answer was lost (see
 * AI_GRANT_UNCONFIRMED_NOTICE). Box 2 shows unticked again, because nothing
 * was recorded.
 */
export const AI_GRANT_NOTICE = {
  title: 'Roman and AI',
  body: 'I could not save your Roman and AI choice just now, so it is not allowed yet. Your training is not affected. You can allow it at any time in Settings > Privacy > Roman and AI.',
} as const;

/**
 * Support contact on the problem and paused screens. Owner rule (lane
 * B-CONSENT-2, 2026-10-02): one support address everywhere, the same as
 * backend #611 SUPPORT_EMAIL.
 */
export const SUPPORT_EMAIL = 'Bradleyapple1031@gmail.com';
