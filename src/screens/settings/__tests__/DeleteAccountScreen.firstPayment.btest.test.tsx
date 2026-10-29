/**
 * LS-898R3: deletion completion must retire the deleted coach's local marker,
 * without undoing the ordinary sign-out once-only rule for a living account.
 * Real deletion screen, signOut, firstPaymentGate and storage wrappers.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { render, waitFor } from '@testing-library/react-native';
import DeleteAccountScreen from '../DeleteAccountScreen';
import { signOut } from '../../../services/authActions';
import { authEvents } from '../../../utils/authEvents';
import {
  hasSeenFirstPayment,
  markFirstPaymentSeen,
} from '../../coach/ed/firstPaymentGate';

jest.mock('../../../services/api', () => ({
  deletionApi: {
    getDeletionStatus: jest.fn(async () => ({ data: { state: 'deleted' } })),
  },
  isAccountDeletedError: () => false,
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock('../../../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'coach-deleted', role: 'coach', name: 'Coach' }),
}));
jest.mock('../../../lib/userCache', () => ({
  readUserCacheSync: () => ({ id: 'coach-deleted' }),
  readUserCache: async () => ({ id: 'coach-deleted' }),
  clearUserCache: async () => undefined,
}));
jest.mock('../../../services/sentry', () => ({ setSentryUser: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({ reset: jest.fn() }));
jest.mock('../../../offline/sync/sync-engine', () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));
jest.mock('../../../utils/googleReauth', () => ({
  reauthenticateWithGoogle: jest.fn(),
}));
jest.mock('../../../utils/authProviders', () => ({
  getSignInProviders: jest.fn(async () => ['email']),
}));
jest.mock('../../../utils/appleAuth', () => ({
  isAppleAuthAvailable: jest.fn(async () => false),
  reauthenticateWithApple: jest.fn(),
}));
jest.mock('../../../utils/haptics', () => ({
  warningTap: jest.fn(),
  successTap: jest.fn(),
}));
jest.mock('expo-font', () => ({ isLoaded: () => true, loadAsync: jest.fn() }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({
    semanticColors: jest.requireActual('../../../theme/tokens').lightTokens,
    colors: {
      background: '#F7FAF7',
      surface: '#F1E8D5',
      surfaceElevated: '#E8DCC8',
      textPrimary: '#1A1A18',
      textSecondary: '#5C5C5A',
      textMuted: '#6B675F',
      textOnPrimary: '#F7FAF7',
      primary: '#2C4A36',
      primaryDark: '#1E3326',
      border: '#D9CEBC',
      error: '#4A0404',
      warning: '#C5A253',
      success: '#2C4A36',
      divider: '#E8DCC8',
    },
  }),
}));

const key = (id: string) => `roman.ed3.first-payment-seen.${id}`;
const navigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
} as unknown as React.ComponentProps<typeof DeleteAccountScreen>['navigation'];

beforeEach(async () => {
  await AsyncStorage.clear();
});

it('control: ordinary sign-out preserves each coach marker and clears private session data', async () => {
  await markFirstPaymentSeen('coach-deleted');
  await markFirstPaymentSeen('coach-other');
  await AsyncStorage.setItem('pending_invite_code', 'private');
  await signOut('coach-deleted');
  expect(await hasSeenFirstPayment('coach-deleted')).toBe(true);
  expect(await hasSeenFirstPayment('coach-other')).toBe(true);
  expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
});

it('B-LS898R3-1: confirmed account deletion removes only the deleted coach marker from this phone', async () => {
  await markFirstPaymentSeen('coach-deleted');
  await markFirstPaymentSeen('coach-other');
  await AsyncStorage.setItem('pending_invite_code', 'private');
  expect(await AsyncStorage.getItem(key('coach-deleted'))).toBe('true');

  const loggedOut = jest.fn();
  authEvents.on('logout', loggedOut);
  try {
    const screen = await render(<DeleteAccountScreen navigation={navigation} />);
    await waitFor(() => expect(screen.getByTestId('deletion-complete')).toBeTruthy());
    await waitFor(() => expect(loggedOut).toHaveBeenCalledTimes(1));
    // Cleanup really ran; neither a mocked signOut nor an early assertion.
    expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
    expect(await AsyncStorage.getItem(key('coach-other'))).toBe('true');
    expect(await AsyncStorage.getItem(key('coach-deleted'))).toBeNull();
  } finally {
    authEvents.off('logout', loggedOut);
  }
});
