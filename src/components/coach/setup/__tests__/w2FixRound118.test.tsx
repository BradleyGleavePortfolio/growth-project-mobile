/**
 * B-WIZ-118 (agent 118) — fix round for mobile #346 (coach setup W2). Each
 * case below failed at 4522eb8e (+ #345 merge):
 *   B-345-1 (form level)  the coach's late cadence choice is what goes live
 *   B-329-5 (Opus) / B-346-1 (Sol)  the form sent, published, bound or called
 *            back after the form closed or the account changed
 *   C-346-2  a remembered package archived since trapped the form
 *   B-346-2 (Sol)  Get paid opened Stripe, re-read status or called back after
 *            unmount or sign-out; Retry repeated the wrong action
 *   B-346-1 (Opus)  first-person app copy on the checklist and setup screen
 *   production capability (job B-WIZ-118): a server with no live Stripe
 *            re-read is not described as "Stripe did not answer"
 */
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("../../../../services/sentry", () => ({
  captureError: jest.fn(),
  setSentryUser: jest.fn(),
}));

type Row = Record<string, unknown>;
const mockServer = {
  rows: new Map<string, Row>(),
  keys: new Map<string, string>(),
  creates: 0,
  patches: [] as Row[],
  publishFailOnce: false,
  publishHold: null as null | Promise<void>,
  binds: 0,
  inviteReads: 0,
};
function mockHttp(status: number, data: Row) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data, headers: {} },
  });
}
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(async (url: string) => {
      if (url === "/coaches/me/invite-link") {
        mockServer.inviteReads++;
        return { data: { code: "INV1", url: "https://example.test/j/INV1" } };
      }
      throw mockHttp(404, { code: "UNEXPECTED_ROUTE" });
    }),
    post: jest.fn(
      async (
        url: string,
        body: Row,
        cfg?: { headers?: Record<string, string> },
      ) => {
        if (url === "/v1/coach/packages") {
          const key = String(cfg?.headers?.["Idempotency-Key"] ?? "");
          let id = mockServer.keys.get(key);
          if (!id) {
            mockServer.creates++;
            id = `pkg_${mockServer.creates}`;
            mockServer.keys.set(key, id);
            mockServer.rows.set(id, {
              id,
              name: body.name,
              amount_cents: body.amount_cents,
              currency: "usd",
              billing_type: body.billing_type,
              interval: body.billing_interval ?? null,
              interval_count: body.billing_interval_count ?? 1,
              published_at: null,
              archived_at: null,
            });
          }
          return { data: { ...(mockServer.rows.get(id) as Row) } };
        }
        const m = /^\/v1\/coach\/packages\/([^/]+)\/publish$/.exec(url);
        if (m) {
          if (mockServer.publishHold) await mockServer.publishHold;
          if (mockServer.publishFailOnce) {
            mockServer.publishFailOnce = false;
            throw Object.assign(new Error("Network Error"), {
              code: "ERR_NETWORK",
              request: {},
            });
          }
          const row = mockServer.rows.get(decodeURIComponent(m[1]));
          if (!row) throw mockHttp(404, { code: "PACKAGE_NOT_FOUND" });
          if (row.archived_at)
            throw mockHttp(400, { code: "PACKAGE_ARCHIVED" });
          row.published_at = "2026-10-04T00:00:00.000Z";
          return { data: { ...row } };
        }
        throw mockHttp(404, { code: "UNEXPECTED_ROUTE" });
      },
    ),
    put: jest.fn(async () => {
      mockServer.binds++;
      return { data: {} };
    }),
    patch: jest.fn(async (url: string, body: Row) => {
      mockServer.patches.push({ ...body });
      const id = decodeURIComponent(url.split("/").pop() as string);
      const row = mockServer.rows.get(id);
      if (!row) throw mockHttp(404, { code: "PACKAGE_NOT_FOUND" });
      if (body.name !== undefined) row.name = body.name;
      if (body.amount_cents !== undefined) row.amount_cents = body.amount_cents;
      if (body.billing_type !== undefined) row.billing_type = body.billing_type;
      if ("billing_interval" in body) row.interval = body.billing_interval;
      if ("billing_interval_count" in body)
        row.interval_count = body.billing_interval_count ?? 1;
      return { data: { ...row } };
    }),
  },
}));

