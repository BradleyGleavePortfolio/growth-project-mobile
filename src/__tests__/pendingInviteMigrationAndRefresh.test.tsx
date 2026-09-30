/**
 * Audit #303 B1 (one-time migration of old scoped pending keys) and B2
 * (an already-mounted Home banner repaints on a foreground invite link).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';

let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('../lib/userCache', () => ({ readUserCache: jest.fn(() => Promise.resolve(mockUser)) }));
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
  mockUser = { id: 'u1' };
  jest.restoreAllMocks();
});

describe('B1: legacy scoped pending-invite keys', () => {
  it("migrates the current user's scoped key once, then deletes it", async () => {
    await AsyncStorage.setItem('pending_invite_code:u1', 'GP-OLD1');
    expect(await readPendingInviteCode()).toBe('GP-OLD1');
    expect(await AsyncStorage.getItem('pending_invite_code')).toBe('GP-OLD1');
    expect(await AsyncStorage.getItem('pending_invite_code:u1')).toBeNull();
  });

  it("never reads another user's scoped key", async () => {
    await AsyncStorage.setItem('pending_invite_code:u2', 'GP-THEIRS');
    expect(await readPendingInviteCode()).toBeNull();
    expect(await AsyncStorage.getItem('pending_invite_code:u2')).toBe('GP-THEIRS');
  });

  it('claims the pre-login anonymous key (device-local, consent still required to attach)', async () => {
    mockUser = null;
    await AsyncStorage.setItem('pending_invite_code:anonymous', 'GP-ANON');
    expect(await readPendingInviteCode()).toBe('GP-ANON');
    expect(await AsyncStorage.getItem('pending_invite_code:anonymous')).toBeNull();
  });

  it('a newer canonical value wins over a legacy key', async () => {
    await AsyncStorage.setItem('pending_invite_code', 'GP-NEW');
    await AsyncStorage.setItem('pending_invite_code:u1', 'GP-OLD1');
    expect(await readPendingInviteCode()).toBe('GP-NEW');
    expect(await AsyncStorage.getItem('pending_invite_code:u1')).toBe('GP-OLD1');
  });

  it('keeps the legacy key when the canonical write fails', async () => {
    await AsyncStorage.setItem('pending_invite_code:u1', 'GP-OLD1');
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    expect(await readPendingInviteCode()).toBe('GP-OLD1');
    expect(await AsyncStorage.getItem('pending_invite_code:u1')).toBe('GP-OLD1');
    expect(await AsyncStorage.getItem('pending_invite_code')).toBeNull();
  });
});

describe('B2: foreground invite link refreshes a mounted banner', () => {
  it.each([
    ['https://app.trygrowthproject.com/join/GP-PNW1', 'GP-PNW1'],
    ['tgp://join/GP-PNW1?utm=qr', 'GP-PNW1'],
  ])('extracts %p', (url, code) => {
    expect(extractJoinPathCode(url)).toBe(code);
  });

  it('banner appears without remount when the signed-in handler writes a code, and hides on clear', async () => {
    const utils = await render(<PendingInviteBanner />);
    await new Promise((r) => setTimeout(r, 10));
    expect(utils.queryByText(/GP-PNW1/)).toBeNull();
    // Same call RootNavigator's signed-in handler makes for /join/<code>.
    const code = extractJoinPathCode('https://app.trygrowthproject.com/join/GP-PNW1');
    await act(async () => {
      await writePendingInviteCode(code as string);
    });
    await waitFor(() => expect(utils.getByText(/GP-PNW1/)).toBeTruthy());
    await act(async () => {
      await clearPendingInviteCode();
    });
    expect(await readPendingInviteCode()).toBeNull();
  });
});
