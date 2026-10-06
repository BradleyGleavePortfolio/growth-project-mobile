/**
 * Sol B-362-8 (was C-362-14): a sign-out whose removal fails must not let the
 * old grant authorize again after an app restart. Every grant is bound to the
 * phone's consent session; sign-out replaces it before any removal, and an
 * absent or unreadable session authorizes nothing. A restart is a fresh module
 * lifetime over the SAME disk. Synthetic storage only; no native build,
 * network or health data.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ON_DEVICE_CONSENT_SESSION_KEY,
  ON_DEVICE_STATE_PREFIX,
  getLocalAuthorization,
  recordLocalAuthorization,
  retireOnDeviceStateAtSignOut,
} from "../onDeviceState";

const old = {
  userId: "durable-user",
  source: "HEALTH_CONNECT" as const,
  connectionId: "old-connection",
};
const fresh = { ...old, connectionId: "fresh-connection" };
const apple = {
  ...old,
  source: "APPLE_HEALTHKIT" as const,
  connectionId: "apple-connection",
};
const D1 = new Date("2026-10-01T00:00:00.000Z");
const D2 = new Date("2026-10-02T00:00:00.000Z");

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { resolve, promise };
}

/** App restart: fresh module state (no in-memory sign-out watermark), same disk. */
function restart(): typeof import("../onDeviceState") {
  let state: typeof import("../onDeviceState") | undefined;
  jest.isolateModules(() => {
    jest.doMock("@react-native-async-storage/async-storage", () => ({
      __esModule: true,
      default: AsyncStorage,
    }));
    state = require("../onDeviceState");
  });
  if (!state) throw new Error("restart setup failed");
  return state;
}

async function authKeys(): Promise<readonly string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) =>
    k.startsWith(`${ON_DEVICE_STATE_PREFIX}auth:`),
  );
}

/** removeMany rejects whenever it touches a health key (other keys still go). */
function failHealthRemoval() {
  const remove = AsyncStorage.removeMany.bind(AsyncStorage);
  return jest
    .spyOn(AsyncStorage, "removeMany")
    .mockImplementation(async (keys) => {
      if (keys.some((k) => k.startsWith(ON_DEVICE_STATE_PREFIX)))
        throw new Error("synthetic removal failure");
      await remove(keys);
    });
}

/** setItem rejects for the consent session key only. */
function failSessionWrite() {
  const set = AsyncStorage.setItem.bind(AsyncStorage);
  return jest
    .spyOn(AsyncStorage, "setItem")
    .mockImplementation(async (k, v) => {
      if (k === ON_DEVICE_CONSENT_SESSION_KEY)
        throw new Error("synthetic session write failure");
      await set(k, v);
    });
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
});
afterEach(() => jest.restoreAllMocks());

it.each(["getAllKeys", "removeMany"] as const)(
  "%s rejection at sign-out: the grant left on disk stays void after a restart",
  async (operation) => {
    await recordLocalAuthorization(old, D1);
    await recordLocalAuthorization(apple, D1);
    if (operation === "getAllKeys") {
      jest
        .spyOn(AsyncStorage, "getAllKeys")
        .mockRejectedValueOnce(new Error("synthetic enumeration failure"));
    } else {
      failHealthRemoval();
    }
    await expect(retireOnDeviceStateAtSignOut()).resolves.toBeUndefined();
    jest.restoreAllMocks(); // storage recovered before the next app run
    expect(await authKeys()).toHaveLength(2); // the removal really failed
    const next = restart();
    expect(await next.getLocalAuthorization(old.userId, old.source)).toBeNull();
    expect(
      await next.getLocalAuthorization(apple.userId, apple.source),
    ).toBeNull();
  },
);

it("session write AND removal fail at sign-out: the stored session is removed, so the grant stays void", async () => {
  await recordLocalAuthorization(old, D1);
  failSessionWrite();
  failHealthRemoval();
  await expect(retireOnDeviceStateAtSignOut()).resolves.toBeUndefined();
  jest.restoreAllMocks();
  expect(await authKeys()).toHaveLength(1);
  expect(await AsyncStorage.getItem(ON_DEVICE_CONSENT_SESSION_KEY)).toBeNull();
  expect(
    await restart().getLocalAuthorization(old.userId, old.source),
  ).toBeNull();
});

