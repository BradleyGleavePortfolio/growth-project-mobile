/**
 * B-TEST LS-950 B2: a short Roman reply must still provide a 44pt hold area.
 * The portrait, speaker row, outer padding and row gaps are not inside this
 * Pressable. Check the real bubble directly, without FlatList virtualization.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import RomanMessageBubble from '../RomanMessageBubble';
import type { RomanMessage } from '../../../api/romanApi';

const shortReply: RomanMessage = {
  id: 'short-reply', role: 'assistant', content: 'Yes.', interrupted: false,
  createdAt: '2026-11-06T10:00:05Z',
};

it.each([1, 1.3])('B-TEST LS-950 B2: a one-line Roman reply has a 44pt hold target at font scale %s', async (fontScale) => {
  const r = await render(
    <RomanMessageBubble message={shortReply} onLongPress={() => undefined} reduceMotion testID="short" />,
  );
  const reply = r.getByTestId('short-reply');
  const prop = reply.props.style;
  const style = StyleSheet.flatten(typeof prop === 'function' ? prop({ pressed: false }) : prop) ?? {};
  const textStyle = StyleSheet.flatten(r.getByText('Yes.').props.style);
  const vertical = (style.paddingTop ?? style.paddingVertical ?? style.padding ?? 0)
    + (style.paddingBottom ?? style.paddingVertical ?? style.padding ?? 0);
  const height = Math.max(style.minHeight ?? 0, style.height ?? 0, textStyle.lineHeight * fontScale + vertical);
  const slop = reply.props.hitSlop ?? 0;
  const extra = typeof slop === 'number' ? slop * 2 : (slop.top ?? 0) + (slop.bottom ?? 0);

  expect(height + extra).toBeGreaterThanOrEqual(44);
});
