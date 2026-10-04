/**
 * #306 r5 (Opus C-306-4, owner 13:34): every coach notice and every unknown
 * auth failure routes to Support. When live chat is not available in the
 * build (no Crisp website id), the screen says so and offers email, instead
 * of "should open automatically".
 */
delete process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID;

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockSetString = jest.fn();
jest.mock('expo-clipboard', () => ({ setStringAsync: (...a: unknown[]) => mockSetString(...a) }));

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import SupportInboxScreen from '../SupportInboxScreen';

describe('SupportInboxScreen when live chat is unavailable', () => {
  it('says chat is not available and offers a working email action', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const utils = await render(<SupportInboxScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never} />);
    expect(utils.getByTestId('support-chat-unavailable')).toBeTruthy();
    expect(utils.queryByText(/should open automatically/)).toBeNull();
    expect(utils.queryByTestId('support-chat-open')).toBeNull();
    // S-ERRORS: the one support address (owner ruling 2026-10-01) is shown in words too.
    expect(utils.getByText(/Bradleyapple1031@gmail\.com/)).toBeTruthy();
    await fireEvent.press(utils.getByTestId('support-email'));
    expect(openURL).toHaveBeenCalledWith('mailto:Bradleyapple1031@gmail.com?subject=Support%20request');
  });

  // Linking.openURL is already a jest.fn in the RN preset; spyOn reuses it.
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  // Sol B-324-1: a mail intent that cannot open is never silent.
  it('when no email app opens, says so and offers the selectable address, Copy and Try again', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no mail app'));
    mockSetString.mockRejectedValue(new Error('clipboard unavailable'));
    const utils = await render(<SupportInboxScreen navigation={{ goBack: jest.fn(), navigate: jest.fn() } as never} />);
    expect(utils.queryByTestId('support-email-fallback')).toBeNull();
    await fireEvent.press(utils.getByTestId('support-email'));
    await waitFor(() => utils.getByTestId('support-email-fallback'));
    expect(utils.getByTestId('support-email-fallback-status').props.children).toBe(
      'This phone could not open an email app. Copy the address below and email support from any email app or device.',
    );
    const address = utils.getByTestId('support-email-fallback-address');
    expect(address.props.selectable).toBe(true);
    expect(address.props.children).toBe('Bradleyapple1031@gmail.com');
    // Copy fails too: the user is told to select the address by hand.
    await fireEvent.press(utils.getByTestId('support-email-fallback-copy'));
    await waitFor(() =>
      expect(utils.getByTestId('support-email-fallback-status').props.children).toMatch(/Press and hold the address/),
    );
    // Try again retries the same draft and keeps the fallback while it still fails.
    await fireEvent.press(utils.getByTestId('support-email-fallback-retry'));
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(2));
    expect(openURL).toHaveBeenLastCalledWith('mailto:Bradleyapple1031@gmail.com?subject=Support%20request');
    await waitFor(() =>
      expect(utils.getByTestId('support-email-fallback-status').props.children).toMatch(/could not open an email app/),
    );
  });
});
