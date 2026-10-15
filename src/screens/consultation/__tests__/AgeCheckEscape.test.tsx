/**
 * FIXAGE R4: "a client the age gate refuses can still sign out, contact
 * support, delete their account or download their data." From the age step
 * and from its under-16 stop screen: Sign out (with its confirm) signs out,
 * and Delete my account reaches the real deletion screen and comes back.
 * Real stack navigator, real AgeCheckScreen, real DeleteAccountScreen.
 */
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  profileApi: { update: jest.fn() },
  deletionApi: { getDeletionStatus: jest.fn(async () => ({ data: null })) },
  isAccountDeletedError: () => false,
}));
jest.mock('../../../services/authActions', () => ({ signOut: jest.fn(async () => undefined) }));
jest.mock('../../../utils/authProviders', () => ({ getSignInProviders: jest.fn(async () => ['email']) }));
jest.mock('../../../utils/appleAuth', () => ({ isAppleAuthAvailable: jest.fn(async () => false), reauthenticateWithApple: jest.fn() }));
jest.mock('../../../utils/googleReauth', () => ({ reauthenticateWithGoogle: jest.fn() }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'c1', email: 'c1@example.test', role: 'student' }) }));
jest.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));

import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { fireEvent, render } from '@testing-library/react-native';
import { AgeCheckNavigator } from '../AgeCheckScreen';
import { signOut } from '../../../services/authActions';

type R = Awaited<ReturnType<typeof render>>;
const STATES: Array<[string, (r: R) => Promise<void>]> = [
  ['the age step', async (r) => expect(r.getByTestId('consult-screen-B2')).toBeTruthy()],
  ['the under-16 stop screen', async (r) => {
    for (let i = 0; i < 16; i += 1) {
      await fireEvent(r.getByTestId('wheel-dob-year'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    }
    await fireEvent.press(r.getByTestId('consult-continue'));
    expect(r.getByTestId('consult-screen-UNDER_AGE')).toBeTruthy();
  }],
];

let alert: jest.SpyInstance;
beforeEach(() => {
  (signOut as jest.Mock).mockClear();
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each(STATES)('from %s: Sign out signs out; Delete my account opens the real deletion screen', async (state, reach) => {
  const r = await render(
    <NavigationContainer>
      <AgeCheckNavigator onConfirmed={jest.fn()} onSignOut={() => void signOut()} />
    </NavigationContainer>,
  );
  await reach(r);
  expect(r.getByText('Contact support')).toBeTruthy();
  expect(r.getByText('Download my data')).toBeTruthy();
  await fireEvent.press(r.getByTestId('consult-sign-out'));
  const [title, body, buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
  expect([title, body]).toEqual([
    'Sign out?',
    'Answers that have not reached the server yet are removed from this phone. You can sign in again at any time.',
  ]);
  buttons.find((b) => b.text === 'Sign out')?.onPress?.();
  expect(signOut).toHaveBeenCalledTimes(1);
  await fireEvent.press(r.getByTestId('age-delete-account'));
  await r.findByText('Delete account');
  await fireEvent.press(r.getByLabelText('Go back'));
  expect(r.getByTestId(state === 'the age step' ? 'consult-screen-B2' : 'consult-screen-UNDER_AGE')).toBeTruthy();
});
