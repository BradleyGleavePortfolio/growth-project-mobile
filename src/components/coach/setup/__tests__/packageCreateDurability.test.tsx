/**
 * B-329-1 (Sol, retained) + C-329-8 (Opus) — B-COACH-5, agent 115.
 *
 * The first-package create is durable only if its identity is on disk before
 * the request leaves. These tests drive the real FirstPackageForm and the real
 * intent helper over a storage double that can refuse reads and writes, and a
 * key-deduplicating backend double that can commit and lose the answer.
 * Each one failed at 3a90f28a: a refused write still sent the create (so a
 * restart sent a second key and made a second package), a refused read was
 * taken as "nothing was sent", a day-old intent was dropped, and a removed
 * package needed a second tap.
 */
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(),
  },
}));
jest.mock("../../../../services/sentry", () => ({
  captureError: jest.fn(),
  setSentryUser: jest.fn(),
}));

// Backend double: one package per Idempotency-Key (#641 createIdempotent).
const mockRows = new Map<string, { id: string }>();
let mockLoseAnswer = false;
const mockCreate = jest.fn(async (_body: unknown, key: string) => {
  let row = mockRows.get(key);
  if (!row) {
    row = { id: `pkg_${mockRows.size + 1}` };
    mockRows.set(key, row);
  }
  if (mockLoseAnswer) {
    mockLoseAnswer = false;
    throw Object.assign(new Error("timeout of 30000ms exceeded"), {
      code: "ECONNABORTED",
      request: {},
    });
  }
  return { data: row };
});
const mockUpdate = jest.fn(async (id: string) => ({ data: { id } }));
jest.mock("../../../../api/packagesApi", () => ({
  coachPackagesApi: {
    create: (body: unknown, key: string) => mockCreate(body, key),
    list: jest.fn(),
    update: (id: string) => mockUpdate(id),
  },
}));
const mockPublish = jest.fn(async () => ({}));
jest.mock("../../../../api/coachSetupApi", () => ({
  coachSetupApi: {
    publishPackage: () => mockPublish(),
    inviteLink: jest.fn(async () => ({ code: "INV1" })),
    bindFreePackage: jest.fn(async () => ({})),
  },
}));

const mockStore = new Map<string, string>();
const mockStorage = { failWrites: 0, failReads: 0 };
jest.mock("../../../../storage/mmkv", () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => {
      if (mockStorage.failReads > 0) {
        mockStorage.failReads--;
        throw new Error("storage read failed");
      }
      return mockStore.get(k);
    },
    set: async (k: string, v: string) => {
      if (mockStorage.failWrites > 0) {
        mockStorage.failWrites--;
        throw new Error("storage full");
      }
      mockStore.set(k, v);
    },
    delete: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

let mockUser: { id: string } | null = { id: "coach_1" };
jest.mock("../../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUser,
}));

import FirstPackageForm from "../FirstPackageForm";
import {
  intentStorageKey,
  newIntent,
} from "../../../../lib/coachSetup/packageCreateIntent";

const KEY = intentStorageKey("coach_1");

beforeEach(() => {
  mockStore.clear();
  mockRows.clear();
  mockLoseAnswer = false;
  mockStorage.failWrites = 0;
  mockStorage.failReads = 0;
  mockUser = { id: "coach_1" };
  mockCreate.mockClear();
  mockUpdate.mockClear();
  mockPublish.mockClear();
});

const mount = (onCreated = jest.fn()) =>
  render(
    <FirstPackageForm
      defaultTitle="North coaching"
      chargesEnabled
      onCreated={onCreated}
    />,
  );

