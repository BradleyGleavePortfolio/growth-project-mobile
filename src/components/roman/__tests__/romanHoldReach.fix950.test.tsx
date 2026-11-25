/**
 * FIX-950R1 (agent 202) for m#950, LS-950 B2 class-first: every Roman reply's hold target is at
 * least 44 pt tall at 100% and 130% text, whatever its shape (one short line, one bullet, an
 * interrupted reply), and the reach never leaves the reply's own row: it sits in the speaker gap
 * above and the row's bottom padding below, so nothing drawn moves and Android delivers the touch.
 * The one Pressable serves every loaded reply (older pages use the same renderItem).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import RomanMessageBubble, { HOLD_SLOP, ROMAN_READING } from '../RomanMessageBubble';
import type { RomanMessage } from '../../../api/romanApi';

const reply = (content: string, interrupted = false): RomanMessage => ({
  id: 'r-short', role: 'assistant', content, interrupted, createdAt: '2026-11-06T10:00:05Z',
});

const SHAPES: Array<[string, RomanMessage]> = [
  ['a one-word reply', reply('Yes.')],
  ['a one-line bullet', reply('- Rest today.')],
  ['an interrupted one-liner', reply('Sure', true)],
];
const SCALES = [1, 1.3];

const flat = (s: unknown) => StyleSheet.flatten(typeof s === 'function' ? s({ pressed: false }) : s) ?? {};

describe.each(SHAPES)('FIX-950R1 B2: %s', (_name, message) => {
  it.each(SCALES)('has a hold target of at least 44 pt at font scale %s', async (fontScale) => {
    const r = await render(<RomanMessageBubble message={message} onLongPress={() => undefined} reduceMotion testID="m" />);
    const target = r.getByTestId('m-reply');
    const style = flat(target.props.style);
    const pad = (style.paddingTop ?? style.paddingVertical ?? 0) + (style.paddingBottom ?? style.paddingVertical ?? 0);
    // The shortest a reply can be: one reading line (lineHeight scales with the text size).
    const drawn = Math.max(style.minHeight ?? 0, ROMAN_READING.lineHeight * fontScale + pad);
    const slop = target.props.hitSlop;
    expect(slop).toEqual(HOLD_SLOP);
    expect(drawn + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
  });

  it('reaches only into its own row (speaker gap above, bottom padding below)', async () => {
    const r = await render(<RomanMessageBubble message={message} onLongPress={() => undefined} reduceMotion testID="m" />);
    const row = flat(r.getByTestId('m').props.style);
    const slop = r.getByTestId('m-reply').props.hitSlop;
    expect(slop.top).toBeLessThanOrEqual(row.gap);
    expect(slop.bottom).toBeLessThanOrEqual(row.paddingBottom);
    expect(slop.left).toBe(0);
    expect(slop.right).toBe(0);
  });
});

it('FIX-950R1 B2: a reply with no hold (the coach room, the person\'s own turn) gets no reach', async () => {
  const r = await render(<RomanMessageBubble message={reply('Yes.')} reduceMotion testID="m" />);
  expect(r.getByTestId('m-reply').props.hitSlop).toBeUndefined();
});
