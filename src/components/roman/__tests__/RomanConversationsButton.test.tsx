/**
 * Roman chat header entry to "Your conversations with Roman": navigates to
 * the list inside a navigator, and renders nothing outside one (so the chat
 * screen still renders in isolation).
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import RomanConversationsButton from '../RomanConversationsButton';
import { ROMAN_CHATS_COPY } from '../../../screens/settings/romanChatsCopy';

jest.mock('../../../utils/haptics', () => ({ lightTap: jest.fn(), mediumTap: jest.fn(), warningTap: jest.fn(), selectionTap: jest.fn() }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));

it('opens the conversation list, with an accessible label and hint', async () => {
  const navigation = { navigate: jest.fn() };
  const r = await render(
    <NavigationContext.Provider value={navigation as never}>
      <RomanConversationsButton />
    </NavigationContext.Provider>,
  );
  const button = r.getByTestId('roman-conversations-button');
  expect(button.props.accessibilityLabel).toBe(ROMAN_CHATS_COPY.entryLabel);
  expect(button.props.accessibilityHint).toBe(ROMAN_CHATS_COPY.entryHint);
  await fireEvent.press(button);
  expect(navigation.navigate).toHaveBeenCalledWith('RomanConversations');
});

it('renders nothing outside a navigator', async () => {
  const r = await render(<RomanConversationsButton />);
  expect(r.queryByTestId('roman-conversations-button')).toBeNull();
});
