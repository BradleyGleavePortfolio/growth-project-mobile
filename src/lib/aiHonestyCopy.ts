/**
 * aiHonestyCopy.ts — Centralised, doctrine-checked AI copy.
 *
 * Doctrine: AI summarises, drafts, flags, and explains. A human coach or
 * admin makes binding decisions. This module is the single source of truth
 * for the language we use anywhere AI output is shown to a user.
 *
 * Anywhere the UI shows AI-generated output, prefer these helpers over
 * inline strings so wording stays consistent and auditable.
 */

/** Constants used in tests + screens to assert doctrine compliance. */
export const AI_ROLE_VERBS = ['summarises', 'drafts', 'flags', 'explains'] as const;

/** Strings the UI MUST NOT show as AI labels. Tests can assert the screens
 *  don't drift toward autonomy claims. */
export const FORBIDDEN_AI_CLAIMS = [
  'AI decides',
  'AI approves',
  'AI prescribes',
  'AI diagnosis',
  'medical advice',
  'financial advice',
] as const;

/** Prefixes used to badge AI output in the UI. */
export const AI_BADGES = {
  summary: 'AI summary',
  draft: 'AI draft',
  flag: 'AI flag',
  explainer: 'AI explainer',
} as const;

/** Returns the canonical disclaimer line shown beneath any AI output that
 *  could otherwise be misread as a recommendation or decision. */
export function aiDisclaimer(kind: 'health' | 'finance' | 'general' = 'general'): string {
  switch (kind) {
    case 'health':
      return 'AI summary only. Your coach reviews and approves any changes — this is not medical advice.';
    case 'finance':
      return 'AI summary only. Your coach reviews any milestone — this is not financial advice.';
    case 'general':
    default:
      return 'AI summary only. Your coach reviews and approves the decision.';
  }
}

/** Prepends an AI badge to a string for display. */
export function badge(kind: keyof typeof AI_BADGES, text: string): string {
  return `${AI_BADGES[kind]} · ${text}`;
}
