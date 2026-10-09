/**
 * REDO-SETTINGS-133 (APPLY-SETTINGS-133, part 2): client Settings sits on the
 * shared Screen under the status bar, its section titles use the 11 pt
 * Overline token, corners come from the radius tokens (owner 17:07, Q10b) and
 * the serif title keeps an open line box (B15). Decision 133-14: the Add a
 * coach code row shows only for a client without a coach.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { layout, typography } from '../../../../theme/tokens';
import SettingsScreen from '../../SettingsScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockUser: { id: string; name: string; email: string; coach_id?: string } = { id: 'u', name: 'Alex', email: 'alex@example.com' };
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../day-one/answers', () => ({ readDayOneAnswers: jest.fn(async () => null) }));
jest.mock('../../../../services/api', () => ({
  profileApi: { update: jest.fn(async () => ({})) },
  notificationsApi: { updatePreferences: jest.fn(async () => ({})), getPreferences: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../../services/authActions', () => ({ signOut: jest.fn(), refreshProfile: jest.fn(),
  prepareSignOutConfirm: jest.fn(async () => null) }));
jest.mock('../../../../hooks/useBiometricGate', () => ({
  isBiometricSupportedOnDevice: jest.fn(async () => false), getBiometricOptIn: jest.fn(async () => false),
  setBiometricOptIn: jest.fn(async () => {}),
}));
jest.mock('../ClientTutorialSetting', () => () => null);
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));

const DIR = path.resolve(__dirname, '../..');
const navigation = { goBack: jest.fn(), navigate: jest.fn() } as unknown as NavigationProp<ParamListBase>;

it.each(['SettingsScreen.tsx', 'settings/SettingsSection.tsx'])('%s: no fixed top, literal radius or RN SafeAreaView', (f) => {
  const code = fs.readFileSync(path.join(DIR, f), 'utf8');
  expect(code).not.toMatch(/paddingTop:\s*(5\d|6\d)\b/);
  expect(code).not.toMatch(/borderRadius:\s*\d/);
  expect(code).not.toMatch(/SafeAreaView[^;]*from 'react-native'/);
  expect(code).not.toMatch(/fontSize:\s*13,\s*lineHeight:\s*18/);
});

it.each([[360, 800, 24], [390, 844, 47]])('%ix%i: under the status bar, serif title, overline sections', async (_w, _h, top) => {
  const ui = await render(
    <SafeAreaInsetsContext.Provider value={{ top, bottom: 34, left: 0, right: 0 }}>
      <SettingsScreen navigation={navigation} />
    </SafeAreaInsetsContext.Provider>,
  );
  expect(StyleSheet.flatten(ui.getByTestId('settings-screen').props.style).paddingTop).toBe(top + layout.statusBarGap);
  const title = StyleSheet.flatten(ui.getByRole('header', { name: 'Settings' }).props.style);
  expect(title.fontFamily).toMatch(/^CormorantGaramond/);
  expect(title.lineHeight).toBeGreaterThanOrEqual(1.2 * title.fontSize);
  const section = StyleSheet.flatten(ui.getByRole('header', { name: 'Privacy and data' }).props.style);
  expect(section.fontSize).toBe(typography.eyebrow.fontSize);
  expect(ui.getByLabelText('Trust & Privacy, How your data is protected.')).toBeTruthy();
});

it.each([[undefined, true], ['coach-1', false]])('Add a coach code row (coach_id %s) shown: %s', async (coachId, shown) => {
  mockUser = { id: 'u', name: 'Alex', email: 'alex@example.com', ...(coachId ? { coach_id: coachId } : {}) };
  const ui = await render(<SettingsScreen navigation={navigation} />);
  if (!shown) {
    expect(ui.queryByTestId('settings-add-coach-code')).toBeNull();
    return;
  }
  await fireEvent.press(ui.getByTestId('settings-add-coach-code'));
  expect(navigation.navigate).toHaveBeenCalledWith('AddCoachCode');
});
