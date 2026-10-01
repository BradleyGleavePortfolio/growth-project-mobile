/**
 * #306 r5 (Opus C-306-4, owner 13:34): every coach notice and every unknown
 * auth failure routes to Support. When live chat is not available in the
 * build (no Crisp website id), the screen says so and offers email, instead
 * of "should open automatically".
 */
delete process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID;

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

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
});
