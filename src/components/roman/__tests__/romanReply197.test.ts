/**
 * ROMAN-HOLD-M (#197-D3): the quote a Reply puts in front of the next message to Roman stays
 * one short line, never pushes the message past the 8000-character send cap, and reads back
 * into the quote strip; local stand-in ids are not reportable.
 */
import { ROMAN_MESSAGE_MAX_LENGTH } from '../../../api/romanApi';
import { ROMAN_QUOTE_MAX, isLocalRomanId, romanQuoteExcerpt, splitRomanQuote, withRomanQuote } from '../romanReply';

describe('romanReply', () => {
  it('quotes one line of the reply, bold marks and line breaks removed', () => {
    expect(withRomanQuote('Keep it **easy**.\n\nTalk pace.', ' Indoors? ')).toBe('> Keep it easy. Talk pace.\n\nIndoors?');
  });

  it('cuts a long reply to the quote limit with an ellipsis', () => {
    const q = romanQuoteExcerpt('word '.repeat(100));
    expect(q.length).toBeLessThanOrEqual(ROMAN_QUOTE_MAX);
    expect(q.endsWith('\u2026')).toBe(true);
  });

  it('never sends more than the cap: the quote shrinks, then goes', () => {
    const long = 'a'.repeat(ROMAN_MESSAGE_MAX_LENGTH - 50);
    const sent = withRomanQuote('word '.repeat(100), long);
    expect(sent.length).toBeLessThanOrEqual(ROMAN_MESSAGE_MAX_LENGTH);
    expect(sent.startsWith('> ')).toBe(true);
    const full = 'b'.repeat(ROMAN_MESSAGE_MAX_LENGTH);
    expect(withRomanQuote('Keep it easy.', full)).toBe(full);
  });

  it('an empty draft is passed through untouched (the send guard turns it away)', () => {
    expect(withRomanQuote('Keep it easy.', '   ')).toBe('   ');
  });

  it('reads a sent reply back into quote and text; plain text has no quote', () => {
    expect(splitRomanQuote(withRomanQuote('Keep it easy.', 'Indoors?'))).toEqual({ quote: 'Keep it easy.', body: 'Indoors?' });
    expect(splitRomanQuote('Indoors?')).toBeNull();
    expect(splitRomanQuote('> just a quote')).toBeNull();
    expect(splitRomanQuote('> quote\n\n   ')).toBeNull();
  });

  it('only server ids are reportable', () => {
    expect(isLocalRomanId('optimistic-1')).toBe(true);
    expect(isLocalRomanId('assistant-1')).toBe(true);
    expect(isLocalRomanId('cm3x9k2l0000abcd')).toBe(false);
  });
});
