/**
 * CRISIS-APP-COPY (owner #CRISIS-WORDING and CRISIS-APP-COPY, op 1): the
 * approved crisis sentence follows the Roman safety-reply exception wherever
 * the app states it (Trust Center "Who can see your data", Your conversations
 * with Roman), exactly while the server's FEATURE_ROMAN_CRISIS_ALERT is on.
 * The app learns that from `roman_crisis_alert` in GET /me/feature-flags (the
 * map it already reads; absent, loading or failed = off, even after an earlier
 * success). The sentence is word for word the backend's
 * ROMAN_CRISIS_TOLD_SENTENCE (src/roman/roman.feature.ts).
 */
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useFeatureFlags } from '../hooks/useFeatureFlags';
import { isCoachLikeRole } from './roleSelectionGate';

export const ROMAN_SAFETY_EXCEPTION =
  'One exception: if Roman sends you an urgent medical safety reply or an eating-disorder safety reply, your coach sees the message that prompted it, so they can check in with you.';

export const ROMAN_CRISIS_TOLD_SENTENCE =
  'If Roman sends you a crisis safety reply, your coach is told that it happened, but not what you wrote, so they can check in with you.';

/** `text` with the crisis sentence right after the exception while `on`; otherwise `text` unchanged. */
export function withCrisisSentence(text: string, on: boolean): string {
  return on
    ? text.replace(ROMAN_SAFETY_EXCEPTION, `${ROMAN_SAFETY_EXCEPTION} ${ROMAN_CRISIS_TOLD_SENTENCE}`)
    : text;
}

/**
 * The one place that decides who reads the sentence (FIX725): a client with a
 * coach, while the switch reads on. A coach account, a client with no coach and
 * an account not loaded yet never do, whatever the text or the switch says.
 */
export function useRomanCrisisSentence(): (text: string) => string {
  const user = useCurrentUser();
  const on = useFeatureFlags().flags.roman_crisis_alert && Boolean(user?.coach_id) && !isCoachLikeRole(user?.role);
  return (text) => withCrisisSentence(text, on);
}
