/**
 * ROMAN-ROOM-133 (B30, prototype 70-73): Roman's replies read like prose.
 * Paragraph and bullet blocks from the plain reply, the reading fade for a
 * fresh reply (Reduce Motion: at once), and which reply counts as fresh.
 */
import React from 'react';
import { StyleSheet, type TextStyle } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import RomanMessageBubble, { romanBlocks } from '../RomanMessageBubble';
import { useRomanReveal } from '../useRomanReveal';
import type { RomanMessage } from '../../../api/romanApi';
import { ROMAN_INTERRUPTED_NOTE } from '../romanVoice';

const flat = (node: TestInstance): TextStyle => StyleSheet.flatten(node.props.style) ?? {};
/** Opacity of the nearest wrapper that sets one (the reveal's Animated.View). */
function opacityOf(node: TestInstance): number {
  for (let n: TestInstance | null = node; n; n = n.parent) {
    const o = flat(n).opacity;
    if (typeof o === 'number') return o;
  }
  return 1;
}
const turn = (id: string, role: RomanMessage['role'], content: string): RomanMessage => ({
  id, role, content, interrupted: false, createdAt: '2026-10-08T18:00:00.000Z',
});

it('splits replies into paragraphs and bullets and drops emphasis markers', () => {
  expect(romanBlocks('Your targets are **1,789** calories.\n\n- Protein first.\n• Fat a quarter.\n2. Carbs the rest.\nAim for close.')).toEqual([
    { kind: 'paragraph', text: 'Your targets are 1,789 calories.' },
    { kind: 'bullet', marker: '\u2022', text: 'Protein first.' },
    { kind: 'bullet', marker: '\u2022', text: 'Fat a quarter.' },
    { kind: 'bullet', marker: '2.', text: 'Carbs the rest.' },
    { kind: 'paragraph', text: 'Aim for close.' },
  ]);
});

it.each([
  [true, false, 0],
  [true, true, 1],
  [false, false, 1],
])('reveal %s, Reduce Motion %s: the reply starts at opacity %s', async (reveal, reduceMotion, start) => {
  const r = await render(
    <RomanMessageBubble message={turn('a', 'assistant', 'Close, not perfect.\n\n- One.')} reveal={reveal} reduceMotion={reduceMotion} />,
  );
  expect(opacityOf(r.getByText('Close, not perfect.'))).toBe(start);
  expect(opacityOf(r.getByText('One.'))).toBe(start);
});

it('only the reply that arrives after a send is fresh', async () => {
  const old = turn('a0', 'assistant', 'Earlier reply.');
  const { result, rerender } = await renderHook(
    ({ messages, sending }: { messages: RomanMessage[]; sending: boolean }) => useRomanReveal(messages, sending),
    { initialProps: { messages: [old], sending: false } },
  );
  expect(result.current).toBeNull();
  await rerender({ messages: [old, turn('u1', 'user', "Today's workout")], sending: true });
  expect(result.current).toBeNull();
  const fresh = turn('a1', 'assistant', 'Foundations, session one.');
  await rerender({ messages: [old, turn('u1', 'user', "Today's workout"), fresh], sending: false });
  expect(result.current).toBe('a1');
  // An older page arriving later does not reveal anything new.
  await rerender({ messages: [turn('a-1', 'assistant', 'Older.'), old, fresh], sending: false });
  expect(result.current).toBe('a1');
});

it.each([
  [false, 'Roman said: Close, not perfect.'],
  [true, `Roman said: Close, not perfect. ${ROMAN_INTERRUPTED_NOTE}`],
])('interrupted %s: the reply label a screen reader speaks (B-602-C-1)', async (interrupted, label) => {
  const r = await render(
    <RomanMessageBubble message={{ ...turn('a', 'assistant', 'Close, not perfect.'), interrupted }} testID="t" />,
  );
  expect(r.getByTestId('t-reply').props.accessibilityLabel).toBe(label);
  expect(r.queryByText(ROMAN_INTERRUPTED_NOTE) !== null).toBe(interrupted);
});

it('a send that ends without a reply leaves nothing to reveal', async () => {
  const old = turn('a0', 'assistant', 'Earlier reply.');
  const { result, rerender } = await renderHook(
    ({ messages, sending }: { messages: RomanMessage[]; sending: boolean }) => useRomanReveal(messages, sending),
    { initialProps: { messages: [old], sending: true } },
  );
  await rerender({ messages: [old], sending: false });
  await rerender({ messages: [old, turn('a9', 'assistant', 'From a reload.')], sending: false });
  expect(result.current).toBeNull();
});
