import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import MessageBubble from '../MessageBubble';
import { darkTokens, lightTokens } from '../../../theme/tokens';

let mockSemanticColors = lightTokens;
jest.mock('../../../theme/ThemeProvider', () => ({ useTheme: () => ({ semanticColors: mockSemanticColors }) }));

it.each([lightTokens, darkTokens])('uses semantic colours and preserves long press and quoted-parent actions', async (sc) => {
  mockSemanticColors = sc;
  const onLongPress = jest.fn();
  const onPressParent = jest.fn();
  const message = { id: 'm', body: 'Text', created_at: '2026-10-07T12:00:00Z', edited: true, pinned: true,
    parent: { id: 'p', body: 'Quote', sender_role: 'coach' as const } };
  const u = await render(<MessageBubble message={message} isMe showTimestamp={false} onLongPress={onLongPress} onPressParent={onPressParent} />);
  expect(StyleSheet.flatten(u.getByText('Text').props.style)).toMatchObject({ fontFamily: 'Inter_400Regular', fontSize: 16, color: sc.textPrimary });
  expect(u.getByText(/Pinned\s+Edited/)).toBeTruthy();
  await fireEvent(u.getByLabelText(/Message: Text/), 'longPress');
  expect(onLongPress).toHaveBeenCalledWith(message);
  await fireEvent.press(u.getByLabelText('Replying to: Quote'));
  expect(onPressParent).toHaveBeenCalledWith('p');
});
