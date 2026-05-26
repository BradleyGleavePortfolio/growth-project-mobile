/**
 * RootNavigator — accept-invite deep-link replay guard.
 *
 * Covers:
 *   - extractAcceptInviteToken parses both tgp:// and https:// shapes,
 *     decodes percent-encoded tokens, and returns null for non-accept URLs.
 *   - The replay path is guarded against double-consume: firing the same
 *     accept-invite URL twice MUST NOT navigate twice and MUST NOT call
 *     signOut twice. This regression-tests the audit's P1 loop where the
 *     prior implementation re-stashed the URL via Linking.openURL.
 *
 * The integration test below renders a thin harness that exercises the
 * URL-handling effect inside RootNavigator without booting the entire
 * authenticated/unauthenticated navigator tree (which would require
 * substantial mocking of unrelated screens).
 */

import { extractAcceptInviteToken } from '../navigation/RootNavigator';

describe('extractAcceptInviteToken', () => {
  it('parses the custom-scheme accept URL', () => {
    expect(
      extractAcceptInviteToken('tgp://invite/accept/abcd-1234'),
    ).toBe('abcd-1234');
  });

  it('parses the universal-link accept URL', () => {
    expect(
      extractAcceptInviteToken(
        'https://app.trygrowthproject.com/invite/accept/abcd-1234',
      ),
    ).toBe('abcd-1234');
  });

  it('decodes percent-encoded tokens', () => {
    expect(
      extractAcceptInviteToken('tgp://invite/accept/abc%2D123'),
    ).toBe('abc-123');
  });

  it('returns null for non-accept URLs', () => {
    expect(extractAcceptInviteToken('tgp://join/somecode')).toBeNull();
    expect(extractAcceptInviteToken('tgp://reset-password#x=1')).toBeNull();
    expect(extractAcceptInviteToken('https://example.com/foo')).toBeNull();
  });

  it('returns null on a malformed percent-encoding', () => {
    expect(
      extractAcceptInviteToken('tgp://invite/accept/%E0%A4%A'),
    ).toBeNull();
  });
});

// -------- Integration test: replay-loop guard ------------------------------
//
// We render the real RootNavigator but mock every collaborator the URL
// handler touches: secureStorage, signOut, the React Native Linking
// module, and the navigation containers it wraps. The harness then
// simulates the two URL events that produced the audit's loop:
//
//   1. signed-in user clicks accept link → handleUrl fires → signOut +
//      pendingAcceptUrl stashed. Auth flips to unauthenticated and the
//      replay effect navigates AcceptInvite ONCE.
//   2. The same URL fires a second time (legacy Linking.openURL replay,
//      or a duplicate cold-start + foreground delivery). The consumed
//      token ref MUST suppress a second navigate and a second signOut.

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

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

type UrlListener = (event: { url: string }) => void;
let mockUrlListener: UrlListener | null = null;
let mockGetInitialUrlResolver: ((u: string | null) => void) | null = null;
const mockLinkingOpenUrl = jest.fn(async () => true);
// We mock just the `Linking` surface RootNavigator touches. Everything
// else from react-native is left untouched (jest-expo preset stubs the
// native modules so a partial mock would otherwise pull in DevMenu).
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
    openURL: mockLinkingOpenUrl,
  },
}));

// Module-level navigate spy. We intercept navigationRef by replacing the
// real React Navigation container with a thin stub that exposes navigate().
const mockNavigateSpy = jest.fn();
jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    NavigationContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    createNavigationContainerRef: () => ({
      isReady: () => true,
      navigate: (...args: unknown[]) => mockNavigateSpy(...args),
      resetRoot: jest.fn(),
      current: null,
    }),
  };
});

// Each navigator is replaced with a noop component so RootNavigator can
// mount without dragging in the entire authenticated app tree.
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

// IMPORTANT: import RootNavigator AFTER the jest.mock calls above so the
// mocks are applied to the modules it imports.
import RootNavigator from '../navigation/RootNavigator';

const ACCEPT_URL = 'tgp://invite/accept/abcd-1234';
const ACCEPT_TOKEN = 'abcd-1234';

