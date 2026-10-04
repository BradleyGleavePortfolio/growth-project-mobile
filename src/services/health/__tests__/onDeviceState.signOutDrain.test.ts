/**
 * Sol B-362-7 / Opus C-362-12: sign-out removes on-device health grants and
 * progress through the onDeviceState write chain, so a native write in flight
 * or queued at sign-out can never leave a grant behind. Opus C-362-13: a grant
 * write that failed or was dropped never counts as newer than a Disconnect.
 * Synthetic storage scheduler only; no native build, network or health data.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ON_DEVICE_STATE_PREFIX,
  emptyProgress,
  getLocalAuthorization,
  getSyncProgress,
  localAuthorizationSeq,
  recordLocalAuthorization,
  retireOnDeviceSource,
  retireOnDeviceStateAtSignOut,
  setSyncProgress,
} from '../onDeviceState';
import { OnDeviceSessionChangedError } from '../sessionFence';

const source = 'HEALTH_CONNECT' as const;
const old = { userId: 'drain-user', source, connectionId: 'old-connection' };
const fresh = { ...old, connectionId: 'fresh-connection' };
const other = { userId: 'drain-bystander', source: 'APPLE_HEALTHKIT' as const, connectionId: 'c2' };
const D1 = '2026-10-01T00:00:00.000Z';
const D2 = '2026-10-02T00:00:00.000Z';
const D3 = '2026-10-03T00:00:00.000Z';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { resolve, promise };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Hold the next setItem after it is invoked, before its native effect. */
function holdNextSet() {
  const invoked = deferred();
  const commit = deferred();
  const set = AsyncStorage.setItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (k: string, v: string) => {
    invoked.resolve();
    await commit.promise;
    await set(k, v);
  });
  return { invoked: invoked.promise, commit: commit.resolve };
}

async function healthKeys(): Promise<readonly string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(ON_DEVICE_STATE_PREFIX));
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

it('a grant write in flight at sign-out is removed after it commits, and the sweep waits for it', async () => {
  const held = holdNextSet();
  const writing = recordLocalAuthorization(old, new Date(D3));
  await held.invoked;
  let retired = false;
  const sweeping = retireOnDeviceStateAtSignOut().then(() => {
    retired = true;
  });
  for (let i = 0; i < 5; i += 1) await tick();
  expect(retired).toBe(false); // the sweep is behind the native write, not beside it
  held.commit();
  await Promise.all([writing, sweeping]);
  expect(await healthKeys()).toEqual([]);
  expect(await getLocalAuthorization(old.userId, source)).toBeNull();
});

it('grant and progress writes still queued at sign-out never run and reject as stopped', async () => {
  const held = holdNextSet();
  const first = setSyncProgress(old, { ...emptyProgress(), completedThrough: { Steps: D1 } });
  await held.invoked;
  const grant = recordLocalAuthorization(old, new Date(D2)).then(() => null, (e: unknown) => e);
  const progress = setSyncProgress(old, emptyProgress()).then(() => null, (e: unknown) => e);
  const sweeping = retireOnDeviceStateAtSignOut();
  held.commit();
  await Promise.all([first, sweeping]);
  expect(await grant).toBeInstanceOf(OnDeviceSessionChangedError);
  expect(await progress).toBeInstanceOf(OnDeviceSessionChangedError);
  expect(await healthKeys()).toEqual([]);
});

it('sweeps every account and source, and nothing outside the prefix', async () => {
  await recordLocalAuthorization(old, new Date(D1));
  await recordLocalAuthorization(other, new Date(D1));
  await setSyncProgress(other, emptyProgress());
  await AsyncStorage.setItem('wearables_other', 'stays');
  await retireOnDeviceStateAtSignOut();
  expect(await healthKeys()).toEqual([]);
  expect(await AsyncStorage.getItem('wearables_other')).toBe('stays');
});

it('a failed sweep never rejects and still voids every grant written before sign-out', async () => {
  await recordLocalAuthorization(old, new Date(D1));
  jest.spyOn(AsyncStorage, 'getAllKeys').mockRejectedValueOnce(new Error('synthetic storage failure'));
  await expect(retireOnDeviceStateAtSignOut()).resolves.toBeUndefined();
  expect(await healthKeys()).not.toEqual([]); // the key is still on disk
  expect(await getLocalAuthorization(old.userId, source)).toBeNull();
});

it('a new Connect after sign-out is honoured, and the chain keeps working', async () => {
  await recordLocalAuthorization(old, new Date(D1));
  await retireOnDeviceStateAtSignOut();
  await recordLocalAuthorization(fresh, new Date(D2));
  await setSyncProgress(fresh, { ...emptyProgress(), completedThrough: { Steps: D2 } });
  expect((await getLocalAuthorization(old.userId, source))?.connectionId).toBe(fresh.connectionId);
  expect((await getSyncProgress(fresh)).completedThrough.Steps).toBe(D2);
});

it('C-362-13: a Disconnect older than a REJECTED grant write still retires the old grant', async () => {
  const prior = await recordLocalAuthorization(old, new Date(D1));
  const since = localAuthorizationSeq();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await expect(recordLocalAuthorization(fresh, new Date(D2))).rejects.toThrow('disk full');
  await retireOnDeviceSource(old.userId, source, prior.grantedAt, since);
  expect(await getLocalAuthorization(old.userId, source)).toBeNull();
});

it('C-362-13 control: a newer grant that did land is still kept from an older Disconnect', async () => {
  const prior = await recordLocalAuthorization(old, new Date(D1));
  const since = localAuthorizationSeq();
  const disconnecting = retireOnDeviceSource(old.userId, source, prior.grantedAt, since);
  await recordLocalAuthorization(fresh, new Date(D2));
  await disconnecting;
  expect((await getLocalAuthorization(old.userId, source))?.connectionId).toBe(fresh.connectionId);
});
