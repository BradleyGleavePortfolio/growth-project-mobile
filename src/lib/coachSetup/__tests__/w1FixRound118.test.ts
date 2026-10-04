/**
 * B-WIZ-118 (agent 118) — fix round for mobile #345 (coach setup W1). Each
 * case below failed at a4e49588 (+ main merge 48c34822):
 *   B-345-1 (Opus) / B-345-2 (Sol)  a cadence picked after the package was
 *            made never reached the server, and the helper remembered it
 *   B-329-5 (Sol B-345-1)  the helper sent a create, called back or wrote
 *            storage after the account, session or form that started it ended
 *   B-345-3 (Sol)  unknown failures reported the raw exception and had no
 *            reference when the server gave none
 *   production capability (job B-WIZ-118): today's server has no live Stripe
 *            re-read and an older status payload; the app says so truthfully
 */
jest.mock("../../../services/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
  },
}));
jest.mock("../../../services/sentry", () => ({ captureError: jest.fn() }));

const mockStore = new Map<string, string>();
const mockHold: { set: null | Promise<void> } = { set: null };
jest.mock("../../../storage/mmkv", () => ({
  prefsStorage: {
    getStringAsync: async (k: string) => mockStore.get(k),
    set: async (k: string, v: string) => {
      if (mockHold.set) await mockHold.set;
      mockStore.set(k, v);
    },
    delete: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

import api from "../../../services/api";
import { captureError } from "../../../services/sentry";
import {
  coachPackagesApi,
  PACKAGE_UPDATE_NOT_APPLIED,
  type PackageCreateInput,
} from "../../../api/packagesApi";
import { coachSetupApi, toConnectView } from "../../../api/coachSetupApi";
import { connectCopy } from "../connectCopy";
import { describeError, CoachSetupFailure } from "../errors";
import {
  createPackageOnce,
  intentStorageKey,
  newIntent,
  PackageCreateStoppedError,
  type PackageCreateIntent,
} from "../packageCreateIntent";

const KEY = intentStorageKey("coach_1");
const monthly: PackageCreateInput = {
  title: "North coaching",
  description: null,
  priceCents: 4900,
  currency: "usd",
  billingInterval: "monthly",
  intervalCount: 1,
  trialDays: 0,
  features: [],
};
const oneTime: PackageCreateInput = { ...monthly, billingInterval: "one_time" };
const free: PackageCreateInput = { ...oneTime, priceCents: 0 };

type Row = Record<string, unknown>;
const stored: Row = {};
/** Backend PackagesService.update over a raw CoachPackage row (`interval`). */
function applyPatch(body: Row): Row {
  const next: Row = { ...stored };
  if (body.name !== undefined) next.name = body.name;
  if (body.amount_cents !== undefined) next.amount_cents = body.amount_cents;
  if (body.billing_type !== undefined) next.billing_type = body.billing_type;
  if ("billing_interval" in body) next.interval = body.billing_interval;
  if ("billing_interval_count" in body)
    next.interval_count = body.billing_interval_count ?? 1;
  if (next.billing_type === "one_time" && !("billing_interval" in body))
    next.interval = null;
  if (next.amount_cents === 0 && next.billing_type !== "one_time") {
    throw Object.assign(new Error("HTTP 400"), {
      response: {
        status: 400,
        data: { code: "PACKAGE_FREE_MUST_BE_ONE_TIME" },
      },
    });
  }
  Object.assign(stored, next);
  return { ...next };
}

const patch = () => jest.mocked(api.patch);
const post = () => jest.mocked(api.post);
const deps = {
  create: (b: PackageCreateInput, k: string) => coachPackagesApi.create(b, k),
  update: (id: string, b: PackageCreateInput) => coachPackagesApi.update(id, b),
};
const made = (input: PackageCreateInput): PackageCreateIntent => ({
  ...newIntent(input),
  packageId: "pkg_1",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockHold.set = null;
  for (const k of Object.keys(stored)) delete stored[k];
  Object.assign(stored, {
    id: "pkg_1",
    name: "North coaching",
    amount_cents: 4900,
    currency: "usd",
    billing_type: "recurring",
    interval: "month",
    interval_count: 1,
    is_active: true,
    published_at: null,
  });
  patch().mockImplementation((async (_url: string, body: Row) => ({
    data: applyPatch(body),
  })) as never);
  post().mockImplementation((async () => ({ data: { ...stored } })) as never);
});

describe("B-345-1 / B-345-2: the PATCH carries the billing the coach picked", () => {
  it("monthly made, one-time picked: billing_type one_time and the cadence cleared", async () => {
    const onIntent = jest.fn();
    const out = await createPackageOnce({
      coachId: "coach_1",
      scope: "wizard",
      input: oneTime,
      earlier: made(monthly),
      deps,
      onIntent,
    });
    expect(patch().mock.calls[0][1]).toEqual(
      expect.objectContaining({
        billing_type: "one_time",
        billing_interval: null,
        billing_interval_count: null,
      }),
    );
    expect(stored).toMatchObject({ billing_type: "one_time", interval: null });
    expect(out.intent.input.billingInterval).toBe("one_time");
  });

  it("one-time made, monthly picked: recurring, month, count 1", async () => {
    stored.billing_type = "one_time";
    stored.interval = null;
    await createPackageOnce({
      coachId: "coach_1",
      scope: "wizard",
      input: monthly,
      earlier: made(oneTime),
      deps,
      onIntent: jest.fn(),
    });
    expect(patch().mock.calls[0][1]).toMatchObject({
      billing_type: "recurring",
      billing_interval: "month",
      billing_interval_count: 1,
    });
    expect(stored).toMatchObject({
      billing_type: "recurring",
      interval: "month",
    });
  });

  it("monthly made, free picked: one PATCH makes it one-time $0 (no PACKAGE_FREE_MUST_BE_ONE_TIME)", async () => {
    await expect(
      createPackageOnce({
        coachId: "coach_1",
        scope: "wizard",
        input: free,
        earlier: made(monthly),
        deps,
        onIntent: jest.fn(),
      }),
    ).resolves.toMatchObject({ packageId: "pkg_1" });
    expect(patch().mock.calls[0][1]).toMatchObject({
      amount_cents: 0,
      billing_type: "one_time",
      billing_interval: null,
    });
  });

  it("the server row keeps the old billing: the update fails closed and the new cadence is not remembered", async () => {
    patch().mockImplementation((async () => ({
      data: { ...stored },
    })) as never);
    const earlier = made(monthly);
    mockStore.set(KEY, JSON.stringify(earlier));
    const onIntent = jest.fn();
    const err = await createPackageOnce({
      coachId: "coach_1",
      scope: "wizard",
      input: oneTime,
      earlier,
      deps,
      onIntent,
    }).catch((e: unknown) => e);
    expect(
      (err as { response?: { data?: { code?: string } } }).response?.data?.code,
    ).toBe(PACKAGE_UPDATE_NOT_APPLIED);
    expect(onIntent).not.toHaveBeenCalled();
    expect(JSON.parse(mockStore.get(KEY) as string).input.billingInterval).toBe(
      "monthly",
    );
    expect(describeError(err, "create your package").title).toBe(
      "The new price or billing did not save",
    );
  });

  it("recurring cadence must match too: yearly sent, monthly kept, fails closed", async () => {
    patch().mockImplementation((async () => ({
      data: { ...stored },
    })) as never);
    const err = await coachPackagesApi
      .update("pkg_1", { ...monthly, billingInterval: "yearly" })
      .catch((e: unknown) => e);
    expect(
      (err as { response?: { data?: { field?: string } } }).response?.data
        ?.field,
    ).toBe("billing_interval");
  });

  it("one-time: a leftover cadence on the row is not a mismatch (billing_type decides)", async () => {
    patch().mockImplementation((async (_u: string, body: Row) => ({
      data: { ...stored, ...body, billing_type: "one_time", interval: "month" },
    })) as never);
    await expect(
      coachPackagesApi.update("pkg_1", { ...free }),
    ).resolves.toMatchObject({ data: { billingInterval: "one_time" } });
  });

  it("control: a name-only edit sends no billing fields and is not checked", async () => {
    patch().mockResolvedValueOnce({ data: {} } as never);
    await coachPackagesApi.update("pkg_1", { title: "Renamed" });
    const body = patch().mock.calls[0][1] as Row;
    expect(body).toEqual({ name: "Renamed" });
  });

  it("a raw row's `interval` is read back (year is yearly, not monthly)", async () => {
    post().mockResolvedValueOnce({
      data: { ...stored, interval: "year", interval_count: 1 },
    } as never);
    const res = await coachPackagesApi.create(
      { ...monthly, billingInterval: "yearly" },
      "key_12345678",
    );
    expect(res.data.billingInterval).toBe("yearly");
  });
});

describe("B-329-5: nothing runs after the owner, session or form ended", () => {
  it("retired while the write-ahead is saving: no create, no callback, the written intent stays (B-345-1)", async () => {
    let release: () => void = () => undefined;
    mockHold.set = new Promise<void>((r) => (release = r));
    let live = true;
    const onIntent = jest.fn();
    const run = createPackageOnce({
      coachId: "coach_1",
      scope: "wizard",
      input: monthly,
      earlier: null,
      deps,
      onIntent,
      isLive: () => live,
    });
    await Promise.resolve();
    live = false;
    mockHold.set = null;
    release();
    await expect(run).rejects.toBeInstanceOf(PackageCreateStoppedError);
    expect(post()).not.toHaveBeenCalled();
    expect(onIntent).not.toHaveBeenCalled();
    // B-345-1 (agent 119): another form may have read and sent it.
    expect(mockStore.has(KEY)).toBe(true);
  });

  it("a re-sent create answers after sign-out: no callback, the sent intent stays for the same account", async () => {
    const earlier = newIntent(monthly);
    mockStore.set(KEY, JSON.stringify(earlier));
    let live = true;
    let answer: (v: unknown) => void = () => undefined;
    post().mockImplementationOnce(
      (() => new Promise((r) => (answer = r))) as never,
    );
    const onIntent = jest.fn();
    const run = createPackageOnce({
      coachId: "coach_1",
      scope: "wizard",
      input: monthly,
      earlier,
      deps,
      onIntent,
      isLive: () => live,
    });
    await Promise.resolve();
    live = false;
    answer({ data: { ...stored } });
    await expect(run).rejects.toBeInstanceOf(PackageCreateStoppedError);
    expect(onIntent).not.toHaveBeenCalled();
    expect(JSON.parse(mockStore.get(KEY) as string)).toEqual(earlier);
  });

  it("an update answers after the form closed: nothing is remembered or called back", async () => {
    let live = true;
    let answer: (v: unknown) => void = () => undefined;
    patch().mockImplementationOnce(
      (() => new Promise((r) => (answer = r))) as never,
    );
    const earlier = made(monthly);
    mockStore.set(KEY, JSON.stringify(earlier));
    const onIntent = jest.fn();
    const run = createPackageOnce({
      coachId: "coach_1",
      scope: "wizard",
      input: { ...monthly, title: "Renamed" },
      earlier,
      deps,
      onIntent,
      isLive: () => live,
    });
    await Promise.resolve();
    live = false;
    answer({ data: { ...stored, name: "Renamed" } });
    await expect(run).rejects.toBeInstanceOf(PackageCreateStoppedError);
    expect(onIntent).not.toHaveBeenCalled();
    expect(JSON.parse(mockStore.get(KEY) as string).input.title).toBe(
      "North coaching",
    );
  });

  it("already retired before the first step: nothing is read, written or sent", async () => {
    await expect(
      createPackageOnce({
        coachId: "coach_1",
        scope: "wizard",
        input: monthly,
        earlier: null,
        deps,
        onIntent: jest.fn(),
        isLive: () => false,
      }),
    ).rejects.toBeInstanceOf(PackageCreateStoppedError);
    expect(post()).not.toHaveBeenCalled();
    expect(mockStore.size).toBe(0);
  });

  it("control: a live create sends once and remembers the package", async () => {
    const onIntent = jest.fn();
    const out = await createPackageOnce({
      coachId: "coach_1",
      scope: "wizard",
      input: monthly,
      earlier: null,
      deps,
      onIntent,
      isLive: () => true,
    });
    expect(out.packageId).toBe("pkg_1");
    expect(post()).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockStore.get(KEY) as string).packageId).toBe("pkg_1");
  });
});

describe("B-345-3: unknown failures report no content and always carry a reference", () => {
  const marker = "synthetic-person@example.invalid";

  it("a local failure: fixed error to Sentry, the same reference tagged and shown", () => {
    const e = describeError(
      new Error(`clipboard refused ${marker}`),
      "copy the link",
    );
    expect(captureError).toHaveBeenCalledTimes(1);
    const [sent, ctx] = jest.mocked(captureError).mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(sent).toBeInstanceOf(CoachSetupFailure);
    expect(JSON.stringify([sent.message, sent.name, ctx])).not.toContain(
      marker,
    );
    expect(typeof ctx.reference).toBe("string");
    expect(e.requestId).toBe(String(ctx.reference).slice(0, 8));
    expect(e.body).toContain(`mention reference ${e.requestId}`);
  });

  it("a server failure: the server id is the reference; body text and odd codes never reach Sentry", () => {
    const err = Object.assign(new Error(`HTTP 500 ${marker}`), {
      response: {
        status: 500,
        data: {
          error: `Internal ${marker}`,
          message: marker,
          request_id: "req_123",
        },
        headers: {},
      },
      config: { data: JSON.stringify({ email: marker }) },
    });
    const e = describeError(err, "load your payout setup");
    const [sent, ctx] = jest.mocked(captureError).mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(JSON.stringify([sent.message, ctx])).not.toContain(marker);
    expect(ctx).toMatchObject({
      status: 500,
      code: null,
      reference: "req_123",
    });
    expect(e.requestId).toBe("req_123");
    expect(e.body).toContain("req_123");
  });

  it("no server id: the X-Request-Id this app sent is the reference", () => {
    const sentId = "3f2a9c1e-0000-4000-8000-000000000001";
    const e = describeError(
      Object.assign(new Error("HTTP 418"), {
        response: { status: 418, data: { code: "TEAPOT_STATE" }, headers: {} },
        config: { headers: { "X-Request-Id": sentId } },
      }),
      "save this step",
    );
    const ctx = jest.mocked(captureError).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(ctx).toMatchObject({
      reference: sentId,
      code: "TEAPOT_STATE",
      status: 418,
    });
    expect(e.requestId).toBe("3f2a9c1e");
  });
});

describe("production today (backend 643817b3): truthful fallbacks", () => {
  it("older status payload, Stripe fully on: ready, no false 'update needed'", () => {
    const v = toConnectView({
      configured: true,
      account_id: "acct_1",
      charges_enabled: true,
      payouts_enabled: true,
      requirements_due: ["individual.verification.document"],
    });
    expect(v).toMatchObject({
      state: "active",
      legacy: true,
      currentlyDue: [],
    });
    const c = connectCopy(v);
    expect(c.title).toBe("You are ready to get paid");
    expect(c.action).toBeNull();
  });

  it("older status payload, not switched on yet: still asks for the details", () => {
    const c = connectCopy(
      toConnectView({
        account_id: "acct_1",
        requirements_due: ["external_account"],
      }),
    );
    expect(c.action).toBe("Continue with Stripe");
    expect(c.due).toEqual(["Bank account for payouts"]);
  });

  it("no live re-read route (404): the saved status comes back marked as such", async () => {
    post().mockRejectedValueOnce(
      Object.assign(new Error("HTTP 404"), {
        response: { status: 404, data: {} },
      }) as never,
    );
    jest.mocked(api.get).mockResolvedValueOnce({
      data: {
        account_id: "acct_1",
        charges_enabled: false,
        payouts_enabled: false,
      },
    } as never);
    const v = await coachSetupApi.refreshConnectStatus();
    expect(v).toMatchObject({ refreshed: false, refreshUnavailable: true });
  });
});