describe('RootNavigator — accept-invite replay guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUrlListener = null;
    mockGetInitialUrlResolver = null;
    // Default to "no cold-start URL" so the test owns the URL delivery.
    mockSecureGet.mockImplementation(async (key: string) => {
      if (key === 'supabase_token') return 'jwt-signed-in';
      return null;
    });
  });

  it('signed-in accept link: signs out once and navigates AcceptInvite exactly once even when the URL fires twice', async () => {
    render(<RootNavigator />);

    // Resolve the cold-start lookup with no URL — the test will deliver
    // the URL via the foreground listener instead.
    await act(async () => {
      mockGetInitialUrlResolver?.(null);
    });
    await waitFor(() => expect(mockUrlListener).not.toBeNull());

    // First URL event — signed in.
    await act(async () => {
      mockUrlListener!({ url: ACCEPT_URL });
    });
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));

    // Simulate the auth state flipping to unauthenticated: when the
    // foreground listener fires again with the same URL, secureStorage
    // now returns null. The consumed-token ref must still suppress the
    // duplicate.
    mockSecureGet.mockImplementation(async () => null);
    await act(async () => {
      mockUrlListener!({ url: ACCEPT_URL });
    });

    // signOut must NOT fire a second time for the same token, and the
    // imperative navigate must fire EXACTLY once. Asserting "exactly 1"
    // (not "≤ 1") guards against a regression where the duplicate
    // unauthenticated event marks the in-flight token consumed and the
    // pending-replay effect drops the navigate, stranding the user on
    // the auth stack.
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    // Linking.openURL must NOT be used as the replay channel (that was
    // the source of the loop).
    expect(mockLinkingOpenUrl).not.toHaveBeenCalled();
    const acceptNavs = mockNavigateSpy.mock.calls.filter(
      (call) => call[0] === 'AcceptInvite',
    );
    expect(acceptNavs.length).toBe(1);
    expect(acceptNavs[0][1]).toEqual({ token: ACCEPT_TOKEN });
  });

  it('signed-in accept link: duplicate URL fired AFTER auth flip but BEFORE replay still navigates exactly once', async () => {
    // This drives the exact race the round-3 audit called out: the
    // first (signed-in) URL event stashes a pending replay, sign-out
    // begins, and a second duplicate URL event arrives WHILE the
    // pending replay is in flight (secureStorage already null because
    // sign-out has cleared it) but BEFORE the replay effect has run.
    // The fix uses a `pendingAcceptTokenRef` so the unauthenticated
    // duplicate branch does NOT mark the in-flight token consumed.
    render(<RootNavigator />);
    await act(async () => {
      mockGetInitialUrlResolver?.(null);
    });
    await waitFor(() => expect(mockUrlListener).not.toBeNull());

    // Drive the race inside a single act() so both URL handlers run
    // before React flushes the pending-replay effect. The first call
    // sees secureStorage = signed-in, the second sees it null —
    // matching real sign-out timing.
    let callCount = 0;
    mockSecureGet.mockImplementation(async (key: string) => {
      if (key !== 'supabase_token') return null;
      callCount += 1;
      return callCount === 1 ? 'jwt-signed-in' : null;
    });

    await act(async () => {
      // Fire both events in immediate succession. Each handleUrl is
      // async; the second one races with the first one's pending
      // state update.
      mockUrlListener!({ url: ACCEPT_URL });
      mockUrlListener!({ url: ACCEPT_URL });
    });

    // Exactly one sign-out for the signed-in branch, and exactly one
    // imperative navigate (not zero — the regression we are testing).
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    const acceptNavs = mockNavigateSpy.mock.calls.filter(
      (call) => call[0] === 'AcceptInvite',
    );
    expect(acceptNavs.length).toBe(1);
    expect(acceptNavs[0][1]).toEqual({ token: ACCEPT_TOKEN });
    expect(mockLinkingOpenUrl).not.toHaveBeenCalled();
  });

  it('cold-start unauthenticated link: does NOT stash a pending URL (React Navigation handles it natively)', async () => {
    // Start signed-out so the cold-start branch takes the unauthenticated path.
    mockSecureGet.mockImplementation(async () => null);
    render(<RootNavigator />);
    await act(async () => {
      mockGetInitialUrlResolver?.(ACCEPT_URL);
    });
    await waitFor(() => expect(mockUrlListener).not.toBeNull());

    // No signOut, no openURL replay — the linking config drives the route.
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockLinkingOpenUrl).not.toHaveBeenCalled();

    // A duplicate foreground delivery of the same URL must be suppressed
    // by the consumed-token ref.
    await act(async () => {
      mockUrlListener!({ url: ACCEPT_URL });
    });
    const acceptNavs = mockNavigateSpy.mock.calls.filter(
      (call) => call[0] === 'AcceptInvite',
    );
    expect(acceptNavs.length).toBe(0);
  });
});
