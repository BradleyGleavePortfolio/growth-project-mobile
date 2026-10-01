/**
 * #306 fix round 3 (Opus C2): the support screen is reachable before sign-in
 * (AuthNavigator). There it must reset the chat session before opening it, so
 * a previous user's conversation on a shared device is never shown.
 */
process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id-123';

import React from 'react';
import { render } from '@testing-library/react-native';
import * as CrispSDK from 'crisp-sdk-react-native';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import * as fs from 'fs';
import * as path from 'path';
import SupportInboxScreen from '../SupportInboxScreen';
import { PreSignInSupportInbox } from '../../../navigation/AuthNavigator';
import { syncCrispIdentity, __resetCrispOwnerForTests } from '../../../services/support/crisp.service';

const mockShow = CrispSDK.show as jest.Mock;
const mockResetSession = CrispSDK.resetSession as jest.Mock;
const nav = { goBack: jest.fn(), navigate: jest.fn() };

describe('SupportInboxScreen before sign-in', () => {
  beforeEach(() => {
    __resetCrispOwnerForTests();
    jest.clearAllMocks();
  });

  it('pre-sign-in: a previous user\'s session is reset before the chat opens', async () => {
    syncCrispIdentity({ email: 'previous@example.com' });
    mockResetSession.mockClear();
    await render(<SupportInboxScreen navigation={nav as never} preSignIn />);
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockResetSession.mock.invocationCallOrder[0]).toBeLessThan(mockShow.mock.invocationCallOrder[0]);
  });

  it('signed in (Settings > Support): the user\'s own session is kept', async () => {
    syncCrispIdentity({ email: 'me@example.com' });
    mockResetSession.mockClear();
    await render(<SupportInboxScreen navigation={nav as never} />);
    expect(mockResetSession).not.toHaveBeenCalled();
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('the auth stack registers the pre-sign-in variant', async () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../navigation/AuthNavigator.tsx'), 'utf8');
    expect(src).toMatch(/name="SupportInbox" component=\{PreSignInSupportInbox\}/);
    syncCrispIdentity({ email: 'previous@example.com' });
    mockResetSession.mockClear();
    await render(<PreSignInSupportInbox navigation={nav as never} />);
    expect(mockResetSession).toHaveBeenCalledTimes(1);
  });
});
