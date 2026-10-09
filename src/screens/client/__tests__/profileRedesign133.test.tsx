/**
 * REDO-SETTINGS-133 (APPLY-PROFILE-133, U2): Profile reads from the semantic
 * theme (no static stone/charcoal/cream), the person's name is the serif h1,
 * the page sits on the shared Screen under the status bar, has a way back, and
 * every corner comes from the radius tokens (owner 17:07, Q10b).
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { layout, lightTokens } from '../../../theme/tokens';
import ProfileScreen from '../ProfileScreen';

const mockGoBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'client', name: 'Avery Stone', email: 'avery@example.test', profile: {} }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }), useFocusEffect: () => undefined,
}));
jest.mock('../../../services/api', () => ({ __esModule: true, default: { get: jest.fn() }, profileApi: { get: jest.fn() } }));
jest.mock('../../../api/macrosApi', () => ({ macrosApi: { currentForSelf: jest.fn() } }));
jest.mock('../../../services/authActions', () => ({ signOut: jest.fn(), prepareSignOutConfirm: jest.fn() }));
jest.mock('../../../hooks/useIdentity', () => ({ useFoundingNumber: () => ({ data: null }) }));
jest.mock('../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../components/community/MilestoneCabinet', () => () => null);

const code = fs.readFileSync(path.join(__dirname, '..', 'ProfileScreen.tsx'), 'utf8');

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

it('uses the theme, not static tokens, and no literal radius or fixed top', () => {
  expect(code).not.toMatch(/colorTokens|colors as colorTokens/);
  expect(code).not.toMatch(/\b(stone|charcoal|cream)\b/);
  expect(code).not.toMatch(/borderRadius:\s*\d/);
  expect(code).not.toMatch(/paddingTop:\s*(5\d|6\d)\b/);
  expect(contrast(lightTokens.textMuted, lightTokens.bgPrimary)).toBeGreaterThanOrEqual(4.5);
});

it.each([[360, 800, 24], [390, 844, 47]])('%ix%i: under the status bar, name as the serif h1, a way back', async (_w, _h, top) => {
  const ui = await render(
    <SafeAreaInsetsContext.Provider value={{ top, bottom: 34, left: 0, right: 0 }}>
      <ProfileScreen />
    </SafeAreaInsetsContext.Provider>,
  );
  expect(StyleSheet.flatten(ui.getByTestId('profile-screen').props.style).paddingTop).toBe(top + layout.statusBarGap);
  const name = StyleSheet.flatten(ui.getByRole('header', { name: 'Avery Stone' }).props.style);
  expect(name.fontFamily).toMatch(/^CormorantGaramond/);
  expect(name.lineHeight).toBeGreaterThanOrEqual(1.2 * name.fontSize);
  expect(StyleSheet.flatten(ui.getAllByText('avery@example.test')[0].props.style).color).toBe(lightTokens.textMuted);
  await fireEvent.press(ui.getByLabelText('Back'));
  expect(mockGoBack).toHaveBeenCalled();
  for (const label of ['Settings', 'My report', 'Shortcuts', 'Learn', 'Edit personal info', 'Sign out']) {
    expect(ui.getByLabelText(label)).toBeTruthy();
  }
});
