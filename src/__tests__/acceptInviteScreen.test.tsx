/**
 * AcceptInviteScreen.test — Email Pipeline v1 (behavioral).
 *
 * Covers:
 *   - Valid token + signed-in success path renders the Continue CTA.
 *   - Valid token + signed-out success path renders Sign in + Create account.
 *   - Malformed token short-circuits to the invalid-failure UI without
 *     calling `acceptInvite`.
 *   - Known backend reasons (expired / already_accepted / invalid /
 *     unknown probe) map to fixed safe copy. Raw codes never reach UI.
 *   - Network exception renders the network-failure retry CTA and never
 *     surfaces the underlying error string.
 */

import React from 'react';
import { render, waitFor, within } from '@testing-library/react-native';

const mockAcceptInvite = jest.fn();
jest.mock('../api/invites', () => ({
  invitesApi: {
    acceptInvite: (...args: unknown[]) => mockAcceptInvite(...args),
  },
}));

const mockGetItem = jest.fn();
jest.mock('../services/secureStorage', () => ({
  secureStorage: {
    getItem: (...args: unknown[]) => mockGetItem(...args),
  },
}));

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#000', surface: '#000', surfaceElevated: '#000',
      primary: '#000', primaryLight: '#000', primaryPale: '#000',
      primaryDark: '#000', accent: '#000',
      textPrimary: '#000', textSecondary: '#000', textMuted: '#000',
      textOnPrimary: '#fff', border: '#000', divider: '#000',
      success: '#0a0', warning: '#aa0', error: '#a00', info: '#00a',
      streak: '#aa0', primaryTint: '#000',
    },
  }),
}));

import AcceptInviteScreen from '../screens/auth/AcceptInviteScreen';

type Nav = { navigate: jest.Mock; goBack: jest.Mock };
function makeRoute(token: string) {
  return { params: { token }, key: 'k', name: 'AcceptInvite' as const };
}
function makeNav(): Nav {
  return { navigate: jest.fn(), goBack: jest.fn() };
}

describe('AcceptInviteScreen — RTL', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
  });

  it('signed-in success: renders Continue CTA', async () => {
    mockGetItem.mockResolvedValueOnce('jwt');
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: true,
      coachName: 'Coach K',
      redirectTo: 'app_open',
    });
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok-valid-abc')}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() => expect(getByTestId('accept-success')).toBeTruthy());
    expect(getByTestId('accept-success-continue')).toBeTruthy();
  });

  it('signed-out success: renders Sign in + Create account CTAs', async () => {
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: true,
      coachName: 'Coach K',
      email: 'alice@ex.com',
    });
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok-valid-abc')}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() => expect(getByTestId('accept-success-login')).toBeTruthy());
    expect(getByTestId('accept-success-signup')).toBeTruthy();
  });

  it('malformed token: renders invalid-failure UI WITHOUT calling acceptInvite', async () => {
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('bad/token with spaces')}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-invalid')).toBeTruthy(),
    );
    expect(mockAcceptInvite).not.toHaveBeenCalled();
  });

  it('oversized token: renders invalid-failure UI WITHOUT calling acceptInvite', async () => {
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('a'.repeat(500))}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-invalid')).toBeTruthy(),
    );
    expect(mockAcceptInvite).not.toHaveBeenCalled();
  });

  it('expired: renders friendly expired copy, no raw codes', async () => {
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: false,
      reason: 'expired',
      message: 'INVITE_EXPIRED: prisma row gone',
    });
    const { getByTestId, queryByText } = render(
      <AcceptInviteScreen
        route={makeRoute('tok-old-abcd')}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-expired')).toBeTruthy(),
    );
    expect(queryByText(/INVITE_EXPIRED/)).toBeNull();
    expect(queryByText(/prisma/i)).toBeNull();
  });

  it('already_accepted: maps the INVITE_ALREADY_ACCEPTED probe string', async () => {
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: false,
      reason: 'INVITE_ALREADY_ACCEPTED',
    });
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok-used-abcd')}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-already_accepted')).toBeTruthy(),
    );
  });

  it('unknown backend reason: collapses to invalid', async () => {
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: false,
      reason: 'SOMETHING_NEW_FROM_BACKEND',
    });
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok-xxxx')}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-invalid')).toBeTruthy(),
    );
  });

  it('network exception: renders network-failure UI, never the raw error', async () => {
    mockAcceptInvite.mockRejectedValueOnce(
      new Error('ECONNREFUSED: postgres://supabase:_TOKEN@host'),
    );
    const { getByTestId, queryByText } = render(
      <AcceptInviteScreen
        route={makeRoute('tok-xxxx')}
        navigation={makeNav() as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-network')).toBeTruthy(),
    );
    expect(getByTestId('accept-retry')).toBeTruthy();
    expect(queryByText(/_TOKEN/)).toBeNull();
    expect(queryByText(/postgres/i)).toBeNull();
    expect(queryByText(/ECONNREFUSED/)).toBeNull();
  });

  it('renders the loading state initially', async () => {
    mockAcceptInvite.mockReturnValueOnce(new Promise(() => {})); // never resolves
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok-valid-abc')}
        navigation={makeNav() as never}
      />,
    );
    expect(getByTestId('accept-loading')).toBeTruthy();
  });
});
