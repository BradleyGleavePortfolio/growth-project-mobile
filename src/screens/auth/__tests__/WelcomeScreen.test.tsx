/**
 * Auth WelcomeScreen = prototype 00 AUTH (AUTH-ENTRY-133, B11 B12 B13).
 * Same two actions as before: one filled "Get started" (-> CreateAccount,
 * where the role question comes first) and a "Log in" text link (-> Login).
 * Signup stays open for every role (owner 2026-10-01 13:28): no
 * invitation-only gate and no request-access link.
 */
import React from 'react';
import { Linking, StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { fireEvent, render } from '@testing-library/react-native';
import { lightTokens } from '../../../theme/tokens';

jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => '#000000' }),
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
  }),
}));

import WelcomeScreen from '../WelcomeScreen';

const textOf = (json: unknown) => JSON.stringify(json);

describe('auth WelcomeScreen (prototype 00)', () => {
  it('shows the TGP wordmark, eyebrow, serif title and tagline; never the old GP box', async () => {
    const ui = await render(<WelcomeScreen navigation={{ navigate: jest.fn() } as never} />);
    expect(ui.getByTestId('welcome-wordmark', { includeHiddenElements: true }).props.children).toBe('TGP');
    expect(ui.queryByText('GP')).toBeNull();
    expect(ui.getByText('Personal training, in your pocket')).toBeTruthy();
    const title = StyleSheet.flatten(ui.getByText('The Growth Project').props.style);
    expect(title.fontFamily).toMatch(/^CormorantGaramond/);
    expect(title.lineHeight).toBeGreaterThanOrEqual(1.2 * title.fontSize);
    expect(ui.getByText('A plan, daily targets, and a coach who knows you.')).toBeTruthy();
    expect(ui.queryByText(/invitation only/i)).toBeNull();
    expect(ui.queryByText(/request access/i)).toBeNull();
    expect(textOf(ui.toJSON())).not.toMatch(/!/);
  });

  it('keeps the same two actions: Get started -> CreateAccount (filled), Log in -> Login (link)', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const nav = { navigate: jest.fn() };
    const ui = await render(<WelcomeScreen navigation={nav as never} />);
    const getStarted = ui.getByLabelText('Get started');
    expect(StyleSheet.flatten(getStarted.props.style).backgroundColor).toBe(lightTokens.accent);
    expect(StyleSheet.flatten(ui.getByLabelText('Log in').props.style).backgroundColor).toBeUndefined();
    await fireEvent.press(getStarted);
    expect(nav.navigate).toHaveBeenCalledWith('CreateAccount');
    await fireEvent.press(ui.getByLabelText('Log in'));
    expect(nav.navigate).toHaveBeenCalledWith('Login');
    expect(nav.navigate).toHaveBeenCalledTimes(2);
    expect(ui.queryAllByRole('button').length + ui.queryAllByRole('link').length).toBe(2);
    expect(openURL).not.toHaveBeenCalled();
  });

  it.each([
    ['Android 360x800', { top: 24, bottom: 16, left: 0, right: 0 }],
    ['iPhone 390x844', { top: 47, bottom: 34, left: 0, right: 0 }],
  ])('%s: clears the status bar with breathing room and keeps the footer off the gesture bar', async (_name, insets) => {
    const ui = await render(
      <SafeAreaInsetsContext.Provider value={insets}>
        <WelcomeScreen navigation={{ navigate: jest.fn() } as never} />
      </SafeAreaInsetsContext.Provider>,
    );
    expect(StyleSheet.flatten(ui.getByTestId('welcome').props.style).paddingTop).toBe(insets.top + 12);
    expect(StyleSheet.flatten(ui.getByTestId('welcome-footer').props.style).paddingBottom).toBeGreaterThanOrEqual(
      insets.bottom + 8,
    );
    expect(ui.toJSON()).toMatchSnapshot();
  });
});
