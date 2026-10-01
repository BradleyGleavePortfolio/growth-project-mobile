/**
 * crisp.service.test.ts — Unit tests for the Crisp identity-sync service.
 *
 * Verifies that `initCrisp` calls `configure` with the correct website ID
 * and that `syncCrispIdentity` calls `setUserEmail`, `setUserNickname`, and
 * `setSessionString` when invoked with a valid user.
 *
 * `crisp-sdk-react-native` is mocked globally in `jest.setup.js`.
 */

// Set the env before the module is imported.
process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID = 'test-website-id-123';

// The global mock in jest.setup.js handles the native module. Import the
// real service so we test its logic.
import * as CrispSDK from 'crisp-sdk-react-native';
import {
  syncCrispIdentity,
  resetCrispIdentity,
  prepareSignedOutCrispSession,
  openSupportChat,
  __resetCrispOwnerForTests,
  type CrispUser,
} from '../crisp.service';
import { prefsStorage } from '../../../storage/mmkv';

const mockSetUserEmail = CrispSDK.setUserEmail as jest.Mock;
const mockSetUserNickname = CrispSDK.setUserNickname as jest.Mock;
const mockSetSessionString = CrispSDK.setSessionString as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('syncCrispIdentity', () => {
  const fullUser: CrispUser = {
    email: 'alice@example.com',
    displayName: 'Alice',
    planTier: 'pro',
    role: 'student',
    tenantId: 'tenant-abc',
  };

  it('calls setUserEmail with the user email', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetUserEmail).toHaveBeenCalledWith('alice@example.com');
  });

  it('calls setUserNickname with the display name', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetUserNickname).toHaveBeenCalledWith('Alice');
  });

  it('sets planTier as a session string', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetSessionString).toHaveBeenCalledWith('planTier', 'pro');
  });

  it('sets role as a session string', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetSessionString).toHaveBeenCalledWith('role', 'student');
  });

  it('sets tenantId as a session string', () => {
    syncCrispIdentity(fullUser);
    expect(mockSetSessionString).toHaveBeenCalledWith('tenantId', 'tenant-abc');
  });

  it('falls back to the email prefix as nickname when displayName is absent', () => {
    syncCrispIdentity({ email: 'bob@example.com' });
    expect(mockSetUserNickname).toHaveBeenCalledWith('bob');
  });

  it('does not call setUserNickname when email has no @ prefix', () => {
    // Edge case: malformed email — should not crash.
    expect(() => syncCrispIdentity({ email: '' })).not.toThrow();
  });

  it('does not call setSessionString for absent optional fields', () => {
    syncCrispIdentity({ email: 'charlie@example.com' });
    expect(mockSetSessionString).not.toHaveBeenCalled();
  });
});

describe('resetCrispIdentity', () => {
  it('is callable without throwing', () => {
    expect(() => resetCrispIdentity()).not.toThrow();
  });
});

// #306 fix round 3 (Opus C2): the native chat session (and its history)
// survives across accounts until resetSession() is called.
describe('support chat session on shared devices', () => {
  const mockResetSession = CrispSDK.resetSession as jest.Mock;

  beforeEach(() => {
    __resetCrispOwnerForTests();
    jest.clearAllMocks();
  });

  it('sign-out reset ends the session', () => {
    resetCrispIdentity();
    expect(mockResetSession).toHaveBeenCalledTimes(1);
  });

  it('binding a user resets a session of unknown owner first, then sets the email', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    expect(mockResetSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetUserEmail.mock.invocationCallOrder[0],
    );
  });

  it('the same server user again keeps the session; a different user resets it before binding', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    mockResetSession.mockClear();
    syncCrispIdentity({ userId: 'user-a', email: 'Alice@example.com' });
    expect(mockResetSession).not.toHaveBeenCalled();
    syncCrispIdentity({ userId: 'user-b', email: 'bob@example.com' });
    expect(mockResetSession).toHaveBeenCalledTimes(1);
  });

  it('the pre-sign-in support screen never opens a previous user\'s conversation', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    mockResetSession.mockClear();
    prepareSignedOutCrispSession();
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    // Re-opening it while still signed out keeps the anonymous session.
    prepareSignedOutCrispSession();
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    // Signing in after an anonymous chat starts a fresh session for the user.
    syncCrispIdentity({ userId: 'user-b', email: 'bob@example.com' });
    expect(mockResetSession).toHaveBeenCalledTimes(2);
  });

  it('after sign-out, the pre-sign-in screen still resets (nothing is trusted)', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    resetCrispIdentity();
    mockResetSession.mockClear();
    prepareSignedOutCrispSession();
    expect(mockResetSession).toHaveBeenCalledTimes(1);
  });
});

