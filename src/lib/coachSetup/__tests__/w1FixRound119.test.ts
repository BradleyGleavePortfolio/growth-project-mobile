/**
 * B-WIZ2-119 (agent 119) — fix round for mobile #345 (coach setup W1).
 * B-345-1 (Sol, retained): a create retired while its write-ahead was saving
 * removed that intent, even though a replacement form of the same account
 * could already have read it and sent its key. A later retry then made a
 * second package under a new key. Each case below failed at 97c9005e.
 */
const mockStore = new Map<string, string>();
const mockHold: { first: Promise<void> | null; writes: number } = {
  first: null,
  writes: 0,
};
jest.mock("../../../storage/mmkv", () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => mockStore.get(k),
    set: async (k: string, v: string) => {
      mockStore.set(k, v);
      mockHold.writes += 1;
      // Storage has the value; only its completion is late.
      if (mockHold.writes === 1 && mockHold.first) await mockHold.first;
    },
    delete: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

import type { PackageCreateInput } from "../../../api/packagesApi";
import {
  createPackageOnce,
  intentStorageKey,
  loadIntent,
  PackageCreateStoppedError,
} from "../packageCreateIntent";

const KEY = intentStorageKey("coach_1");
const input: PackageCreateInput = {
  title: "North coaching",
  priceCents: 4900,
  currency: "usd",
  billingInterval: "monthly",
  intervalCount: 1,
};
/** Backend double: one package per key; `lose` drops the answer. */
const rows = new Map<string, string>();
let lose = true;
const create = jest.fn(async (_b: PackageCreateInput, key: string) => {
  if (!rows.has(key)) rows.set(key, `pkg_${rows.size + 1}`);
  if (lose)
    throw Object.assign(new Error("Network Error"), {
      code: "ERR_NETWORK",
      request: {},
    });
  return { data: { id: rows.get(key) as string } };
});
const deps = { create, update: jest.fn(async () => ({})) };
const run = (
  earlier: Parameters<typeof createPackageOnce>[0]["earlier"],
  isLive: () => boolean = () => true,
) =>
  createPackageOnce({
    coachId: "coach_1",
    scope: "wizard",
    input,
    earlier,
    deps,
    onIntent: jest.fn(),
    isLive,
  });
const hydrate = async () => {
  const read = await loadIntent("coach_1");
  return read.kind === "found" ? read.intent : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  rows.clear();
  lose = true;
  mockHold.first = null;
  mockHold.writes = 0;
});

/** The first form writes its intent, is retired, and a second form sends it. */
async function retiredWhileReplacementSends() {
  let release: () => void = () => undefined;
  mockHold.first = new Promise<void>((r) => (release = r));
  let oldLive = true;
  const old = run(null, () => oldLive).catch((e: unknown) => e);
  expect(mockStore.has(KEY)).toBe(true);
  oldLive = false;
  const seen = await hydrate();
  expect(seen).not.toBeNull();
  await expect(run(seen)).rejects.toMatchObject({ code: "ERR_NETWORK" });
  release();
  expect(await old).toBeInstanceOf(PackageCreateStoppedError);
  return seen?.key as string;
}

describe("B-345-1: a retired create never removes an intent it cannot prove unsent", () => {
  it("the key a replacement form sent stays on disk", async () => {
    const sentKey = await retiredWhileReplacementSends();
    expect(rows.size).toBe(1);
    expect(JSON.parse(mockStore.get(KEY) as string).key).toBe(sentKey);
  });

  it("the next retry re-sends that key: one package, never two", async () => {
    const sentKey = await retiredWhileReplacementSends();
    lose = false;
    const out = await run(await hydrate());
    expect(rows.size).toBe(1);
    expect(out.packageId).toBe("pkg_1");
    expect(create.mock.calls.map((c) => c[1])).toEqual([sentKey, sentKey]);
  });

  it("retired with no replacement: the same account later finishes the same create with the same key", async () => {
    let release: () => void = () => undefined;
    mockHold.first = new Promise<void>((r) => (release = r));
    let live = true;
    const old = run(null, () => live).catch((e: unknown) => e);
    live = false;
    release();
    expect(await old).toBeInstanceOf(PackageCreateStoppedError);
    expect(create).not.toHaveBeenCalled();
    const kept = await hydrate();
    expect(kept?.packageId).toBeNull();
    lose = false;
    const out = await run(kept);
    expect(create.mock.calls.map((c) => c[1])).toEqual([kept?.key]);
    expect(rows.size).toBe(1);
    expect(out.intent.key).toBe(kept?.key);
  });

  it("control: a lost answer with no retirement keeps its key for the retry", async () => {
    await run(null).catch(() => undefined);
    await run(await hydrate()).catch(() => undefined);
    expect(rows.size).toBe(1);
    expect(create.mock.calls[0][1]).toBe(create.mock.calls[1][1]);
  });
});
