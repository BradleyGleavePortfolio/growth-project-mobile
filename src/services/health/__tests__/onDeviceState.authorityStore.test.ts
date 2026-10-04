/**
 * Sol B-369-1 (the B-362-8 remainder): the session replacement, its fallback
 * removal and the prefix removal all go to one AsyncStorage backing store, so
 * one outage can fail all three. Every grant is also bound to the consent
 * authority in SecureStore, which sign-out revokes first; an absent or
 * unreadable authority authorizes nothing. A restart is a fresh module
 * lifetime over the SAME disk. Synthetic storage only; no native build,
 * network or health data.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  ON_DEVICE_CONSENT_AUTHORITY_KEY,
  ON_DEVICE_CONSENT_SESSION_KEY,
  ON_DEVICE_STATE_PREFIX,
  getLocalAuthorization,
  recordLocalAuthorization,
  retireOnDeviceState,
  retireOnDeviceStateAtSignOut,
} from "../onDeviceState";

const old = {
  userId: "authority-user",
  source: "HEALTH_CONNECT" as const,
  connectionId: "old-connection",
};
const fresh = { ...old, connectionId: "fresh-connection" };
const grantKey = `${ON_DEVICE_STATE_PREFIX}auth:${old.source}:${old.userId}`;
const D1 = new Date("2026-10-01T00:00:00.000Z");
const D2 = new Date("2026-10-02T00:00:00.000Z");
const secure = jest.mocked(SecureStore);
const secureMap = (SecureStore as unknown as { __store: Map<string, string> })
  .__store;

/** Drop queued one-off results (a pre-fix run never consumes them) and restore the setup mock. */
function resetSecureStoreMock() {
  secure.getItemAsync
    .mockReset()
    .mockImplementation(async (k) => secureMap.get(k) ?? null);
  secure.setItemAsync.mockReset().mockImplementation(async (k, v) => {
    secureMap.set(k, v);
  });
  secure.deleteItemAsync.mockReset().mockImplementation(async (k) => {
    secureMap.delete(k);
  });
}

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { resolve, promise };
}

/** App restart: fresh module state, same AsyncStorage and SecureStore. */
function restart(): typeof import("../onDeviceState") {
  let state: typeof import("../onDeviceState") | undefined;
  jest.isolateModules(() => {
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: AsyncStorage,
    }));
    jest.doMock("expo-secure-store", () => SecureStore);
    state = require("../onDeviceState");
  });
  if (!state) throw new Error("restart setup failed");
  return state;
}

/** Every AsyncStorage mutation rejects (one backing-store outage); reads still work. */
function asyncStorageMutationOutage(
  except: (key: string) => boolean = () => false,
) {
  const failure = new Error("synthetic backing-store mutation outage");
  const set = AsyncStorage.setItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, "setItem").mockImplementation(async (k, v) => {
    if (!except(k)) throw failure;
    await set(k, v);
  });
  jest.spyOn(AsyncStorage, "removeItem").mockRejectedValue(failure);
  jest.spyOn(AsyncStorage, "removeMany").mockRejectedValue(failure);
}

beforeEach(async () => {
  jest.restoreAllMocks();
  resetSecureStoreMock();
  await AsyncStorage.clear();
  secureMap.clear();
});
afterEach(() => jest.restoreAllMocks());

it("an outage of every AsyncStorage mutation at sign-out leaves the old grant void after a restart", async () => {
  await recordLocalAuthorization(old, D1);
  const oldGrant = await AsyncStorage.getItem(grantKey);
  const oldSession = await AsyncStorage.getItem(ON_DEVICE_CONSENT_SESSION_KEY);
  asyncStorageMutationOutage();
  await expect(retireOnDeviceStateAtSignOut()).resolves.toBeUndefined();
  expect(await getLocalAuthorization(old.userId, old.source)).toBeNull();
  jest.restoreAllMocks(); // storage recovered before the next app run
  expect(await AsyncStorage.getItem(grantKey)).toBe(oldGrant);
  expect(await AsyncStorage.getItem(ON_DEVICE_CONSENT_SESSION_KEY)).toBe(
    oldSession,
  );
  expect(
    await SecureStore.getItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY),
  ).toBeNull();
  expect(
    await restart().getLocalAuthorization(old.userId, old.source),
  ).toBeNull();
});

it("the authority is revoked at once: an app exit while sign-out waits behind a held native write leaves the grant void", async () => {
  await recordLocalAuthorization(old, D1); // the session exists, so the next setItem is the grant
  const invoked = deferred();
  const commit = deferred();
  const set = AsyncStorage.setItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, "setItem").mockImplementationOnce(async (k, v) => {
    invoked.resolve();
    await commit.promise; // not committed before the exit
    await set(k, v);
  });
  const writing = recordLocalAuthorization(fresh, D2);
  await invoked.promise;
  const signingOut = retireOnDeviceStateAtSignOut();
  await new Promise<void>((r) => setTimeout(r, 0));
  // The app exits here: the chain never reached the AsyncStorage writes.
  const sessionAtExit = await AsyncStorage.getItem(
    ON_DEVICE_CONSENT_SESSION_KEY,
  );
  const afterExit = await restart().getLocalAuthorization(
    old.userId,
    old.source,
  );
  commit.resolve(); // always release, even when the invariant fails
  await Promise.all([writing, signingOut]);
  expect(sessionAtExit).not.toBeNull();
  expect(afterExit).toBeNull();
});

