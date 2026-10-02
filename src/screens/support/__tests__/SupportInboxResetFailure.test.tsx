/**
 * #306 fix round 4 (Sol A1-R3): the support screen fails closed. When the
 * chat session of a previous user cannot be reset, the chat is not shown, on
 * mount or from the button; the screen says so and offers a retry.
 */
process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id-123';

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as CrispSDK from 'crisp-sdk-react-native';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import SupportInboxScreen from '../SupportInboxScreen';
import { syncCrispIdentity, __resetCrispOwnerForTests } from '../../../services/support/crisp.service';

const mockShow = CrispSDK.show as jest.Mock;
const mockResetSession = CrispSDK.resetSession as jest.Mock;
const nav = { goBack: jest.fn(), navigate: jest.fn() };

describe('SupportInboxScreen when the session reset fails (Sol A1-R3)', () => {
  beforeEach(() => {
    __resetCrispOwnerForTests();
    jest.clearAllMocks();
    mockResetSession.mockReset();
  });

  it('pre-sign-in: previous user bound, reset throws: no show on mount or from the button; retry opens once the reset works', async () => {
    syncCrispIdentity({ userId: 'previous-user', email: 'previous@example.com' });
    mockResetSession.mockImplementation(() => {
      throw new Error('native reset failed');
    });
    const utils = await render(<SupportInboxScreen navigation={nav as never} preSignIn />);
    expect(mockShow).not.toHaveBeenCalled();
    expect(utils.getByTestId('support-chat-blocked')).toBeTruthy();
    // Manual reopen goes through the same gate.
    await fireEvent.press(utils.getByTestId('support-chat-open'));
    expect(mockShow).not.toHaveBeenCalled();
    mockResetSession.mockImplementation(() => undefined);
    await fireEvent.press(utils.getByTestId('support-chat-open'));
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockResetSession.mock.invocationCallOrder.slice(-1)[0]).toBeLessThan(mockShow.mock.invocationCallOrder[0]);
    expect(utils.queryByTestId('support-chat-blocked')).toBeNull();
  });

  it('signed in: a binding whose reset failed keeps the chat closed until the binding succeeds', async () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    mockResetSession.mockImplementation(() => {
      throw new Error('native reset failed');
    });
    syncCrispIdentity({ userId: 'user-b', email: 'bob@example.com' });
    const utils = await render(<SupportInboxScreen navigation={nav as never} />);
    expect(mockShow).not.toHaveBeenCalled();
    expect(utils.getByTestId('support-chat-blocked')).toBeTruthy();
    mockResetSession.mockImplementation(() => undefined);
    await fireEvent.press(utils.getByTestId('support-chat-open'));
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('copy rules: no exclamation marks in the blocked state', async () => {
    syncCrispIdentity({ userId: 'previous-user', email: 'previous@example.com' });
    mockResetSession.mockImplementation(() => {
      throw new Error('native reset failed');
    });
    const utils = await render(<SupportInboxScreen navigation={nav as never} preSignIn />);
    const text = JSON.stringify(utils.toJSON());
    expect(text).not.toMatch(/!/);
  });
});
