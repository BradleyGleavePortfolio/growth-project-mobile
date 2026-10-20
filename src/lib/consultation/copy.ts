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
 * #635), which moved P0 to consult-consent-v3. Owner C-6a removed paragraph 3's referral-partner sentence
 * (consult-consent-v5 / v6); owner 62 added the coach-free versions below; owner 57c added the
 * safety-reply exception to paragraph 4 (consult-consent-v7 / v8, client-ai-v6 / v7) and owner 62y2
 * took Roman out of the coach-free screen (consult-consent-v7-coach-free); W-CONSENT put the coached
 * Roman choice back on it (consult-consent-v8 / v9-coach-free, consentScreenCopy). W-BRAND-AGREEMENT (owner
 * op 1, 2026-10-19) names TGP Fitness in paragraphs 1 and 3 and box 1 (W34-W38): every screen moved to
 * its successor (consult-consent-v11 to v14, v12- to v15-coach-free; the pins below are those screens).
 * Any change to the P0 paragraphs, either box label
 * or the footer must bump CONSULT_CONSENT_COPY_VERSION (and, for paragraph 4
 * or box 2, AI_CONSENT_VERSION), update the pinned hashes below, and goes
 * through T4 review (privacy / data path).
 */
import { anyScreeningYes, ageOn } from './engine';
import { ROMAN_CRISIS_TOLD_SENTENCE, ROMAN_SAFETY_EXCEPTION } from '../romanCrisisSentence';
import type { Answers, MeasureAnswer } from './types';
import {
  CONSENT_TITLE,
  CONSULT_CONSENT_COACH_FREE_COPY_VERSION,
  CONSULT_CONSENT_COACH_FREE_CRISIS_COPY_VERSION,
  CONSULT_CONSENT_COACH_FREE_CRISIS_MEMORY_COPY_VERSION,
  CONSULT_CONSENT_COACH_FREE_MEMORY_COPY_VERSION,
  CONSULT_CONSENT_COPY_VERSION,
  CONSULT_CONSENT_CRISIS_COPY_VERSION,
  CONSULT_CONSENT_CRISIS_MEMORY_COPY_VERSION,
  CONSULT_CONSENT_MEMORY_COPY_VERSION,
} from './consentVersion';

export {
  CONSULT_CONSENT_COPY_VERSION,
  CONSULT_CONSENT_MEMORY_COPY_VERSION,
  CONSULT_CONSENT_COACH_FREE_COPY_VERSION,
  CONSENT_BINDING,
  AI_CONSENT_VERSION,
  WAIVER_VERSION,
} from './consentVersion';
export { CONSENT_TITLE };

/** Paragraphs 1-3: shown above box 1 (waiver, collection and use for coaching). */
export const CONSENT_PARAGRAPHS: readonly string[] = [
  'TGP Fitness provides personal training and nutrition guidance only. We do not diagnose, treat, or give medical advice. Nothing in this app replaces the advice of a physician or other qualified health provider.',
  'Exercise carries some risk of injury. You choose how hard to work, you stop if something hurts, and you take part at your own risk.',
  'To coach you, TGP Fitness and your coach collect and use what you share here: your profile, this consultation including the screening questions, your targets, food and workout logs, check-ins, any health, sleep or wearable data you choose to connect, your messages with your coach, and posts you write in the community. We use it only to provide your training. We never sell it.',
];

/** Box 1 (required to continue). */
export const CONSENT_CHECKBOX_LABEL =
  'I agree to the training waiver, and to TGP Fitness and my coach collecting and using my information to coach me.';

/** Paragraph 4 before owner 57c (client-ai-v4): still shown to a client whose live grant is of it. */
export const AI_CONSENT_PARAGRAPH_PRE57C =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions and your coach can use AI drafts about your training. Only your own data is used, never another client's, and never your coach's private notes. Your conversations with Roman are private from your coach and are kept until you delete them or delete your account.";

/** Owner 57c: the same sentence as the privacy page, added to paragraph 4 (one literal, lib/romanCrisisSentence). */
export const AI_CONSENT_SAFETY_EXCEPTION = ROMAN_SAFETY_EXCEPTION;

