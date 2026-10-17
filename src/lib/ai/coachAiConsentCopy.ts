/**
 * COACH-AI-CONSENT (owner ruling "#COACH-AI-CONSENT - op 2", text approved 2026-10-16, exact):
 * every word a coach sees when asked whether Roman may send their own text to Anthropic. The sign-up
 * box, the one-time sheet, the Roman screen's off state, AI refusals and the Settings switch read
 * only from here. CAC-5 is version A (owner "CAC-5 - A", 2026-10-16).
 */

/** The copy a grant or a "Not now" names (backend COACH_AI_CONSENT_VERSION). */
export const COACH_AI_CONSENT_VERSION = 'coach-ai-v1';

/** CAC-1: the sign-up checkbox label and the sheet title. */
const TITLE = 'Turn on Roman';
/** CAC-2. */
const PARAGRAPH =
  "Roman runs on Anthropic, an outside AI company. Anything you type to Roman, and your coaching notes, go to Anthropic. A client's data is never sent unless that client allowed AI.";

/** sha256 of CAC-2 + "\n\n" + CAC-1, lowercase hex (backend COACH_AI_CONSENT_COPY_SHA256). */
export const COACH_AI_CONSENT_COPY_SHA256 = '289fadecfefb53be33eb332adeea1acfdec2f8a1e86401d75a90c5a5b6ddfea8';

export const COACH_AI_CONSENT_COPY = {
  title: TITLE,
  paragraph: PARAGRAPH,
  /** CAC-3. */
  allow: 'Allow',
  notNow: 'Not now',
  /** CAC-4. */
  switchLabel: 'Roman (AI by Anthropic)',
  switchHint: 'Turn off to stop sending what you type to Anthropic.',
  /** CAC-5, version A. */
  off: { title: 'Roman is off', body: 'Allow Roman to use Anthropic, then you can chat and draft.', button: 'Turn on Roman' },
} as const;
