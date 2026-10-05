/**
 * Sol B-362-9: signOut settles only after the on-device health retirement it
 * started, even when another cleanup step rejects, and `logout` is emitted
 * only after it. Covers a rejection inside the parallel clear (logout still
 * fires, after the drain) and one before it (signOut rejects, after the
 * drain). Synthetic native-commit scheduler; no native build, network or
 * health data. Unrelated signOut integrations use the authActions test seams.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "../authActions";
import { authEvents } from "../../utils/authEvents";
import {
  getLocalAuthorization,
  recordLocalAuthorization,
} from "../health/onDeviceState";
import { clearUserCache } from "../../lib/userCache";
import { retireAndDrainIdentityPersistences } from "../queryClient";

jest.mock("../api", () => ({
  usersApi: { updatePushToken: jest.fn(async () => ({ data: {} })) },
  profileApi: { get: jest.fn(async () => ({ data: {} })) },
}));
jest.mock("../sentry", () => ({ setSentryUser: jest.fn() }));
jest.mock("../../lib/analytics", () => ({ reset: jest.fn() }));
jest.mock("../../utils/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
}));
jest.mock("../../lib/userCache", () => ({
  readUserCacheSync: jest.fn(() => ({ id: "health-queue-user" })),
  readUserCache: jest.fn(async () => ({ id: "health-queue-user" })),
  clearUserCache: jest.fn(async () => undefined),
}));
jest.mock("../../offline/sync/sync-engine", () => ({
  deleteWorkoutLogsForUser: jest.fn(async () => 0),
}));
jest.mock("../../storage/mmkv", () => {
  const storage = () => ({
    getString: () => undefined,
    getStringAsync: async () => undefined,
    getAllKeys: async () => [],
    delete: async () => undefined,
    set: async () => undefined,
  });
  return {
    clearAllStorage: jest.fn(async () => undefined),
    prefsStorage: storage(),
    cacheStorage: storage(),
    secureStorage: storage(),
  };
});
jest.mock("../queryClient", () => ({
  purgePersistedQueryCacheForAllUsers: jest.fn(async () => undefined),
  retireAndDrainIdentityPersistences: jest.fn(async () => undefined),
  settleAndClearQueryCache: jest.fn(async () => undefined),
}));
jest.mock("../../lib/consultation/storage", () => ({
  LEGACY_DRAFT_PREFIX: "consultation_v1:",
  purgeConsultationDraft: jest.fn(async () => undefined),
}));
jest.mock("../../db/fastingDb", () => ({
  getActiveFast: jest.fn(async () => null),
  getFastingHistory: jest.fn(async () => []),
  startFast: jest.fn(async () => undefined),
  endFast: jest.fn(async () => undefined),
}));

const scope = {
  userId: "health-queue-user",
  source: "HEALTH_CONNECT" as const,
  connectionId: "health-drain-connection",
};
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { promise, resolve };
}

/** A grant write whose native commit is held until `commit()`. */
async function heldGrantWrite() {
  await recordLocalAuthorization(scope); // the consent session exists
  const invoked = deferred();
  const commit = deferred();
  const set = AsyncStorage.setItem.bind(AsyncStorage);
  jest
    .spyOn(AsyncStorage, "setItem")
    .mockImplementationOnce(async (key, value) => {
      invoked.resolve();
      await commit.promise;
      await set(key, value);
    });
  const writing = recordLocalAuthorization(scope);
  await invoked.promise;
  return { writing, commit: commit.resolve };
}

const logout = jest.fn();
beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  logout.mockClear();
  authEvents.on("logout", logout);
});
afterEach(() => {
  authEvents.off("logout", logout);
  jest.restoreAllMocks();
});

it("a rejection inside the parallel clear: logout fires and signOut resolves only after the held health write", async () => {
  const held = await heldGrantWrite();
  jest
    .mocked(clearUserCache)
    .mockRejectedValueOnce(new Error("synthetic user-cache removal failure"));
  let settled = false;
  const signingOut = signOut(scope.userId).then(() => {
    settled = true;
  });
  for (let i = 0; i < 30; i += 1) await tick();
  const early = { settled, logout: logout.mock.calls.length };
  held.commit();
  await Promise.all([held.writing, signingOut]);
  expect(early).toEqual({ settled: false, logout: 0 });
  expect(logout).toHaveBeenCalledTimes(1);
  expect(await getLocalAuthorization(scope.userId, scope.source)).toBeNull();
});

it("a rejection before the parallel clear: signOut rejects only after the held health write", async () => {
  const held = await heldGrantWrite();
  const failure = new Error("synthetic identity drain failure");
  jest
    .mocked(retireAndDrainIdentityPersistences)
    .mockRejectedValueOnce(failure);
  let settled = false;
  const signingOut = signOut(scope.userId)
    .then(
      () => null,
      (err: unknown) => err,
    )
    .finally(() => {
      settled = true;
    });
  for (let i = 0; i < 30; i += 1) await tick();
  const early = settled;
  held.commit();
  await held.writing;
  expect(await signingOut).toBe(failure);
  expect(early).toBe(false);
  expect(await getLocalAuthorization(scope.userId, scope.source)).toBeNull();
});

it("control: with no rejection, signOut still waits for the held health write, then emits logout once", async () => {
  const held = await heldGrantWrite();
  let settled = false;
  const signingOut = signOut(scope.userId).then(() => {
    settled = true;
  });
  for (let i = 0; i < 30; i += 1) await tick();
  const early = { settled, logout: logout.mock.calls.length };
  held.commit();
  await Promise.all([held.writing, signingOut]);
  expect(early).toEqual({ settled: false, logout: 0 });
  expect(logout).toHaveBeenCalledTimes(1);
});
