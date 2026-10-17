/**
 * CRISIS-BTN: the actions the server attaches to Roman's fixed crisis reply
 * (live answer, history and transcript). The marker is the only signal: reply
 * text is never read for it. Codes this build does not know are dropped, so a
 * new code never fails the parse, and a malformed marker reads as no marker:
 * the reply itself always shows. Shared by romanApi and romanChatsApi.
 */
import { z } from 'zod';

export const ROMAN_SAFETY_ACTIONS = ['call_988', 'text_988', 'message_coach'] as const;
export type RomanSafetyAction = (typeof ROMAN_SAFETY_ACTIONS)[number];
export const RomanSafetyActionsWireSchema = z.array(z.string().max(64)).max(16).optional().catch(undefined);

/** Known codes in a fixed order (call, text, message), once each; undefined when none. */
export function toSafetyActions(wire: readonly string[] | undefined): RomanSafetyAction[] | undefined {
  const known = ROMAN_SAFETY_ACTIONS.filter((code) => wire?.includes(code) === true);
  return known.length > 0 ? known : undefined;
}
