/**
 * AcceptInviteScreen.test — Email Pipeline v1.
 *
 * Coverage: happy path (signed in vs not), expired, already_accepted,
 * invalid. Network failure is exercised via the `network` reason so
 * the retry CTA renders.
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');
const SCREEN_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'auth', 'AcceptInviteScreen.tsx'),
  'utf8',
);

describe('AcceptInviteScreen — source guards', () => {
  it('exposes testIDs for the success + failure paths', () => {
    for (const id of [
      'accept-loading',
      'accept-success',
      'accept-failed-cta',
    ]) {
      expect(SCREEN_SRC).toContain(`testID="${id}"`);
    }
    // Failure testIDs are dynamic — assert the pattern instead.
    expect(SCREEN_SRC).toMatch(/testID=\{?[`"]accept-failed-/);
  });

  it('calls invitesApi.acceptInvite on mount', () => {
    expect(SCREEN_SRC).toMatch(/invitesApi\.acceptInvite/);
  });

  it('every Pressable has accessibilityLabel + role', () => {
    const pressableCount = (SCREEN_SRC.match(/<Pressable/g) ?? []).length;
    const labelCount = (SCREEN_SRC.match(/accessibilityLabel=/g) ?? []).length;
    const roleCount = (SCREEN_SRC.match(/accessibilityRole="button"/g) ?? []).length;
    expect(labelCount).toBeGreaterThanOrEqual(pressableCount);
    expect(roleCount).toBeGreaterThanOrEqual(pressableCount);
  });
});

// ── Mocks ───────────────────────────────────────────────────────────────────

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

type Nav = {
  navigate: jest.Mock;
  goBack: jest.Mock;
};

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

  it('happy path (signed in): renders success + Continue CTA', async () => {
    mockGetItem.mockResolvedValueOnce('jwt');
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: true,
      coachName: 'Coach K',
      redirectTo: 'app_open',
    });
    const nav = makeNav();
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok_abc')}
        navigation={nav as never}
      />,
    );
    await waitFor(() => expect(getByTestId('accept-success')).toBeTruthy());
    expect(getByTestId('accept-success-continue')).toBeTruthy();
  });

  it('happy path (not signed in): renders sign-in + signup CTAs', async () => {
    mockGetItem.mockResolvedValueOnce(null);
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: true,
      coachName: 'Coach K',
      email: 'alice@ex.com',
    });
    const nav = makeNav();
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok_abc')}
        navigation={nav as never}
      />,
    );
    await waitFor(() => expect(getByTestId('accept-success-login')).toBeTruthy());
    expect(getByTestId('accept-success-signup')).toBeTruthy();
  });

  it('expired: renders expired failure', async () => {
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: false,
      reason: 'expired',
    });
    const nav = makeNav();
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok_old')}
        navigation={nav as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-expired')).toBeTruthy(),
    );
  });

  it('already_accepted: renders already-accepted failure', async () => {
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: false,
      reason: 'already_accepted',
    });
    const nav = makeNav();
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok_old')}
        navigation={nav as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-already_accepted')).toBeTruthy(),
    );
  });

  it('invalid: renders invalid failure', async () => {
    mockAcceptInvite.mockResolvedValueOnce({
      accepted: false,
      reason: 'invalid',
    });
    const nav = makeNav();
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok_bad')}
        navigation={nav as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-invalid')).toBeTruthy(),
    );
  });

  it('network failure: renders retry CTA', async () => {
    mockAcceptInvite.mockRejectedValueOnce(new Error('offline'));
    const nav = makeNav();
    const { getByTestId } = render(
      <AcceptInviteScreen
        route={makeRoute('tok_x')}
        navigation={nav as never}
      />,
    );
    await waitFor(() =>
      expect(getByTestId('accept-failed-network')).toBeTruthy(),
    );
    expect(getByTestId('accept-retry')).toBeTruthy();
  });
});
