/**
 * S-COACH-3 (agent 113) — OR-112-16 / B-329-1 (Sol) / C-329-6 (Opus): the
 * first-package create is idempotent end to end. One create attempt has one
 * Idempotency-Key and one body, stored on the device BEFORE the request
 * leaves, and every retry re-sends exactly that pair, including after the
 * app is killed and reopened. The backend (#641) replays the package that
 * key made. Each test here failed at 83ee0e46 (no stored intent, a list
 * lookup decided whether to create again).
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

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockUpdate = jest.fn();
jest.mock("../../../../api/packagesApi", () => ({
  coachPackagesApi: {
    create: (...a: unknown[]) => mockCreate(...a),
    list: (...a: unknown[]) => mockList(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

const mockStore = new Map<string, string>();
jest.mock("../../../../storage/mmkv", () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => mockStore.get(k),
    set: async (k: string, v: string) => {
      mockStore.set(k, v);
    },
    delete: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

jest.mock("../../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: "coach_1", email: "c@example.com" }),
}));

import FirstPackageForm from "../FirstPackageForm";
import {
  intentStorageKey,
  newIntent,
  parseIntent,
} from "../../../../lib/coachSetup/packageCreateIntent";

const offline = () =>
  Object.assign(new Error("timeout of 30000ms exceeded"), {
    code: "ECONNABORTED",
    request: {},
  });
const httpError = (status: number, data: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data, headers: {} },
  });
const row = (id = "pkg_1") => ({
  id,
  title: "North coaching",
  priceCents: 4900,
  billingInterval: "monthly",
});

const KEY = intentStorageKey("coach_1");

beforeEach(() => {
  mockStore.clear();
  mockCreate.mockReset();
  mockList.mockReset();
  mockUpdate.mockReset();
});

const mount = (onCreated = jest.fn()) =>
  render(
    <FirstPackageForm
      defaultTitle="North coaching"
      chargesEnabled
      onCreated={onCreated}
    />,
  );

describe("OR-112-16 durable package-create intent", () => {
  it("the key and body are stored before the create is sent", async () => {
    let seenAtSend: string | undefined;
    mockCreate.mockImplementationOnce(async () => {
      seenAtSend = mockStore.get(KEY);
      throw offline();
    });
    const { getByTestId, findByTestId } = await mount();
    await fireEvent.press(getByTestId("first-package-create"));
    await findByTestId("first-package-error");
    const stored = parseIntent(seenAtSend);
    expect(stored).not.toBeNull();
    expect(stored?.key).toBe(mockCreate.mock.calls[0][1]);
    expect(stored?.input).toEqual(mockCreate.mock.calls[0][0]);
    expect(stored?.packageId).toBeNull();
  });

  it("the app is killed after a timeout: on reopen the same key and body are re-sent, once", async () => {
    mockCreate.mockRejectedValueOnce(offline());
    const first = await mount();
    await fireEvent.press(first.getByTestId("first-package-create"));
    await first.findByTestId("first-package-error");
    const sentKey = mockCreate.mock.calls[0][1];
    const sentBody = mockCreate.mock.calls[0][0];
    await first.unmount();

    // Reopen: a fresh component with no memory, only device storage.
    mockCreate.mockResolvedValueOnce({ data: row("pkg_1") });
    const onCreated = jest.fn();
    const second = await mount(onCreated);
    await second.findByTestId("first-package-resumed");
    await fireEvent.press(second.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][1]).toBe(sentKey);
    expect(mockCreate.mock.calls[1][0]).toEqual(sentBody);
    expect(mockList).not.toHaveBeenCalled();
    // Finished: the intent is gone, so the next package gets a new key.
    expect(mockStore.has(KEY)).toBe(false);
  });

  it("publish failed after create: on reopen create is not called again", async () => {
    const api = jest.requireMock("../../../../services/api").default;
    mockCreate.mockResolvedValueOnce({ data: row("pkg_1") });
    api.post.mockRejectedValueOnce(httpError(503));
    const first = await mount();
    await fireEvent.press(first.getByTestId("first-package-create"));
    await first.findByTestId("first-package-error");
    expect(parseIntent(mockStore.get(KEY))?.packageId).toBe("pkg_1");
    await first.unmount();

    const onCreated = jest.fn();
    const second = await mount(onCreated);
    await second.findByTestId("first-package-resumed");
    await fireEvent.press(second.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(onCreated.mock.calls[0][0].id).toBe("pkg_1");
  });

  it("a definitive refusal clears the intent; the next send uses a new key", async () => {
    mockCreate
      .mockRejectedValueOnce(
        httpError(400, { code: "PACKAGE_INVALID", message: "Name too long." }),
      )
      .mockResolvedValueOnce({ data: row() });
    const onCreated = jest.fn();
    const { getByTestId, findByTestId } = await mount(onCreated);
    await fireEvent.press(getByTestId("first-package-create"));
    await findByTestId("first-package-error");
    expect(mockStore.has(KEY)).toBe(false);
    await fireEvent.press(getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate.mock.calls[1][1]).not.toBe(mockCreate.mock.calls[0][1]);
  });
});

describe("parseIntent", () => {
  it("drops malformed and foreign-version intents, never an old one (B-329-1)", () => {
    const now = 1_800_000_000_000;
    const it0 = newIntent(
      { title: "A", priceCents: 0, billingInterval: "one_time" },
      now,
    );
    expect(parseIntent(JSON.stringify(it0))?.key).toBe(it0.key);
    expect(parseIntent("not json")).toBeNull();
    expect(parseIntent(JSON.stringify({ ...it0, v: 2 }))).toBeNull();
    expect(
      parseIntent(JSON.stringify({ ...it0, input: { title: 1 } })),
    ).toBeNull();
    // The backend keeps the key forever, so a week-old intent still replays.
    expect(
      parseIntent(JSON.stringify({ ...it0, createdAt: now - 7 * 86_400_000 }))
        ?.key,
    ).toBe(it0.key);
  });
});
