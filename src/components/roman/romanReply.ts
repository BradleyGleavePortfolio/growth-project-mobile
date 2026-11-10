/**
 * romanReply: press and hold on one of Roman's replies (ROMAN-HOLD-M, owner
 * #197-D3, server half backend #1223).
 *
 * Reply quotes the held reply into the next message to Roman. The Roman send
 * route takes text only (SendMessageDto.content, 8000 characters), so the quote
 * travels as the first line of that text, in the markdown quote form Roman
 * already reads: "> excerpt", a blank line, then what the person wrote. The
 * person's bubble shows that line as a quote strip, not as raw "> " text.
 */
import { ROMAN_MESSAGE_MAX_LENGTH } from '../../api/romanApi';

/** The quoted excerpt is at most this many characters (a reminder, not a copy). */
export const ROMAN_QUOTE_MAX = 200;

/** Local stand-ins (useRomanChat) have no server id yet, so they cannot be reported. */
export function isLocalRomanId(id: string): boolean {
  return id.startsWith('optimistic-') || id.startsWith('assistant-');
}

/** One line, at most `max` characters, ending in an ellipsis when cut. */
export function romanQuoteExcerpt(content: string, max: number = ROMAN_QUOTE_MAX): string {
  const line = content.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  return `${line.slice(0, Math.max(0, max - 1)).trimEnd()}\u2026`;
}

/**
 * The text sent to Roman for a reply. The quote shrinks so the whole message
 * stays within the send cap; a draft that leaves no room goes without it.
 */
export function withRomanQuote(quoted: string, text: string): string {
  const body = text.trim();
  if (body === '') return text;
  const room = ROMAN_MESSAGE_MAX_LENGTH - body.length - 4; // "> " + "\n\n"
  const excerpt = romanQuoteExcerpt(quoted, Math.min(ROMAN_QUOTE_MAX, room));
  if (room < 1 || excerpt === '') return body;
  return `> ${excerpt}\n\n${body}`;
}

export { splitRomanQuote } from './romanQuoteSplit';
