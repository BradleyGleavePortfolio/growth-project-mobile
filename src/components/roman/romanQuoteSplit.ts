/**
 * The split of a sent reply into its quote and the person's words. No imports, so a screen outside
 * Roman (the coach's safety alert) can read it without loading the Roman send path. romanReply re-exports it.
 */
const QUOTED = /^> ([^\n]+)\n\n([\s\S]*\S[\s\S]*)$/;

/** Split a sent reply back into its quote and its text (null when it has no quote). */
export function splitRomanQuote(content: string): { quote: string; body: string } | null {
  const m = QUOTED.exec(content);
  return m ? { quote: m[1].trim(), body: m[2] } : null;
}