it("a grant write in flight at a sign-out whose removal fails stays void after a restart", async () => {
  await recordLocalAuthorization(old, D1); // the session exists, so the next setItem is the grant
  const invoked = deferred();
  const commit = deferred();
  const set = AsyncStorage.setItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, "setItem").mockImplementationOnce(async (k, v) => {
    invoked.resolve();
    await commit.promise;
    await set(k, v);
  });
  const writing = recordLocalAuthorization(fresh, D2);
  await invoked.promise;
  failHealthRemoval();
  const signingOut = retireOnDeviceStateAtSignOut();
  commit.resolve();
  await Promise.all([writing, signingOut]);
  jest.restoreAllMocks();
  expect(await authKeys()).toHaveLength(1);
  expect(await getLocalAuthorization(old.userId, old.source)).toBeNull();
  expect(
    await restart().getLocalAuthorization(old.userId, old.source),
  ).toBeNull();
});

it("control: a grant with no sign-out survives a restart", async () => {
  await recordLocalAuthorization(old, D1);
  expect(
    (await restart().getLocalAuthorization(old.userId, old.source))
      ?.connectionId,
  ).toBe(old.connectionId);
});

it("control: a successful sign-out removes every grant and replaces the session", async () => {
  await recordLocalAuthorization(old, D1);
  const before = await AsyncStorage.getItem(ON_DEVICE_CONSENT_SESSION_KEY);
  await retireOnDeviceStateAtSignOut();
  expect(await authKeys()).toEqual([]);
  const after = await AsyncStorage.getItem(ON_DEVICE_CONSENT_SESSION_KEY);
  expect(after).toEqual(expect.any(String));
  expect(after).not.toBe(before);
  expect(
    await restart().getLocalAuthorization(old.userId, old.source),
  ).toBeNull();
});

it("a new Connect after a failed sign-out is honoured now and after a restart; the old grant is not", async () => {
  await recordLocalAuthorization(old, D1);
  await recordLocalAuthorization(apple, D1);
  failHealthRemoval();
  await retireOnDeviceStateAtSignOut();
  jest.restoreAllMocks();
  await recordLocalAuthorization(fresh, D2);
  expect(
    (await getLocalAuthorization(fresh.userId, fresh.source))?.connectionId,
  ).toBe(fresh.connectionId);
  const next = restart();
  expect(
    (await next.getLocalAuthorization(fresh.userId, fresh.source))
      ?.connectionId,
  ).toBe(fresh.connectionId);
  expect(
    await next.getLocalAuthorization(apple.userId, apple.source),
  ).toBeNull();
});

it("fails closed: an unreadable session authorizes nothing, and a readable one again authorizes the grant", async () => {
  await recordLocalAuthorization(old, D1);
  const get = AsyncStorage.getItem.bind(AsyncStorage);
  jest.spyOn(AsyncStorage, "getItem").mockImplementation(async (k) => {
    if (k === ON_DEVICE_CONSENT_SESSION_KEY)
      throw new Error("synthetic read failure");
    return get(k);
  });
  expect(await getLocalAuthorization(old.userId, old.source)).toBeNull();
  jest.restoreAllMocks();
  expect(
    (await getLocalAuthorization(old.userId, old.source))?.connectionId,
  ).toBe(old.connectionId);
});

it("fails closed: a missing session, or a grant with no session, authorizes nothing; the next Connect starts a session", async () => {
  await recordLocalAuthorization(old, D1);
  await AsyncStorage.removeItem(ON_DEVICE_CONSENT_SESSION_KEY);
  expect(await getLocalAuthorization(old.userId, old.source)).toBeNull();
  await AsyncStorage.setItem(
    `${ON_DEVICE_STATE_PREFIX}auth:${apple.source}:${apple.userId}`,
    JSON.stringify({
      v: 1,
      userId: apple.userId,
      source: apple.source,
      connectionId: "x",
      grantedAt: D1.toISOString(),
    }),
  );
  await recordLocalAuthorization(fresh, D2);
  expect(
    (await getLocalAuthorization(fresh.userId, fresh.source))?.connectionId,
  ).toBe(fresh.connectionId);
  expect(await getLocalAuthorization(apple.userId, apple.source)).toBeNull();
});

it("a session read failure on Connect rejects the grant write rather than writing an unbound grant", async () => {
  const failure = new Error("synthetic read failure");
  jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(failure);
  await expect(recordLocalAuthorization(old, D1)).rejects.toBe(failure);
  expect(await authKeys()).toEqual([]);
  await recordLocalAuthorization(old, D1);
  expect(
    (await getLocalAuthorization(old.userId, old.source))?.connectionId,
  ).toBe(old.connectionId);
});
