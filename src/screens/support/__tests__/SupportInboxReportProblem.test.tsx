import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import SupportInboxScreen from '../SupportInboxScreen';

const mockOpenChat = jest.fn();
jest.mock('../../../services/support/crisp.service', () => ({
  openSupportChat: (...args: unknown[]) => mockOpenChat(...args),
}));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

const navigation = { goBack: jest.fn() } as NavigationProp<ParamListBase>;

describe('Support problem reporting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenChat.mockReturnValue('opened');
  });
  afterEach(() => jest.restoreAllMocks());

  it('offers email problem reporting even when the SDK says the chat opened', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const screen = await render(<SupportInboxScreen navigation={navigation} />);
    expect(screen.getByTestId('support-chat-open')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Report a problem by email' }));
    expect(openURL).toHaveBeenCalledWith(
      'mailto:Bradleyapple1031@gmail.com?subject=Report%20a%20problem',
    );
  });

  it('offers the existing selectable address and retry if problem reporting cannot open an email app', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    const screen = await render(<SupportInboxScreen navigation={navigation} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Report a problem by email' }));
    await waitFor(() => expect(screen.getByTestId('support-email-fallback')).toBeTruthy());
    expect(screen.getByTestId('support-email-fallback-address').props.selectable).toBe(true);
    expect(screen.getByTestId('support-email-fallback-copy')).toBeTruthy();
    expect(screen.getByTestId('support-email-fallback-retry')).toBeTruthy();
  });
});
