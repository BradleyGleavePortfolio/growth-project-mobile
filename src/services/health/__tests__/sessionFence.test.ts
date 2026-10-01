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
  createSessionFence,
  readSignedInUserId,
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