/** Paragraph 4 (client-ai-v6): shown above box 2, and again in Settings > Privacy > Roman and AI. */
export const AI_CONSENT_PARAGRAPH = `${AI_CONSENT_PARAGRAPH_PRE57C} ${AI_CONSENT_SAFETY_EXCEPTION}`;

/** CRISIS-APP-COPY (client-ai-v8, b#1041): v6 with the crisis sentence; shown only when the server answers with it. */
export const AI_CONSENT_PARAGRAPH_CRISIS = `${AI_CONSENT_PARAGRAPH} ${ROMAN_CRISIS_TOLD_SENTENCE}`;

/** Box 2 (optional, unticked by default). */
export const AI_CONSENT_CHECKBOX_LABEL =
  "Optional: I allow Roman and my coach's AI tools to use my information, processed by Anthropic.";

export const CONSENT_FOOTER =
  "Nothing is sent until you continue. You can change the optional choice at any time in Settings > Privacy. Roman's guided tour works either way.";

/**
 * Owner 62 (Option 1): what a client with no coach sees instead of paragraphs 1-3, box 1, paragraph 4
 * and box 2. The same text with every coach sentence or clause removed and no new words; the one
 * grammar join is paragraph 3's "collects and uses". Title and footer are shared.
 */
export const CONSENT_PARAGRAPHS_COACH_FREE: readonly string[] = [
  CONSENT_PARAGRAPHS[0],
  CONSENT_PARAGRAPHS[1],
  'To coach you, TGP Fitness collects and uses what you share here: your profile, this consultation including the screening questions, your targets, food and workout logs, check-ins, any health, sleep or wearable data you choose to connect, and posts you write in the community. We use it only to provide your training. We never sell it.',
];
export const CONSENT_CHECKBOX_LABEL_COACH_FREE =
  'I agree to the training waiver, and to TGP Fitness collecting and using my information to coach me.';
export const AI_CONSENT_PARAGRAPH_COACH_FREE =
  "Roman, the assistant in this app, is powered by Anthropic, a third-party AI provider. If you allow it, your information is sent to Anthropic so Roman can answer your questions. Only your own data is used, never another client's. Your conversations with Roman are kept until you delete them or delete your account.";
export const AI_CONSENT_CHECKBOX_LABEL_COACH_FREE =
  'Optional: I allow Roman to use my information, processed by Anthropic.';
/** Owner 62y2: the coach-free footer keeps only the sentence that does not name the removed choice. */
export const CONSENT_FOOTER_COACH_FREE = 'Nothing is sent until you continue.';
/** W-CONSENT (C3-S-84, C3-S-83, owner item 16): above the coached paragraph 4 for a client with no coach. */
export const CONSENT_ROMAN_COACH_FREE_TITLE = 'Before you join a coach';
export const CONSENT_ROMAN_COACH_FREE_LEAD =
  'Roman works with a coach, so he is not available until you join one. If you allow this now, Roman is ready on the day you join and you will not be asked again.';

/**
 * Exact text of the whole P0 screen, in display order: the title, then the parts consentScreenCopy
 * gives the screen (paragraphs 1-3, box 1, for a client with no coach the Roman heading and lead,
 * paragraph 4 or the server's memory paragraph `aiParagraph`, box 2, footer). Its sha256 is sent as
 * the P0 record's `text_sha256` (backend #607 stores what was shown).
 */
export function consentCopyText(aiParagraph?: string, coachFree = false): string {
  const c = consentScreenCopy(coachFree);
  const roman = c.romanTitle && c.romanLead ? [c.romanTitle, c.romanLead] : [];
  return [CONSENT_TITLE, ...c.paragraphs, c.box1Label, ...roman, aiParagraph ?? c.aiParagraph, c.box2Label, c.footer].join(
    '\n\n',
  );
}

/**
 * Exact text box 2 covers (paragraph 4 and the box 2 label). Its sha256 is
 * the `copy_sha256` of POST /me/ai-consent/roman; the R2a server copy for
 * `client-ai-v4` must hash to the same value.
 */
export function aiConsentCopyText(coachFree = false): string {
  return coachFree
    ? [AI_CONSENT_PARAGRAPH_COACH_FREE, AI_CONSENT_CHECKBOX_LABEL_COACH_FREE].join('\n\n')
    : [AI_CONSENT_PARAGRAPH, AI_CONSENT_CHECKBOX_LABEL].join('\n\n');
}