const mockStore = new Map<string, string>();
const mockHold = {
  writes: false,
  deletes: false,
  pending: [] as Array<() => void>,
};
jest.mock("../../../../storage/mmkv", () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => mockStore.get(k),
    set: (k: string, v: string) => {
      if (!mockHold.writes) {
        mockStore.set(k, v);
        return Promise.resolve();
      }
      return new Promise<void>((resolve) =>
        mockHold.pending.push(() => {
          mockStore.set(k, v);
          resolve();
        }),
      );
    },
    delete: (k: string) => {
      if (!mockHold.deletes) {
        mockStore.delete(k);
        return Promise.resolve();
      }
      return new Promise<void>((resolve) =>
        mockHold.pending.push(() => {
          mockStore.delete(k);
          resolve();
        }),
      );
    },
  },
}));

let mockUser: { id: string } | null = { id: "coach_1" };
jest.mock("../../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUser,
}));

const mockOpenAuth = jest.fn();
const mockDismiss = jest.fn();
jest.mock("expo-web-browser", () => ({
  __esModule: true,
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuth(...a),
  dismissAuthSession: () => mockDismiss(),
}));

import FirstPackageForm from "../FirstPackageForm";
import GetPaidPanel from "../GetPaidPanel";
import { buildChecklist } from "../CoachSetupChecklist";
import CoachSetupScreen from "../../../../screens/coach/setup/CoachSetupScreen";
import { coachSetupApi } from "../../../../api/coachSetupApi";
import api from "../../../../services/api";
import { authEvents } from "../../../../utils/authEvents";
import {
  intentStorageKey,
  newIntent,
} from "../../../../lib/coachSetup/packageCreateIntent";

jest.mock("../InviteShareCard", () => () => null);

const KEY = intentStorageKey("coach_1");
const flush = () => new Promise((r) => setTimeout(r, 30));
const deferred = <T,>() => {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const spies: Array<{ mockRestore: () => void }> = [];
function spyApi<K extends keyof typeof coachSetupApi>(name: K) {
  const sp = jest.spyOn(coachSetupApi, name);
  spies.push(sp);
  return sp;
}
const realGet = jest.mocked(api.get).getMockImplementation();
const realPost = jest.mocked(api.post).getMockImplementation();
afterEach(() => {
  spies.splice(0).forEach((sp) => sp.mockRestore());
  if (realGet) jest.mocked(api.get).mockImplementation(realGet);
  if (realPost) jest.mocked(api.post).mockImplementation(realPost);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockServer.rows.clear();
  mockServer.keys.clear();
  mockServer.creates = 0;
  mockServer.patches = [];
  mockServer.publishFailOnce = false;
  mockServer.publishHold = null;
  mockServer.binds = 0;
  mockServer.inviteReads = 0;
  mockStore.clear();
  mockHold.writes = false;
  mockHold.deletes = false;
  mockHold.pending = [];
  mockUser = { id: "coach_1" };
});

const form = (onCreated: jest.Mock = jest.fn()) => (
  <FirstPackageForm
    defaultTitle="North coaching"
    chargesEnabled
    onCreated={onCreated}
  />
);

describe("B-345-1 at the form: the cadence the coach picks is the cadence that goes live", () => {
  it("monthly made, publish lost, One time picked: the live row is one-time", async () => {
    mockServer.publishFailOnce = true;
    const onCreated = jest.fn();
    const s = await render(form(onCreated));
    await fireEvent.press(s.getByTestId("first-package-create"));
    await s.findByTestId("first-package-error");
    await fireEvent.press(s.getByTestId("first-package-once"));
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0][0].billingInterval).toBe("one_time");
    expect(mockServer.patches[0]).toMatchObject({
      billing_type: "one_time",
      billing_interval: null,
    });
    expect(mockServer.rows.get("pkg_1")).toMatchObject({
      billing_type: "one_time",
      interval: null,
    });
    expect(mockServer.creates).toBe(1);
  });
});

