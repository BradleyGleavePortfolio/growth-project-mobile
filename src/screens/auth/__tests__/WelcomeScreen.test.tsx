/**
 * Auth WelcomeScreen (#306 r5, owner 2026-10-01 13:28): signup is open for
 * every role, so the first screen no longer says "By invitation only" and
 * has no request-access link; a coach code is optional.
 */
import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import WelcomeScreen from '../WelcomeScreen';

describe('auth WelcomeScreen', () => {
  it('says the code is optional and has no invitation-only gate or request-access link', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const nav = { navigate: jest.fn() };
    const utils = await render(<WelcomeScreen navigation={nav as never} />);
    expect(utils.getByTestId('welcome-optional-code-note').props.children).toBe(
      'Have a code from your coach? You can add it now or later.',
    );
    expect(utils.queryByText(/invitation only/i)).toBeNull();
    expect(utils.queryByText(/request access/i)).toBeNull();
    expect(utils.queryByLabelText('Request access by email')).toBeNull();
    await fireEvent.press(utils.getByLabelText('Get started'));
    expect(nav.navigate).toHaveBeenCalledWith('CreateAccount');
    await fireEvent.press(utils.getByLabelText('Log in'));
    expect(nav.navigate).toHaveBeenCalledWith('Login');
    expect(openURL).not.toHaveBeenCalled();
  });

  it('shipped copy has no exclamation marks', async () => {
    const utils = await render(<WelcomeScreen navigation={{ navigate: jest.fn() } as never} />);
    expect(JSON.stringify(utils.toJSON())).not.toMatch(/!/);
  });
});
