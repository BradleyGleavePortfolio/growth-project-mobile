/**
 * C10: the deep-link handler in RootNavigator used to write
 * `pending_invite_code:<scope>` while PendingInviteBanner reads the bare
 * `pending_invite_code` key via lib/pendingInviteCode, so codes captured
 * from /join/<code> links were never shown. The writer must go through the
 * helper, and whatever the helper writes must be readable by the reader and
 * wiped on sign-out.
 */
import * as fs from 'fs';
import * as path from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readPendingInviteCode, writePendingInviteCode } from '../lib/pendingInviteCode';

jest.mock('../services/api', () => ({ authApi: { attachInviteCode: jest.fn() } }));

const ROOT_NAV = fs.readFileSync(path.join(__dirname, '..', 'navigation', 'RootNavigator.tsx'), 'utf8');
const AUTH_ACTIONS = fs.readFileSync(path.join(__dirname, '..', 'services', 'authActions.ts'), 'utf8');

describe('pending invite key contract', () => {
  beforeEach(() => AsyncStorage.clear());

  it('RootNavigator writes through writePendingInviteCode, not a scoped raw key', () => {
    expect(ROOT_NAV).toMatch(/await writePendingInviteCode\(code\)/);
    expect(ROOT_NAV).not.toMatch(/setItem\(`pending_invite_code:/);
  });

  it('what the writer stores, the Home banner reader sees', async () => {
    await writePendingInviteCode('GP-TEST1');
    expect(await readPendingInviteCode()).toBe('GP-TEST1');
  });

  it('sign-out still wipes the key the helper writes (R15)', () => {
    expect(AUTH_ACTIONS).toMatch(/'pending_invite_code',/);
  });
});
