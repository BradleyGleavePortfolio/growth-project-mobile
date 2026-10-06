/**
 * Fix round #304 C2 (Opus): the Membership screen's website link reads as
 * steering to an external purchase from a billing context (Guideline 3.1.1)
 * and is not the permitted 1:1 coaching path. Real gate, __DEV__ false.
 */
import React from 'react';
import { Linking, Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockState: { flag: boolean; build: string | null } = { flag: true, build: '6' };
jest.mock('../config/featureFlags', () => {
  const actual = jest.requireActual('../config/featureFlags');
  return {
    ...actual,
    featureFlags: new Proxy(actual.featureFlags, {
      get: (t, k) => (k === 'iosHideNonP2PPurchases' ? mockState.flag : (t as Record<string | symbol, unknown>)[k]),
    }),
  };
});
jest.mock('expo-application', () => ({
  get nativeBuildVersion() {
    return mockState.build;
  },
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  selectionAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }),
}));
jest.mock('../hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ id: 'u1', coach_id: 'c1', createdAt: '2026-01-01T00:00:00Z' }),
}));
jest.mock('../services/api', () => ({
  aiApi: { getStructuredContext: jest.fn(async () => ({ data: { coach: { name: 'Dana' } } })) },
  usersApi: { getFoundingNumber: jest.fn(async () => ({ data: null })) },
}));
jest.mock('../theme/ThemeProvider', () => {
  const realTokens = jest.requireActual('../theme/tokens').default;
  return {
    useTheme: () => ({
      colors: new Proxy({}, { get: () => '#2C4A36' }),
      tokens: realTokens,
      semanticColors: realTokens.lightTokens,
      colorScheme: 'light',
    }),
  };
});

import MembershipScreen from '../screens/client/MembershipScreen';

const realOS = Platform.OS;
const g = globalThis as { __DEV__?: boolean };
const realDev = g.__DEV__;
function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

beforeEach(() => {
  g.__DEV__ = false;
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => {
  setOS(realOS);
  g.__DEV__ = realDev;
  jest.restoreAllMocks();
});

describe('MembershipScreen website link', () => {
  it('is absent on a hidden iOS build; Message your coach stays', async () => {
    setOS('ios');
    mockState.flag = true;
    const r = await render(<MembershipScreen />);
    await waitFor(() => expect(r.getByLabelText('Message your coach')).toBeTruthy());
    expect(r.queryByTestId('membership-website-link')).toBeNull();
    expect(r.queryByText(/trygrowthproject\.com/)).toBeNull();
  });

  it('is absent on iOS native build 6 even when an OTA bundle flips the flag off', async () => {
    setOS('ios');
    mockState.flag = false;
    mockState.build = '6';
    const r = await render(<MembershipScreen />);
    await waitFor(() => expect(r.getByLabelText('Message your coach')).toBeTruthy());
    expect(r.queryByTestId('membership-website-link')).toBeNull();
  });

  it('is still shown on Android', async () => {
    setOS('android');
    mockState.flag = true;
    const r = await render(<MembershipScreen />);
    await waitFor(() => expect(r.getByTestId('membership-website-link')).toBeTruthy());
  });

  it('on Android opens the contact support page, not the bare site root (HUNT-09-124)', async () => {
    setOS('android');
    mockState.flag = true;
    const r = await render(<MembershipScreen />);
    await waitFor(() => expect(r.getByTestId('membership-website-link')).toBeTruthy());
    expect(r.getByText('Contact support')).toBeTruthy();
    await fireEvent.press(r.getByTestId('membership-website-link'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://app.trygrowthproject.com/help/contact');
  });
});