/**
 * Pinned sha256 (lowercase hex) of consentCopyText() and aiConsentCopyText().
 * A unit test recomputes both from the text, so the copy cannot change
 * without these (and the versions) changing too. Pinned rather than hashed
 * at runtime so the record never depends on a native digest call.
 * CONSENT_COPY_SHA256 is backend CONSULT_CONSENT_V11_TEXT_SHA256 (W-BRAND-AGREEMENT).
 */
export const CONSENT_COPY_SHA256 = '4b1686a8e835297d0e6bbd91dce988b4b5b9046eb9d70aebbda9e1d36c70f926';
export const AI_CONSENT_COPY_SHA256 = '52066998fbccac128c78a68dc19c45c4e067d169c4b3e5aaaa0d7821a7a1ee38';

/**
 * R11-C2B pins for box 2 with the server's client-ai-v5 paragraph (the app holds no v5 text): the
 * sha256 of that paragraph + "\n\n" + the box 2 label (backend CLIENT_AI_CONSENT_V5_COPY_SHA256), and
 * of the whole P0 screen with it, consentCopyText(v5 paragraph) (backend CONSULT_CONSENT_V4_TEXT_SHA256;
 * W-BRAND-AGREEMENT: CONSULT_CONSENT_V12_TEXT_SHA256, the same screen with TGP Fitness).
 * Box 2 shows server v5 text only when its copy sha256 equals the first pin, so the P0 record is exact.
 */
export const AI_CONSENT_MEMORY_COPY_SHA256 = '15c1b92f0c68e485d8e2c4d399c00eeb17a16291da8fae636260e085cada0842';
export const CONSENT_MEMORY_COPY_SHA256 = '8989ac25a1d87a5d6c2f355b74e1a260fb3b35231bf571a371440229d4c9f6a9';

/** Before owner 57c (client-ai-v4 / v5 copy sha256): a live grant of them is read with these. */
export const AI_CONSENT_PRE57C_COPY_SHA256 = 'fbf821401d4313c6a301a6cc08d3870bb117c293fbb970e321bf87f49abe34f4';
export const AI_CONSENT_PRE57C_MEMORY_COPY_SHA256 = '8c19fca94c2455094c47b1802bb6693aff47d24c7b6df3b256d0a0e8e90fe8ee';

/**
 * Owner 62 / 62y2 / W-CONSENT pins: the whole coach-free P0 screen with the Roman choice (FIX684:
 * backend consult-consent-v8-coach-free, v9-coach-free with the server's memory paragraph), and the
 * coach-free box 2 copies (client-ai-v4-coach-free / v5-coach-free paragraph + label) a grant recorded
 * before 62y2 is read with. W-BRAND-AGREEMENT: the two screen pins are now v12 / v13-coach-free.
 */
export const CONSENT_COACH_FREE_COPY_SHA256 = 'a655bb7c794629a25fc27246dace79078a516a8ef45c357751bc2d2271ba0d64';
export const CONSENT_COACH_FREE_MEMORY_COPY_SHA256 = '336fcf0271843d9b9bfca35ce321480aba4925196f935b1e0ac51e260cba468b';
export const AI_CONSENT_COACH_FREE_COPY_SHA256 = '2a8c7973ba6047b58a0fdccb2604a796403d5b4773a6f6a73c98da3d84e68447';
export const AI_CONSENT_COACH_FREE_MEMORY_COPY_SHA256 = 'c7cd7ebd3b47e3eb0e890a8efa932610c35716aa79ad4f139b6f0c0aad7128fe';

/**
 * CRISIS-APP-COPY pins (backend b#1041): client-ai-v8 / v9 copy sha256 (box 2 with this build's v8
 * paragraph, or the server's v9 one) and the whole P0 screen with them (consult-consent-v9 / v10;
 * W-BRAND-AGREEMENT: v13 / v14, the same screens with TGP Fitness).
 */