describe("B-329-1 — a fresh create is sent only after its identity is on disk", () => {
  it("storage refuses the write-ahead: nothing is sent, specific copy shows, and a restart makes exactly one package", async () => {
    mockStorage.failWrites = 1;
    const first = await mount();
    await fireEvent.press(first.getByTestId("first-package-create"));
    await first.findByTestId("first-package-error");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(first.queryByText(/Something went wrong/)).toBeNull();
    expect(
      first.getByText("This device could not save your package details"),
    ).toBeTruthy();

    // Storage recovers; the create commits but the answer is lost; the app
    // is killed and reopened, and the coach taps again.
    mockLoseAnswer = true;
    await fireEvent.press(first.getByTestId("first-package-create"));
    await first.findByTestId("first-package-error");
    await first.unmount();
    const onCreated = jest.fn();
    const second = await mount(onCreated);
    await second.findByTestId("first-package-resumed");
    await fireEvent.press(second.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    expect(mockRows.size).toBe(1);
    expect(new Set(mockCreate.mock.calls.map((c) => c[1])).size).toBe(1);
    expect(mockStore.has(KEY)).toBe(false);
  });

  it("an unreadable stored intent is not taken as 'nothing was sent': no fresh create until it reads", async () => {
    // A create from before the restart is on disk and already committed.
    const earlier = newIntent({
      title: "North coaching",
      priceCents: 4900,
      currency: "usd",
      billingInterval: "monthly",
      intervalCount: 1,
      description: null,
      trialDays: 0,
      features: [],
    });
    mockStore.set(KEY, JSON.stringify(earlier));
    mockRows.set(earlier.key, { id: "pkg_1" });
    mockStorage.failReads = 2; // the mount read and the submit re-read fail
    const onCreated = jest.fn();
    const screen = await mount(onCreated);
    await fireEvent.press(screen.getByTestId("first-package-create"));
    await screen.findByTestId("first-package-error");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(
      screen.getByText("Your earlier package details could not be read"),
    ).toBeTruthy();

    // Storage reads again: the earlier key is re-sent, never a new one.
    await fireEvent.press(screen.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls.map((c) => c[1])).toEqual([earlier.key]);
    expect(mockRows.size).toBe(1);
  });

  it("an intent from days ago still re-sends its own key (the backend keeps keys forever)", async () => {
    const old = newIntent(
      {
        title: "North coaching",
        priceCents: 4900,
        currency: "usd",
        billingInterval: "monthly",
        intervalCount: 1,
        description: null,
        trialDays: 0,
        features: [],
      },
      Date.now() - 3 * 86_400_000,
    );
    mockStore.set(KEY, JSON.stringify(old));
    mockRows.set(old.key, { id: "pkg_1" });
    const onCreated = jest.fn();
    const screen = await mount(onCreated);
    await screen.findByTestId("first-package-resumed");
    await fireEvent.press(screen.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls.map((c) => c[1])).toEqual([old.key]);
    expect(onCreated.mock.calls[0][0].id).toBe("pkg_1");
    expect(mockRows.size).toBe(1);
  });

  it("no signed-in account: nothing is sent and the copy says what to do", async () => {
    mockUser = null;
    const screen = await mount();
    await fireEvent.press(screen.getByTestId("first-package-create"));
    await screen.findByTestId("first-package-error");
    expect(mockCreate).not.toHaveBeenCalled();
    expect(screen.getByText("Your account is still loading")).toBeTruthy();
  });

  it("leaving the screen while the create is in flight writes nothing into the form afterwards", async () => {
    let release!: () => void;
    mockCreate.mockImplementationOnce(
      (_b: unknown, key: string) =>
        new Promise((resolve) => {
          release = () => {
            mockRows.set(key, { id: "pkg_1" });
            resolve({ data: { id: "pkg_1" } });
          };
        }),
    );
    const onCreated = jest.fn();
    const screen = await mount(onCreated);
    await fireEvent.press(screen.getByTestId("first-package-create"));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    await screen.unmount();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(onCreated).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    // B-329-5 (agent 118): nothing is written after the form closed. The
    // intent that was sent stays, so reopening re-sends the same key and the
    // server answers with the same package: no second package.
    const kept = JSON.parse(mockStore.get(KEY) as string);
    expect(kept.packageId).toBeNull();
    const again = await mount(onCreated);
    await again.findByTestId("first-package-resumed");
    await fireEvent.press(again.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0][0].id).toBe("pkg_1");
    expect(mockRows.size).toBe(1);
    expect(mockCreate.mock.calls[1][1]).toBe(kept.key);
  });
});

describe("C-329-8 — a removed draft is recreated in the same tap", () => {
  it("410 IDEMPOTENT_PACKAGE_REMOVED with unchanged details starts a fresh create at once", async () => {
    const gone = newIntent({
      title: "North coaching",
      priceCents: 4900,
      currency: "usd",
      billingInterval: "monthly",
      intervalCount: 1,
      description: null,
      trialDays: 0,
      features: [],
    });
    mockStore.set(KEY, JSON.stringify(gone));
    mockCreate.mockImplementationOnce(async () => {
      throw Object.assign(new Error("HTTP 410"), {
        response: {
          status: 410,
          data: { code: "IDEMPOTENT_PACKAGE_REMOVED" },
          headers: {},
        },
      });
    });
    const onCreated = jest.fn();
    const screen = await mount(onCreated);
    await screen.findByTestId("first-package-resumed");
    await fireEvent.press(screen.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][1]).not.toBe(gone.key);
  });
});
