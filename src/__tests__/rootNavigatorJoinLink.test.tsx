/**
 * RootNavigator — `/join/<code>` deep-link stash path (production-faithful).
 *
 * This is the end-to-end regression for the original orphan bug: the deep-link
 * handler wrote the invite code under one key while the home banner read a
 * different key, so the code was silently dropped. Unlike the helper-level unit
 * test (pendingInviteCode.test.ts), this test drives the REAL RootNavigator URL
 * effect against the REAL stash/read helpers and the REAL in-memory
 * AsyncStorage, so a future divergence between the writer's and reader's key
 * derivation fails HERE — at the exact seam that shipped the bug.
 *
 * It also pins the auth gate: RootNavigator stashes a `/join` code ONLY when a
 * Supabase token is present, so an unauthenticated (or signed-out) link never
 * writes to a user's scope.
 *
 * NOTE: we deliberately do NOT mock @react-native-async-storage/async-storage
 * here — jest.setup.js installs the library's in-memory jest mock, and we want
 * the write and the read to hit the same real store.
 */

const mockSignOut = jest.fn(async (..._args: unknown[]) => {});
jest.mock('../services/authActions', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

const mockSecureGet = jest.fn();
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: (...args: unknown[]) => mockSecureGet(...args),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

type UrlListener = (event: { url: string }) => void;
let mockUrlListener: UrlListener | null = null;
let mockGetInitialUrlResolver: ((u: string | null) => void) | null = null;
jest.mock('react-native/Libraries/Linking/Linking', () => ({
  __esModule: true,
  default: {
    getInitialURL: jest.fn(
      () =>
        new Promise<string | null>((resolve) => {
          mockGetInitialUrlResolver = resolve;
        }),
    ),
    addEventListener: jest.fn((event: string, cb: UrlListener) => {
      if (event === 'url') mockUrlListener = cb;
      return { remove: jest.fn(() => { mockUrlListener = null; }) };
    }),
    openURL: jest.fn(async () => true),
  },
}));

jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: jest.fn(),
      resetRoot: jest.fn(),
      current: null,
    }),
  };
});

jest.mock('../navigation/AuthNavigator', () => () => null);
jest.mock('../navigation/ClientNavigator', () => () => null);
jest.mock('../navigation/CoachNavigator', () => () => null);
jest.mock('../navigation/OnboardingNavigator', () => () => null);
jest.mock('../navigation/LeanOnboardingNavigator', () => () => null);
jest.mock('../components/OfflineBanner', () => () => null);
jest.mock('../screens/client/Day1WinScreen', () => () => null);
jest.mock('../services/support/crisp.service', () => ({
  initCrisp: jest.fn(),
  syncCrispIdentity: jest.fn(),
}));
jest.mock('../hooks/useLeanOnboardingReconcile', () => ({
  useLeanOnboardingReconcile: jest.fn(),
}));
jest.mock('../services/firstWinApi', () => ({
  firstWinApi: { getStatus: jest.fn().mockResolvedValue({ data: { completed: true } }) },
  WinType: {},
}));
jest.mock('../services/foodLogQueue', () => ({
  flush: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
  isEffectivelyOnline: () => true,
}));
jest.mock('../utils/authEvents', () => ({
  authEvents: { onAuthChange: jest.fn(() => () => {}) },
}));
jest.mock('../screenshots', () => ({ isScreenshotMode: () => false }));

import React from 'react';
import { render, act, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readPendingInviteCode } from '../lib/pendingInviteCode';
import { setUserCache, clearUserCache } from '../lib/userCache';

// IMPORTANT: import RootNavigator AFTER the jest.mock calls above.
import RootNavigator from '../navigation/RootNavigator';

const scopedKey = (scope: string) => `pending_invite_code:${scope}`;

describe('RootNavigator — /join/<code> stash → banner reader', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockUrlListener = null;
    mockGetInitialUrlResolver = null;
    await AsyncStorage.clear();
    clearUserCache();
  });

  it('signed-in: stashes the code under the SAME user-scoped key the banner reader consumes', async () => {
    // Canonical production identity: MMKV auth.user_data populated.
    setUserCache({ id: 'user-123', email: 'user-123@example.com' });
    mockSecureGet.mockImplementation(async (key: string) =>
      key === 'supabase_token' ? 'jwt-signed-in' : null,
    );

    await render(<RootNavigator />);
    await act(async () => {
      mockGetInitialUrlResolver?.(null);
    });
    await waitFor(() => expect(mockUrlListener).not.toBeNull());

    await act(async () => {
      mockUrlListener!({ url: 'https://app.trygrowthproject.com/join/GROWTH-1' });
    });

    // The physical key written by the navigator is the one the reader derives.
    // If writer/reader ever diverge again, both assertions fail here.
    await waitFor(async () =>
      expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBe('GROWTH-1'),
    );
    expect(await readPendingInviteCode()).toBe('GROWTH-1');
    expect(await AsyncStorage.getItem(scopedKey('anonymous'))).toBeNull();
  });

  it('unauthenticated: does NOT stash even when an identity is cached (auth gate)', async () => {
    // Identity is resolvable (cache lingering) but the Supabase token is gone,
    // so RootNavigator must not run the stash branch — proving the write is
    // gated on authentication, not merely on identity resolution.
    setUserCache({ id: 'user-123', email: 'user-123@example.com' });
    mockSecureGet.mockImplementation(async () => null);

    await render(<RootNavigator />);
    await act(async () => {
      mockGetInitialUrlResolver?.('tgp://join/GATED-CODE');
    });
    await waitFor(() => expect(mockUrlListener).not.toBeNull());
    await act(async () => {
      mockUrlListener!({ url: 'tgp://join/GATED-CODE' });
    });

    expect(await AsyncStorage.getItem(scopedKey('user-123'))).toBeNull();
    expect(await readPendingInviteCode()).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