// #306 fix round 4 (Sol A2-R3): ownership is the server user id, never an
// email fingerprint that can collide.
describe('support chat ownership is the server user id (Sol A2-R3)', () => {
  const mockResetSession = CrispSDK.resetSession as jest.Mock;

  beforeEach(() => {
    __resetCrispOwnerForTests();
    jest.clearAllMocks();
  });

  it('two different users whose emails collide under the old 32-bit fingerprint still reset', () => {
    // a0@example.com and _r@example.com had the same djb2 fingerprint.
    syncCrispIdentity({ userId: 'user-a0', email: 'a0@example.com' });
    mockResetSession.mockClear();
    syncCrispIdentity({ userId: 'user-r', email: '_r@example.com' });
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    expect(mockResetSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockSetUserEmail.mock.invocationCallOrder[mockSetUserEmail.mock.invocationCallOrder.length - 1],
    );
  });

  it('cold start: a different server user than the stored owner resets; colliding emails do not matter', () => {
    const prefs = jest.spyOn(prefsStorage, 'getString').mockReturnValue('uid:user-a0');
    syncCrispIdentity({ userId: 'user-r', email: '_r@example.com' });
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    prefs.mockRestore();
  });

  it('cold start: the same server user as the stored owner keeps the session', () => {
    const prefs = jest.spyOn(prefsStorage, 'getString').mockReturnValue('uid:user-a0');
    syncCrispIdentity({ userId: 'user-a0', email: 'a0@example.com' });
    expect(mockResetSession).not.toHaveBeenCalled();
    prefs.mockRestore();
  });

  it('a stored round-3 email fingerprint is not trusted (reset once)', () => {
    const prefs = jest.spyOn(prefsStorage, 'getString').mockReturnValue('u1a2b3c');
    syncCrispIdentity({ userId: 'user-a0', email: 'a0@example.com' });
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    prefs.mockRestore();
  });

  it('a user without a server id is always reset before binding', () => {
    syncCrispIdentity({ email: 'a0@example.com' });
    syncCrispIdentity({ email: 'a0@example.com' });
    expect(mockResetSession).toHaveBeenCalledTimes(2);
  });

  it('RootNavigator passes the server user id to both callers', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src: string = fs.readFileSync(path.join(__dirname, '../../../navigation/RootNavigator.tsx'), 'utf8');
    const calls = src.split('syncCrispIdentity({').slice(1);
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c.slice(0, 300)).toMatch(/userId: typeof user\.id === 'string' \? user\.id : undefined/);
  });
});

// #306 fix round 4 (Sol A1-R3): a failed reset fails closed.
describe('support chat reset failure fails closed (Sol A1-R3)', () => {
  const mockResetSession = CrispSDK.resetSession as jest.Mock;
  const mockShow = CrispSDK.show as jest.Mock;

  beforeEach(() => {
    __resetCrispOwnerForTests();
    jest.clearAllMocks();
    mockResetSession.mockReset();
  });

  it('binding a different user when the reset throws does not relabel the old session, and the chat stays closed', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    mockSetUserEmail.mockClear();
    mockResetSession.mockImplementation(() => {
      throw new Error('native reset failed');
    });
    expect(syncCrispIdentity({ userId: 'user-b', email: 'bob@example.com' })).toBe(false);
    expect(mockSetUserEmail).not.toHaveBeenCalled();
    expect(openSupportChat({ preSignIn: false })).toBe('blocked');
    expect(mockShow).not.toHaveBeenCalled();
    // The reset works again: the pending binding is retried, then the chat opens.
    mockResetSession.mockImplementation(() => undefined);
    expect(openSupportChat({ preSignIn: false })).toBe('opened');
    expect(mockSetUserEmail).toHaveBeenCalledWith('bob@example.com');
    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockResetSession.mock.invocationCallOrder.slice(-1)[0]).toBeLessThan(mockShow.mock.invocationCallOrder[0]);
  });

  it('pre-sign-in: a previous user is bound and the reset throws: no show, and every reopen retries the reset', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    mockResetSession.mockImplementation(() => {
      throw new Error('native reset failed');
    });
    expect(openSupportChat({ preSignIn: true })).toBe('blocked');
    expect(openSupportChat({ preSignIn: true })).toBe('blocked');
    expect(mockShow).not.toHaveBeenCalled();
    expect(prepareSignedOutCrispSession()).toBe(false);
    mockResetSession.mockImplementation(() => undefined);
    expect(openSupportChat({ preSignIn: true })).toBe('opened');
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  it('sign-out whose reset throws leaves ownership unknown, so the next open resets first', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    mockResetSession.mockImplementationOnce(() => {
      throw new Error('native reset failed');
    });
    resetCrispIdentity();
    mockResetSession.mockClear();
    expect(openSupportChat({ preSignIn: true })).toBe('opened');
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    expect(mockResetSession.mock.invocationCallOrder[0]).toBeLessThan(mockShow.mock.invocationCallOrder[0]);
  });

  it('cold start, signed out: a persisted claim is never trusted; the pre-sign-in open resets first', () => {
    const prefs = jest.spyOn(prefsStorage, 'getString').mockReturnValue('signed-out');
    expect(openSupportChat({ preSignIn: true })).toBe('opened');
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    prefs.mockRestore();
  });

  it('signed in with no binding in this process: reset to a fresh session before showing', () => {
    expect(openSupportChat({ preSignIn: false })).toBe('opened');
    expect(mockResetSession).toHaveBeenCalledTimes(1);
    expect(mockResetSession.mock.invocationCallOrder[0]).toBeLessThan(mockShow.mock.invocationCallOrder[0]);
  });

  it('signed in, bound this process: shows the user\'s own session without a reset', () => {
    syncCrispIdentity({ userId: 'user-a', email: 'alice@example.com' });
    mockResetSession.mockClear();
    expect(openSupportChat({ preSignIn: false })).toBe('opened');
    expect(mockResetSession).not.toHaveBeenCalled();
  });
});
