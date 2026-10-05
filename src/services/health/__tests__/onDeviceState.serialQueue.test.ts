/**
 * Sol B-362-2 (remaining) / Opus C-362-11: Android AsyncStorage 3.1.1 runs each
 * native call on its own IO coroutine, so JS call order is not commit order.
 * Every grant write, progress write and removal in onDeviceState runs through
 * one chain: each native operation starts only after the previous one settled.
 * Synthetic storage scheduler only; no native build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  emptyProgress,
  getLocalAuthorization,
  getSyncProgress,
  localAuthorizationSeq,
  recordLocalAuthorization,
  retireOnDeviceSource,
  setSyncProgress,
} from '../onDeviceState';

const source = 'HEALTH_CONNECT' as const;
const old = { userId: 'queue-user', source, connectionId: 'old-connection' };
const fresh = { ...old, connectionId: 'fresh-connection' };
const D1 = '2026-10-01T00:00:00.000Z';
const D2 = '2026-10-02T00:00:00.000Z';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { resolve, promise };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Hold the next removeMany after it is invoked, before its native effect. */
function holdNextRemoval() {
  const invoked = deferred();
  const commit = deferred();
  const remove = AsyncStorage.removeMany.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, 'removeMany').mockImplementationOnce(async (keys) => {
    invoked.resolve();
    await commit.promise;
    await remove(keys);
  });
  return { invoked: invoked.promise, commit: commit.resolve };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

it('native writes and removals never overlap and commit in call order', async () => {
  const prior = await recordLocalAuthorization(old, new Date(D1));
  const log: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const track = async (name: string, op: () => Promise<void>) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    log.push(`start:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await op();
    log.push(`end:${name}`);
    inFlight -= 1;
  };
  const set = AsyncStorage.setItem.bind(AsyncStorage);
  const remove = AsyncStorage.removeMany.bind(AsyncStorage);
  jest
    .spyOn(AsyncStorage, 'setItem')
    .mockImplementation((key: string, value: string) => track('set', () => set(key, value)));
  jest.spyOn(AsyncStorage, 'removeMany').mockImplementation((keys: string[]) => track('remove', () => remove(keys)));
  const retiring = retireOnDeviceSource(old.userId, source, prior.grantedAt, localAuthorizationSeq());
  while (log.length === 0) await tick();
  const authorizing = recordLocalAuthorization(fresh, new Date(D2));
  const progressing = setSyncProgress(fresh, { ...emptyProgress(), completedThrough: { Steps: D2 } });
  await Promise.all([retiring, authorizing, progressing]);
  expect(maxInFlight).toBe(1);
  expect(log).toEqual(['start:remove', 'end:remove', 'start:set', 'end:set', 'start:set', 'end:set']);
  expect((await getLocalAuthorization(old.userId, source))?.connectionId).toBe(fresh.connectionId);
  expect((await getSyncProgress(fresh)).completedThrough.Steps).toBe(D2);
});

it('a reconnect with the same connection id keeps the grant and progress written after an invoked removal', async () => {
  const prior = await recordLocalAuthorization(old, new Date(D1));
  await setSyncProgress(old, { ...emptyProgress(), completedThrough: { Steps: D1 } });
  const held = holdNextRemoval();
  const retiring = retireOnDeviceSource(old.userId, source, prior.grantedAt, localAuthorizationSeq());
  await held.invoked;
  const authorizing = recordLocalAuthorization(old, new Date(D2));
  const progressing = setSyncProgress(old, { ...emptyProgress(), completedThrough: { Steps: D2 } });
  await tick();
  held.commit();
  await Promise.all([retiring, authorizing, progressing]);
  expect((await getLocalAuthorization(old.userId, source))?.grantedAt).toBe(D2);
  expect((await getSyncProgress(old)).completedThrough.Steps).toBe(D2);
});

it('a grant read issued while a removal is in flight never returns the grant being removed', async () => {
  const prior = await recordLocalAuthorization(old, new Date(D1));
  const held = holdNextRemoval();
  const retiring = retireOnDeviceSource(old.userId, source, prior.grantedAt, localAuthorizationSeq());
  await held.invoked;
  const reading = getLocalAuthorization(old.userId, source);
  await tick();
  held.commit();
  await retiring;
  expect(await reading).toBeNull();
});

it('a rejected native removal reaches its caller and never stalls the next write', async () => {
  const prior = await recordLocalAuthorization(old, new Date(D1));
  const failure = new Error('storage unavailable');
  jest.spyOn(AsyncStorage, 'removeMany').mockRejectedValueOnce(failure);
  await expect(
    retireOnDeviceSource(old.userId, source, prior.grantedAt, localAuthorizationSeq()),
  ).rejects.toBe(failure);
  await recordLocalAuthorization(fresh, new Date(D2));
  expect((await getLocalAuthorization(old.userId, source))?.connectionId).toBe(fresh.connectionId);
});

it('control: with no reconnect the held removal still retires the old grant and progress', async () => {
  const prior = await recordLocalAuthorization(old, new Date(D1));
  await setSyncProgress(old, { ...emptyProgress(), completedThrough: { Steps: D1 } });
  const held = holdNextRemoval();
  const retiring = retireOnDeviceSource(old.userId, source, prior.grantedAt, localAuthorizationSeq());
  await held.invoked;
  held.commit();
  await retiring;
  expect(await getLocalAuthorization(old.userId, source)).toBeNull();
  expect(await getSyncProgress(old)).toEqual(emptyProgress());
});
