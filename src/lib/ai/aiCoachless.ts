/**
 * Who the client-facing AI copy may mention (REFUSAL-COACHLESS-134).
 *
 * Coachless clients can do everything a coached client can except get direct
 * coaching (owner 2026-10-08 15:29), so AI copy never tells them a coach sees
 * their data or is in Messages. Read from the signed-in user's cache, the
 * mirror CoachCodeSheet patches after a join (the same read as the AI consent
 * sheet, growth-project-mobile#592). An empty cache reads as coached, so the
 * coached wording stays the fallback.
 */
import { readUserCacheSync } from '../userCache';
import { AI_CONSENT_SAFETY_EXCEPTION } from '../consultation/copy';
import { withCrisisSentence } from '../romanCrisisSentence';

/** True when the signed-in user has an id and no coach attached. */
export function signedInClientIsCoachless(): boolean {
  const user = readUserCacheSync();
  return Boolean(user?.id && !user.coach_id);
}

/** Each sentence with its own end mark (a split without lookbehind, for Hermes). */
function sentencesOf(text: string): string[] {
  return text.replace(/([.!?])\s+/g, '$1\n').split('\n');
}

/** K1: a client with no coach is told nothing about a coach. Drops each sentence that names one; adds no words. */
export function withoutCoachSentences(text: string): string {
  const parts = sentencesOf(text);
  const kept = parts.filter((s) => !/\bcoach\b/i.test(s));
  return kept.length === parts.length ? text : kept.join(' ');
}

/** A coached promise that the coach does not see Roman chats (v4, v5, the chats intro, Trust & Privacy). */
const COACH_DOES_NOT_SEE = /never sees|private from your coach|^Not your coach/;

/**
 * K2 (owner 57c): the approved exception right after the first such promise, as
 * client-ai-v6 / v7 and main #703 place it. Text that already carries it, or makes
 * no such promise, is returned as it is. `crisis` (CRISIS-APP-COPY, `roman_crisis_alert`
 * on): the crisis sentence follows the exception it adds, as client-ai-v8 / v9 place it.
 */
export function withSafetyException(text: string, crisis = false): string {
  if (text.includes(AI_CONSENT_SAFETY_EXCEPTION)) return text;
  const parts = sentencesOf(text);
  const i = parts.findIndex((s) => COACH_DOES_NOT_SEE.test(s));
  if (i < 0) return text;
  const promise = /[.!?]$/.test(parts[i]) ? parts[i] : `${parts[i]}.`;
  return withCrisisSentence([...parts.slice(0, i), promise, AI_CONSENT_SAFETY_EXCEPTION, ...parts.slice(i + 1)].join(' '), crisis);
}

/** The privacy and consent text a signed-in client is shown: K1 with no coach, K2 with one. */
export function clientPrivacyText(text: string, coachless: boolean = signedInClientIsCoachless()): string {
  return coachless ? withoutCoachSentences(text) : withSafetyException(text);
}