describe("B-329-5: nothing is sent or written after the form closed or the account changed", () => {
  it("closed while the write-ahead saves: no create, and the written intent stays (B-345-1)", async () => {
    mockHold.writes = true;
    const s = await render(form());
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(mockHold.pending.length).toBe(1));
    await s.unmount();
    mockHold.writes = false;
    mockHold.pending.splice(0).forEach((go) => go());
    await flush();
    expect(mockServer.creates).toBe(0);
    // B-345-1 (agent 119): another form may have read and sent it.
    expect(mockStore.has(KEY)).toBe(true);
  });

  it("account changed while the write-ahead saves: no create, and the form starts clean", async () => {
    mockHold.writes = true;
    const s = await render(form());
    await fireEvent.changeText(
      s.getByTestId("first-package-title"),
      "Coach one plan",
    );
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(mockHold.pending.length).toBe(1));
    mockUser = { id: "coach_2" };
    await s.rerender(form());
    mockHold.writes = false;
    mockHold.pending.splice(0).forEach((go) => go());
    await flush();
    expect(mockServer.creates).toBe(0);
    expect(s.getByTestId("first-package-title").props.value).toBe(
      "North coaching",
    );
    expect(s.queryByTestId("first-package-error")).toBeNull();
  });

  it("account changed while publish runs: no invite read, no binding, no callback", async () => {
    const gate = deferred<void>();
    mockServer.publishHold = gate.promise;
    const onCreated = jest.fn();
    const s = await render(form(onCreated));
    await fireEvent.press(s.getByTestId("first-package-free"));
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(mockServer.creates).toBe(1));
    mockUser = { id: "coach_2" };
    await s.rerender(form(onCreated));
    gate.resolve();
    await flush();
    expect(mockServer.inviteReads).toBe(0);
    expect(mockServer.binds).toBe(0);
    expect(onCreated).not.toHaveBeenCalled();
    // Coach one's made package stays remembered for coach one.
    expect(JSON.parse(mockStore.get(KEY) as string).packageId).toBe("pkg_1");
  });

  it("closed while the finished intent is being removed: no callback", async () => {
    const onCreated = jest.fn();
    const s = await render(form(onCreated));
    mockHold.deletes = true;
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(mockHold.pending.length).toBe(1));
    await s.unmount();
    mockHold.deletes = false;
    mockHold.pending.splice(0).forEach((go) => go());
    await flush();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("C-346-2: a remembered package archived since does not trap the form", () => {
  it("publish says PACKAGE_ARCHIVED: one fresh package is made and goes live in the same tap", async () => {
    const made = {
      ...newIntent({
        title: "North coaching",
        description: null,
        priceCents: 4900,
        currency: "usd",
        billingInterval: "monthly",
        intervalCount: 1,
        trialDays: 0,
        features: [],
      }),
      packageId: "pkg_old",
    };
    mockStore.set(KEY, JSON.stringify(made));
    mockServer.rows.set("pkg_old", {
      id: "pkg_old",
      billing_type: "recurring",
      interval: "month",
      amount_cents: 4900,
      archived_at: "2026-10-03T00:00:00.000Z",
    });
    const onCreated = jest.fn();
    const s = await render(form(onCreated));
    await s.findByTestId("first-package-resumed");
    await fireEvent.press(s.getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockServer.creates).toBe(1);
    expect(onCreated.mock.calls[0][0].id).toBe("pkg_1");
    expect(mockServer.rows.get("pkg_1")?.published_at).toBeTruthy();
  });
});

// Today's production status payload (legacy shape, no state/requirements).
const ACCOUNT = {
  configured: true,
  account_id: "acct_1",
  charges_enabled: false,
  payouts_enabled: false,
  requirements_due: ["external_account"],
};
const LINK = { url: "https://connect.stripe.com/setup/e/acct_1/abc" };
const view = (over: Row = {}) => ({
  state: "not_started",
  accountId: null,
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: false,
  actionRequired: true,
  currentlyDue: [],
  pastDue: [],
  eventuallyDue: [],
  pendingVerification: [],
  deadline: null,
  disabledReason: null,
  refreshed: false,
  ...over,
});

describe("B-346-2: Get paid belongs to its mount and session", () => {
  it("closed while the Stripe link is minted: Stripe never opens", async () => {
    spyApi("connectStatus").mockResolvedValue(view() as never);
    const mint = deferred<typeof LINK>();
    spyApi("createOnboardingLink").mockReturnValue(mint.promise as never);
    const s = await render(<GetPaidPanel />);
    await s.findByTestId("get-paid-open");
    const pressed = fireEvent.press(s.getByTestId("get-paid-open"));
    await waitFor(() =>
      expect(coachSetupApi.createOnboardingLink).toHaveBeenCalled(),
    );
    await s.unmount();
    mint.resolve(LINK);
    await pressed;
    await flush();
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });

  it("closed while Stripe is open: the sheet is dismissed, no re-read, no onChange", async () => {
    spyApi("connectStatus").mockResolvedValue(view() as never);
    spyApi("createOnboardingLink").mockResolvedValue(LINK as never);
    const refresh = spyApi("refreshConnectStatus");
    const sheet = deferred<{ type: string }>();
    mockOpenAuth.mockReturnValue(sheet.promise);
    const onChange = jest.fn();
    const s = await render(<GetPaidPanel onChange={onChange} />);
    await s.findByTestId("get-paid-open");
    onChange.mockClear();
    const pressed = fireEvent.press(s.getByTestId("get-paid-open"));
    await waitFor(() => expect(mockOpenAuth).toHaveBeenCalledTimes(1));
    await s.unmount();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    sheet.resolve({ type: "dismiss" });
    await pressed;
    await flush();
    expect(refresh).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sign-out while the status re-read runs: the answer is dropped", async () => {
    spyApi("connectStatus").mockResolvedValue(view() as never);
    spyApi("createOnboardingLink").mockResolvedValue(LINK as never);
    mockOpenAuth.mockResolvedValue({ type: "cancel" });
    const reread = deferred<unknown>();
    spyApi("refreshConnectStatus").mockReturnValue(reread.promise as never);
    const onChange = jest.fn();
    const s = await render(<GetPaidPanel onChange={onChange} />);
    await s.findByTestId("get-paid-open");
    onChange.mockClear();
    const pressed = fireEvent.press(s.getByTestId("get-paid-open"));
    await waitFor(() =>
      expect(coachSetupApi.refreshConnectStatus).toHaveBeenCalled(),
    );
    authEvents.emit("logout");
    reread.resolve(
      view({ state: "active", chargesEnabled: true, payoutsEnabled: true }),
    );
    await pressed;
    await flush();
    expect(onChange).not.toHaveBeenCalled();
    expect(s.queryByText("You are ready to get paid")).toBeNull();
  });

  it("Retry repeats the action that failed (a failed re-check is re-checked, Stripe is not reopened)", async () => {
    spyApi("connectStatus").mockResolvedValue(
      view({
        state: "pending_verification",
        accountId: "acct_1",
        actionRequired: false,
      }) as never,
    );
    const mint = spyApi("createOnboardingLink");
    const refresh = spyApi("refreshConnectStatus")
      .mockRejectedValueOnce(mockHttp(503, {}) as never)
      .mockResolvedValueOnce(
        view({
          state: "pending_verification",
          accountId: "acct_1",
          refreshed: true,
        }) as never,
      );
    const s = await render(<GetPaidPanel />);
    await fireEvent.press(await s.findByTestId("get-paid-check"));
    await fireEvent.press(await s.findByTestId("get-paid-error-retry"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(mint).not.toHaveBeenCalled();
  });

  it("today's server has no live re-read: the note says it is Stripe's last update, not a failed call", async () => {
    jest.mocked(api.get).mockImplementation((async (url: string) => {
      if (url === "/coach/connect/status") return { data: ACCOUNT };
      throw mockHttp(404, {});
    }) as never);
    jest.mocked(api.post).mockImplementation((async (url: string) => {
      if (url === "/coach/connect/onboarding-link") return { data: LINK };
      throw mockHttp(404, { code: "NOT_FOUND" });
    }) as never);
    mockOpenAuth.mockResolvedValue({ type: "cancel" });
    const s = await render(<GetPaidPanel />);
    await fireEvent.press(await s.findByTestId("get-paid-open"));
    const note = await s.findByTestId("get-paid-stale");
    expect(note.props.children).toMatch(
      /^This shows the last update Stripe sent to TGP\./,
    );
    expect(note.props.children).not.toMatch(/did not answer/);
  });
});

describe("B-346-1: app copy has no first person and no exclamation marks", () => {
  const FIRST_PERSON = /\b(we|We|us|our|Our)\b|!/;

  it("every checklist line in every state", () => {
    const states = [null, true, false] as const;
    for (const connectActive of states)
      for (const hasPackage of states)
        for (const hasClient of states)
          for (const paid of states)
            for (const flag of [true, false])
              for (const item of buildChecklist({
                connectActive,
                connectNeedsAttention: flag,
                hasPackage,
                hasClient,
                sharedLink: flag,
                paid,
              }))
                expect(`${item.label} ${item.detail}`).not.toMatch(
                  FIRST_PERSON,
                );
  });

  it("the setup screen", async () => {
    spyApi("connectStatus").mockResolvedValue(view() as never);
    const nav = { goBack: jest.fn() };
    for (const section of ["get_paid", "invite"] as const) {
      const s = await render(
        <CoachSetupScreen
          route={{ key: "k", name: "CoachSetup", params: { section } } as never}
          navigation={nav as never}
        />,
      );
      await flush();
      const text = JSON.stringify(s.toJSON());
      expect(text).not.toMatch(FIRST_PERSON);
      await s.unmount();
    }
  });
});
