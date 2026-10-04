/**
 * B-WIZ2-119 (agent 119) — fix round for mobile #346 (coach setup W2).
 * B-346-3 (Sol): the form took its package from the defaults on screen
 * before the saved intent was read; hydration then showed the saved package
 * while the tap updated, published and reported the defaults. Each case
 * below failed at 2baea5b8.
 */
import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("../../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));
const mockCreate = jest.fn(async (..._a: unknown[]) => ({
  data: { id: "pkg_new" },
}));
const mockUpdate = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock("../../../../api/packagesApi", () => ({
  coachPackagesApi: {
    create: (...a: unknown[]) => mockCreate(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));
const mockPublish = jest.fn(async (..._a: unknown[]) => ({}));
const mockInvite = jest.fn(async () => ({ code: "SYNTH", url: "x" }));
const mockBind = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock("../../../../api/coachSetupApi", () => ({
  coachSetupApi: {
    publishPackage: (...a: unknown[]) => mockPublish(...a),
    inviteLink: () => mockInvite(),
    bindFreePackage: (...a: unknown[]) => mockBind(...a),
  },
}));
let mockUser: { id: string } | null = { id: "coach_1" };
jest.mock("../../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUser,
}));
const mockStore = new Map<string, string>();
const mockRead: { hold: Promise<void> | null } = { hold: null };
jest.mock("../../../../storage/mmkv", () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => {
      if (mockRead.hold) await mockRead.hold;
      return mockStore.get(k);
    },
    set: async (k: string, v: string) => {
      mockStore.set(k, v);
    },
    delete: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

import FirstPackageForm from "../FirstPackageForm";
import {
  intentStorageKey,
  newIntent,
} from "../../../../lib/coachSetup/packageCreateIntent";
import type { PackageCreateInput } from "../../../../api/packagesApi";

const KEY = intentStorageKey("coach_1");
const savedOneTime: PackageCreateInput = {
  title: "Saved one-time plan",
  priceCents: 9900,
  currency: "usd",
  billingInterval: "one_time",
  intervalCount: 1,
};
const form = (done = jest.fn()) => (
  <FirstPackageForm
    defaultTitle="Synthetic coaching"
    chargesEnabled
    onCreated={done}
  />
);
/** Holds the mount read; returns the release. */
function holdRead(): () => Promise<void> {
  let release: () => void = () => undefined;
  mockRead.hold = new Promise<void>((r) => (release = r));
  return async () => {
    await act(async () => {
      mockRead.hold = null;
      release();
    });
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockRead.hold = null;
  mockUser = { id: "coach_1" };
});

describe("B-346-3: nothing is sent from fields shown before hydration", () => {
  it("a tap during hydration of a made one-time package publishes it as shown, never the monthly defaults", async () => {
    mockStore.set(
      KEY,
      JSON.stringify({ ...newIntent(savedOneTime), packageId: "pkg_saved" }),
    );
    const release = holdRead();
    const done = jest.fn();
    const s = await render(form(done));
    await fireEvent.press(s.getByTestId("first-package-create"));
    expect(mockPublish).not.toHaveBeenCalled();
    await release();
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPublish.mock.calls).toEqual([["pkg_saved"]]);
    expect(done.mock.calls[0][0]).toMatchObject({
      id: "pkg_saved",
      title: "Saved one-time plan",
      priceCents: 9900,
      billingInterval: "one_time",
    });
  });

  it("a tap during hydration of an unsent free package re-sends that package with its own key", async () => {
    const free = newIntent({
      ...savedOneTime,
      title: "Saved free",
      priceCents: 0,
    });
    mockStore.set(KEY, JSON.stringify(free));
    const release = holdRead();
    const done = jest.fn();
    const s = await render(form(done));
    await fireEvent.press(s.getByTestId("first-package-create"));
    await release();
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][1]).toBe(free.key);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      title: "Saved free",
      priceCents: 0,
      billingInterval: "one_time",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockBind).toHaveBeenCalledWith("SYNTH", "pkg_new");
    expect(done.mock.calls[0][0]).toMatchObject({
      title: "Saved free",
      priceCents: 0,
      freeOnJoin: true,
    });
  });

  it("fields take no edits until hydration ends; a later edit is what gets published", async () => {
    mockStore.set(
      KEY,
      JSON.stringify({ ...newIntent(savedOneTime), packageId: "pkg_saved" }),
    );
    const release = holdRead();
    const done = jest.fn();
    const s = await render(form(done));
    expect(s.getByTestId("first-package-title").props.editable).toBe(false);
    expect(s.getByTestId("first-package-hydrating")).toBeTruthy();
    await release();
    expect(s.queryByTestId("first-package-hydrating")).toBeNull();
    expect(s.getByTestId("first-package-title").props.value).toBe(
      "Saved one-time plan",
    );
    await fireEvent.changeText(s.getByTestId("first-package-title"), "Renamed");
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(
      "pkg_saved",
      expect.objectContaining({ title: "Renamed", priceCents: 9900 }),
    );
    expect(done.mock.calls[0][0]).toMatchObject({
      title: "Renamed",
      billingInterval: "one_time",
    });
  });

  it("control: a tap during hydration for an account that then signs out sends nothing", async () => {
    mockStore.set(KEY, JSON.stringify(newIntent(savedOneTime)));
    const release = holdRead();
    const done = jest.fn();
    const s = await render(form(done));
    await fireEvent.press(s.getByTestId("first-package-create"));
    mockUser = null;
    await s.rerender(form(done));
    await release();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  it("control: with nothing saved, a tap after hydration publishes the shown defaults", async () => {
    const done = jest.fn();
    const s = await render(form(done));
    await waitFor(() =>
      expect(s.queryByTestId("first-package-hydrating")).toBeNull(),
    );
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(done.mock.calls[0][0]).toMatchObject({
      title: "Synthetic coaching",
      priceCents: 4900,
      billingInterval: "monthly",
    });
  });
});
