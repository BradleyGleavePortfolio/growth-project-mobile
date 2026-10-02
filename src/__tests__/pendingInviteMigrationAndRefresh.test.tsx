/**
 * Audit #303: legacy scoped pending keys are never read (operator decision,
 * re-audit R1/R2), and B2 (an already-mounted Home banner repaints on a
 * foreground invite link).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';

jest.mock('../services/api', () => ({ authApi: { attachInviteCode: jest.fn() } }));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

import {
  extractJoinPathCode,
  readPendingInviteCode,
  writePendingInviteCode,
  clearPendingInviteCode,
} from '../lib/pendingInviteCode';
import PendingInviteBanner from '../components/PendingInviteBanner';

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('legacy scoped pending-invite keys (re-audit R1/R2: no migration)', () => {
  it('are never read into canonical state, for the current user, anonymous, or another user', async () => {
    await AsyncStorage.setItem('pending_invite_code:u1', 'GP-OLD1');
    await AsyncStorage.setItem('pending_invite_code:anonymous', 'GP-ANON');
    await AsyncStorage.setItem('pending_invite_code:u2', 'GP-THEIRS');
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
    await writePendingInviteCode('GP-NEW');
    expect(await readPendingInviteCode()).toBe('GP-NEW');
    await clearPendingInviteCode();
    // Clearing the canonical code never resurrects a legacy one.
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
  });
});

describe('B2: foreground invite link refreshes a mounted banner', () => {
  it.each([
    ['https://app.trygrowthproject.com/join/GP-TEST1', 'GP-TEST1'],
    ['tgp://join/GP-TEST1?utm=qr', 'GP-TEST1'],
  ])('extracts %p', (url, code) => {
    expect(extractJoinPathCode(url)).toBe(code);
  });

  it('banner appears without remount when the signed-in handler writes a code, and hides on clear', async () => {
    const utils = await render(<PendingInviteBanner />);
    await new Promise((r) => setTimeout(r, 10));
    expect(utils.queryByText(/GP-TEST1/)).toBeNull();
    // Same call RootNavigator's signed-in handler makes for /join/<code>.
    const code = extractJoinPathCode('https://app.trygrowthproject.com/join/GP-TEST1');
    await act(async () => {
      await writePendingInviteCode(code as string);
    });
    await waitFor(() => expect(utils.getByText(/GP-TEST1/)).toBeTruthy());
    await act(async () => {
      await clearPendingInviteCode();
    });
    expect(await readPendingInviteCode()).toBeNull();
  });
});