it("a grant write in flight that starts a new authority after the first revocation is revoked again in the chain", async () => {
  await recordLocalAuthorization(old, D1); // the session exists
  const reading = deferred();
  const release = deferred();
  const get = AsyncStorage.getItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, "getItem").mockImplementationOnce(async (k) => {
    reading.resolve();
    await release.promise; // the session read of the next grant write is held
    return get(k);
  });
  const writing = recordLocalAuthorization(fresh, D2);
  await reading.promise;
  // Only the grant write itself reaches disk; every sign-out mutation fails.
  asyncStorageMutationOutage((k) => k === grantKey);
  const signingOut = retireOnDeviceStateAtSignOut();
  await new Promise<void>((r) => setTimeout(r, 0));
  release.resolve();
  await Promise.all([writing, signingOut]);
  jest.restoreAllMocks();
  expect(
    JSON.parse((await AsyncStorage.getItem(grantKey)) ?? "null")?.connectionId,
  ).toBe(fresh.connectionId);
  expect(
    await SecureStore.getItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY),
  ).toBeNull();
  expect(
    await restart().getLocalAuthorization(fresh.userId, fresh.source),
  ).toBeNull();
});

it("a failed SecureStore delete at sign-out writes a new authority, so the grant stays void after a restart", async () => {
  await recordLocalAuthorization(old, D1);
  const before = await SecureStore.getItemAsync(
    ON_DEVICE_CONSENT_AUTHORITY_KEY,
  );
  secure.deleteItemAsync
    .mockRejectedValueOnce(new Error("synthetic keychain delete failure"))
    .mockRejectedValueOnce(new Error("synthetic keychain delete failure"));
  asyncStorageMutationOutage();
  await retireOnDeviceStateAtSignOut();
  jest.restoreAllMocks();
  const after = await SecureStore.getItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY);
  expect(after).toEqual(expect.any(String));
  expect(after).not.toBe(before);
  expect(
    await restart().getLocalAuthorization(old.userId, old.source),
  ).toBeNull();
});

it("fails closed: an unreadable authority authorizes nothing, and a readable one again authorizes the grant", async () => {
  await recordLocalAuthorization(old, D1);
  secure.getItemAsync.mockRejectedValueOnce(
    new Error("synthetic keychain read failure"),
  );
  expect(await getLocalAuthorization(old.userId, old.source)).toBeNull();
  expect(
    (await getLocalAuthorization(old.userId, old.source))?.connectionId,
  ).toBe(old.connectionId);
});

it("fails closed: a missing authority, or a grant with no authority, authorizes nothing; the next Connect starts one", async () => {
  await recordLocalAuthorization(old, D1);
  const stored = JSON.parse((await AsyncStorage.getItem(grantKey)) ?? "{}");
  await SecureStore.deleteItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY);
  expect(await getLocalAuthorization(old.userId, old.source)).toBeNull();
  await recordLocalAuthorization(old, D1);
  const { authority: _dropped, ...unbound } = JSON.parse(
    (await AsyncStorage.getItem(grantKey)) ?? "{}",
  );
  expect(_dropped).not.toBe(stored.authority);
  await AsyncStorage.setItem(grantKey, JSON.stringify(unbound));
  expect(await getLocalAuthorization(old.userId, old.source)).toBeNull();
  await recordLocalAuthorization(fresh, D2);
  expect(
    (await restart().getLocalAuthorization(fresh.userId, fresh.source))
      ?.connectionId,
  ).toBe(fresh.connectionId);
});

it("an authority write failure on Connect rejects the grant write rather than writing an unbound grant", async () => {
  const failure = new Error("synthetic keychain write failure");
  secure.setItemAsync.mockRejectedValueOnce(failure);
  await expect(recordLocalAuthorization(old, D1)).rejects.toBe(failure);
  expect(await AsyncStorage.getItem(grantKey)).toBeNull();
  await recordLocalAuthorization(old, D1);
  expect(
    (await getLocalAuthorization(old.userId, old.source))?.connectionId,
  ).toBe(old.connectionId);
});

it("a sign-out that starts while a grant is being read returns no grant", async () => {
  await recordLocalAuthorization(old, D1);
  const reading = deferred();
  const release = deferred();
  const get = AsyncStorage.getItem.bind(AsyncStorage);
  let held = false;
  jest.spyOn(AsyncStorage, "getItem").mockImplementation(async (k) => {
    if (k !== ON_DEVICE_CONSENT_SESSION_KEY || held) return get(k);
    held = true;
    const value = await get(k); // read before the sign-out, delivered after it
    reading.resolve();
    await release.promise;
    return value;
  });
  const read = getLocalAuthorization(old.userId, old.source);
  await reading.promise;
  const signingOut = retireOnDeviceStateAtSignOut();
  release.resolve();
  expect(await read).toBeNull();
  await signingOut;
});

it("control: the same consent survives a restart, and full retirement revokes the authority too", async () => {
  await recordLocalAuthorization(old, D1);
  expect(
    (await restart().getLocalAuthorization(old.userId, old.source))
      ?.connectionId,
  ).toBe(old.connectionId);
  await retireOnDeviceState();
  expect(
    await SecureStore.getItemAsync(ON_DEVICE_CONSENT_AUTHORITY_KEY),
  ).toBeNull();
  expect(
    await restart().getLocalAuthorization(old.userId, old.source),
  ).toBeNull();
});