export const AI_CONSENT_CRISIS_COPY_SHA256 = 'af4cc4fa55aa72cab8e7c6cdcee881d6ba1f448df048088e47acd5e7d479e0ef';
export const AI_CONSENT_CRISIS_MEMORY_COPY_SHA256 = '16074f18ce0e985e35ba7cfb3f12233cd993159585a35759c4580a730ed3c9dd';
export const CONSENT_CRISIS_COPY_SHA256 = '2f22065286d2284cc70e38921da11fcafa8c11a03887025e8781347592a163d6';
export const CONSENT_CRISIS_MEMORY_COPY_SHA256 = '82f3993ef5ce2262d15afe64a45b8d5ad63ca1fa42cd3e172e597d4fe761ba81';
/** FIXCONSENT (backend b#1046): the coach-free P0 screen with them (W-BRAND-AGREEMENT: v14 / v15-coach-free). */
export const CONSENT_COACH_FREE_CRISIS_COPY_SHA256 = '5cb2ef1651f012bfb7a7c1569d06ecdfd43f1c33d00208d23bdf286353dfbf56';
export const CONSENT_COACH_FREE_CRISIS_MEMORY_COPY_SHA256 = 'b7eb74293aac4d20c6d19ea2b7a97bec035467f8f8897a5d8e393fd7140e6864';

/**
 * The P0 screen a client sees and what its record names: `version` / `sha256` with this build's
 * paragraph 4, `memoryVersion` / `memorySha256` when box 2 shows the server's memory paragraph.
 * W-CONSENT: a client with no coach sees the coached paragraph 4 and box 2 (client-ai-v6 / v7, so the
 * grant covers Roman once a coach is linked) under `romanTitle`, led by `romanLead`. Their P0 record
 * names that whole screen (consult-consent-v8-coach-free / v9-coach-free, FIX684); box 2 itself is also
 * recorded by the AI consent ledger grant with its own copy sha256, as box 2 always is.
 * `crisis` (CRISIS-APP-COPY): the server answered with client-ai-v8 / v9, so paragraph 4 is v8's and the
 * record is consult-consent-v9 / v10, or v10 / v11-coach-free for a client with no coach (FIXCONSENT: the
 * crisis sentence follows the exception wherever it is stated). W-BRAND-AGREEMENT: each of these screens
 * names TGP Fitness, so every version moved to its successor (v11 to v14, v12- to v15-coach-free).
 */
export function consentScreenCopy(coachFree: boolean, crisis = false) {
  return coachFree
    ? {
        paragraphs: CONSENT_PARAGRAPHS_COACH_FREE,
        box1Label: CONSENT_CHECKBOX_LABEL_COACH_FREE,
        romanTitle: CONSENT_ROMAN_COACH_FREE_TITLE,
        romanLead: CONSENT_ROMAN_COACH_FREE_LEAD,
        aiParagraph: crisis ? AI_CONSENT_PARAGRAPH_CRISIS : AI_CONSENT_PARAGRAPH,
        box2Label: AI_CONSENT_CHECKBOX_LABEL,
        footer: CONSENT_FOOTER_COACH_FREE,
        version: crisis ? CONSULT_CONSENT_COACH_FREE_CRISIS_COPY_VERSION : CONSULT_CONSENT_COACH_FREE_COPY_VERSION,
        sha256: crisis ? CONSENT_COACH_FREE_CRISIS_COPY_SHA256 : CONSENT_COACH_FREE_COPY_SHA256,
        memoryVersion: crisis ? CONSULT_CONSENT_COACH_FREE_CRISIS_MEMORY_COPY_VERSION : CONSULT_CONSENT_COACH_FREE_MEMORY_COPY_VERSION,
        memorySha256: crisis ? CONSENT_COACH_FREE_CRISIS_MEMORY_COPY_SHA256 : CONSENT_COACH_FREE_MEMORY_COPY_SHA256,
      }
    : {
        paragraphs: CONSENT_PARAGRAPHS,
        box1Label: CONSENT_CHECKBOX_LABEL,
        romanTitle: null,
        romanLead: null,
        aiParagraph: crisis ? AI_CONSENT_PARAGRAPH_CRISIS : AI_CONSENT_PARAGRAPH,
        box2Label: AI_CONSENT_CHECKBOX_LABEL,
        footer: CONSENT_FOOTER,
        version: crisis ? CONSULT_CONSENT_CRISIS_COPY_VERSION : CONSULT_CONSENT_COPY_VERSION,
        sha256: crisis ? CONSENT_CRISIS_COPY_SHA256 : CONSENT_COPY_SHA256,
        memoryVersion: crisis ? CONSULT_CONSENT_CRISIS_MEMORY_COPY_VERSION : CONSULT_CONSENT_MEMORY_COPY_VERSION,
        memorySha256: crisis ? CONSENT_CRISIS_MEMORY_COPY_SHA256 : CONSENT_MEMORY_COPY_SHA256,
      };
}

