/**
 * S14 (A-317-1) — session fence for on-device health work.
 */

jest.mock('../../../lib/userCache', () => ({
  readUserCache: jest.fn(),
}));

import { authEvents } from '../../../utils/authEvents';
import { readUserCache } from '../../../lib/userCache';
import {
  OnDeviceSessionChangedError,
  beginSessionFence,
  createSessionFence,
  isOnDeviceStop,
  readSignedInUserId,
  stopOnDeviceHealthWork,
} from '../sessionFence';

const mockRead = readUserCache as jest.Mock;

describe('createSessionFence', () => {
  it('passes while the same user stays signed in', async () => {
    const fence = createSessionFence('user-a', async () => 'user-a');
    await expect(fence.assertCurrent()).resolves.toBeUndefined();
  });

  it('fails when a different account is signed in', async () => {
    const fence = createSessionFence('user-a', async () => 'user-b');
    await expect(fence.assertCurrent()).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
  });

  it('fails when nobody is signed in', async () => {
    const fence = createSessionFence('user-a', async () => null);
    await expect(fence.assertCurrent()).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
  });

  it('fails after any auth event (logout, login), even if the id reads the same', async () => {
    const fence = createSessionFence('user-a', async () => 'user-a');
    authEvents.emit('logout');
    await expect(fence.assertCurrent()).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    // A fence created after the event works again.
    const fresh = createSessionFence('user-a', async () => 'user-a');
    await expect(fresh.assertCurrent()).resolves.toBeUndefined();
  });
});

describe('readSignedInUserId', () => {
  it('reads the identity cache', async () => {
    mockRead.mockResolvedValueOnce({ id: 'user-a', email: 'a@example.com' });
    expect(await readSignedInUserId()).toBe('user-a');
    mockRead.mockResolvedValueOnce(null);
    expect(await readSignedInUserId()).toBeNull();
    mockRead.mockRejectedValueOnce(new Error('storage'));
    expect(await readSignedInUserId()).toBeNull();
  });
});

// S14 round 3 (Sol A-317-1): the fence is taken at the Continue tap, before
// the native permission prompt, and can be cancelled when the sheet closes.
describe('beginSessionFence', () => {
  it('binds to the signed-in user', async () => {
    const fence = await beginSessionFence(async () => 'user-a');
    expect(fence?.userId).toBe('user-a');
    await expect(fence?.assertCurrent()).resolves.toBeUndefined();
  });

  it('returns null when nobody is signed in', async () => {
    expect(await beginSessionFence(async () => null)).toBeNull();
  });

  it('returns null when an auth event lands while the user is read', async () => {
    const fence = await beginSessionFence(async () => {
      authEvents.emit('logout');
      return 'user-a';
    });
    expect(fence).toBeNull();
  });

  it('fails after a later auth event, even for the same user (re-login)', async () => {
    const fence = await beginSessionFence(async () => 'user-a');
    authEvents.emit('login');
    await expect(fence?.assertCurrent()).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
  });

  it('cancel() stops every later check with reason cancelled', async () => {
    const fence = await beginSessionFence(async () => 'user-a');
    fence?.cancel();
    const err = await fence?.assertCurrent().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OnDeviceSessionChangedError);
    expect((err as OnDeviceSessionChangedError).reason).toBe('cancelled');
  });
});

describe('S-WEAR-3 (Sol B-317-7): synchronous stop', () => {
  it('throwIfStopped passes while nothing happened', () => {
    const fence = createSessionFence('user-a', async () => 'user-a');
    expect(() => fence.throwIfStopped()).not.toThrow();
  });

  it('stopOnDeviceHealthWork stops every open fence at once, synchronously', async () => {
    const a = createSessionFence('user-a', async () => 'user-a');
    const b = await beginSessionFence(async () => 'user-a');
    stopOnDeviceHealthWork();
    expect(() => a.throwIfStopped()).toThrow(OnDeviceSessionChangedError);
    expect(() => b?.throwIfStopped()).toThrow(OnDeviceSessionChangedError);
    await expect(a.assertCurrent()).rejects.toBeInstanceOf(OnDeviceSessionChangedError);
    // A fence taken afterwards (the next sign-in) works.
    expect(() => createSessionFence('user-a', async () => 'user-a').throwIfStopped()).not.toThrow();
  });

  it('throwIfStopped throws after an auth event and after cancel', () => {
    const fence = createSessionFence('user-a', async () => 'user-a');
    authEvents.emit('logout');
    expect(() => fence.throwIfStopped()).toThrow(OnDeviceSessionChangedError);
    const other = createSessionFence('user-a', async () => 'user-a');
    other.cancel();
    let err: unknown;
    try {
      other.throwIfStopped();
    } catch (e) {
      err = e;
    }
    expect(isOnDeviceStop(err)).toBe(true);
    expect((err as OnDeviceSessionChangedError).reason).toBe('cancelled');
  });

  it('a stop during beginSessionFence identity read returns no fence', async () => {
    const fence = await beginSessionFence(async () => {
      stopOnDeviceHealthWork();
      return 'user-a';
    });
    expect(fence).toBeNull();
  });
});