/** P8: general guidance and a safe next step, then the physician line. */
export const P8_COPY = {
  intro:
    'One of your answers means your plan starts gently, and your physician gets a say before anything demanding.',
  guidanceTitle: 'Until then, a few good habits',
  guidance: [
    'Choose an effort where you can still hold a conversation. If you are breathless, ease off.',
    'Warm up for five minutes, and rest fully between sets.',
    'Stop if you feel chest discomfort, unusual shortness of breath, dizziness or sharp pain. Rest, and tell {coach}.',
  ],
  nextTitle: "Here's what happens next",
  next: [
    'You can finish setting up today and explore the app.',
    'Your plan will start with the gentlest, lowest-impact program as a safe default.',
    '{Coach} will be told, so they can check in with you.',
    'Your safest next step: book a visit with your physician and mention you are starting a training program. Once you have their OK, message {coach} and your plan can be adjusted.',
  ],
  physician:
    'Based on your answers, check with your physician before starting a new exercise program. This is a standard precaution, not a diagnosis.',
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
  sesame: 'sesame',
  fish: 'fish',
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

/** Reveal and paused lines that name the coach (coachless versions in COACHLESS_COPY). */
export const REVEAL_COPY = {
  physicianStart: 'Start once your physician gives you the OK. {Coach} has been told.',
  planAdjust:
    'Your first day is already scheduled in Train. Does something feel off? Message {coach}. Your coach can adjust anything in this plan.',
  macroQuestions:
    'Questions about your numbers? Message {coach} any time from Messages. Your coach can adjust these targets for you.',
  paused:
    "Whenever you're ready, you can pick up exactly where you left off. {Coach} will see your answers once you finish.",
  /** Prototype 43: the summary while the phone is offline. */
  offlineCta: "Prepare when I'm back online",
  offlineRoman: "I'll prepare your numbers the moment you're connected. Nothing you've told me is lost.",
  /** Prototype 42: Roman's chapter line on the first screen after a resume. */
  welcomeBack: 'Welcome back, {first}. You were telling me about {topic}.',
} as const;

const RESUME_TOPIC: Record<number, string> = {
  1: 'your goals',
  2: 'your measurements',
  3: 'your normal week',
  4: 'your training',
  5: 'your schedule',
  6: 'how you eat',
  7: 'your health',
  8: 'when you will start',
};

/** Prototype 42 template for a chapter (fill with fillCopy); null for the welcome. */
export function welcomeBackLine(chapter: number): string | null {
  const topic = RESUME_TOPIC[chapter];
  return topic ? REVEAL_COPY.welcomeBack.replace('{topic}', topic) : null;
}

const SESSION_LENGTH: Record<string, string> = {
  '20_30': 'About 20 to 30 minutes each.',
  '30_45': 'About 30 to 45 minutes each.',
  '45_60': 'About 45 to 60 minutes each.',
  '60_plus': 'Over an hour each.',
};

/** Plan reveal (prototype 40): the session length the client gave at T4, or null when skipped. */
export function sessionLengthLine(t4: unknown): string | null {
  return typeof t4 === 'string' ? SESSION_LENGTH[t4] ?? null : null;
}

/** Monday-based weekday (0 = Monday) of the C1 first-session date, or null. */
export function firstSessionWeekday(c1: unknown): number | null {
  if (typeof c1 !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c1);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : (d.getDay() + 6) % 7;
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
 * Support contact on the problem and paused screens. Owner rule (2026-10-01
 * 14:19): one support address everywhere, so this re-exports the single
 * constant in src/constants/support.ts (same as backend #611 SUPPORT_EMAIL).
 */
export { SUPPORT_EMAIL } from '../../constants/support';
