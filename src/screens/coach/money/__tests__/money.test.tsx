/**
 * S-COACH-MOB-2 — TGP Money: typed client, copy, Home card, Money page,
 * charges list, charge breakdown, redirects. Every state: loading, empty
 * (no Stripe -> setup action), error with reference, offline.
 */
import React from "react";
import { act, render, fireEvent, waitFor } from "@testing-library/react-native";
import { Share } from "react-native";

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
  },
}));

jest.mock("../../../../services/sentry", () => ({ captureError: jest.fn() }));

const mockOpenBrowser = jest.fn();
jest.mock("expo-web-browser", () => ({
  __esModule: true,
  openBrowserAsync: (...a: unknown[]) => mockOpenBrowser(...a),
}));

let mockOnline = true;
jest.mock("../../../../hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({
    isOnline: mockOnline,
    isInternetReachable: mockOnline,
  }),
}));

const mockFocus: { current: (() => void) | null } = { current: null };
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockParentNavigate = jest.fn();
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      replace: mockReplace,
      goBack: jest.fn(),
      canGoBack: () => true,
      getParent: () => ({ navigate: mockParentNavigate }),
    }),
    useFocusEffect: (cb: () => void) => {
      const R = jest.requireActual("react");
      R.useEffect(() => {
        mockFocus.current = cb;
        cb();
      }, [cb]);
    },
  };
});

import {
  MoneyPayloadError,
  nextPayout,
  toAttentionItem,
  toCharge,
  toPayout,
  toSummary,
  windowsFor,
  type AttentionItem,
} from "../../../../api/coachMoneyApi";
import {
  attentionCopy,
  breakdownRows,
  cadenceLabel,
  changeLine,
  chargeStateLabel,
  FILTER_LABEL,
  PAYOUT_LABEL,
} from "../../../../lib/money/moneyCopy";
import {
  describeError,
  isSubCoachBillingBlocked,
} from "../../../../lib/coachSetup/errors";
import MoneyScreen from "../MoneyScreen";
import MoneyChargesScreen from "../MoneyChargesScreen";
import MoneyChargeScreen from "../MoneyChargeScreen";
import MoneyRedirect from "../MoneyRedirect";
import MoneyHomeCard from "../../../../components/coach/money/MoneyHomeCard";

function httpError(status: number, data?: Record<string, unknown>) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: data ?? {}, headers: {} },
  });
}

const totals = (over: Record<string, unknown> = {}) => ({
  gross_cents: 10000,
  processing_cents: 320,
  platform_fee_cents: 200,
  head_coach_split_cents: 0,
  refunded_cents: 0,
  head_coach_income_cents: 0,
  net_cents: 9480,
  charge_count: 2,
  processing_paid_by: "coach",
  ...over,
});

const SUMMARY = {
  currency: "usd",
  window: { from: "2026-09-02T00:00:00Z", to: "2026-10-02T00:00:00Z" },
  totals: totals(),
  compare_totals: totals({ net_cents: 4740 }),
  change_cents: 4740,
  change_pct: 100,
  recurring: {
    mrr_cents: 9800,
    paying_clients: 2,
    churned_30d: 1,
    new_clients_30d: 2,
  },
  attention_count: 2,
  generated_at: "2026-10-02T19:00:00Z",
};

const ATTENTION = {
  count: 2,
  items: [
    {
      kind: "failed_payment",
      id: "p1",
      client: { id: "u_sam", name: "Sam" },
      amount_cents: 4900,
      currency: "usd",
      created_at: "2026-10-01T00:00:00Z",
      failed_payment: {
        purchase_id: "p1",
        package_name: "North coaching",
        attempt: 2,
        max_attempts: 4,
        next_retry_at: "2026-10-04T00:00:00Z",
        locked_out_at: null,
        card_update_link_sent_at: null,
        last_failure_reason: "card_declined",
      },
    },
    {
      kind: "stripe_requirements",
      id: "acct",
      client: null,
      amount_cents: null,
      currency: null,
      created_at: null,
      stripe_requirements: {
        currently_due: ["external_account"],
        past_due: [],
        current_deadline: "2026-10-20T00:00:00Z",
        disabled_reason: null,
      },
    },
  ],
};

const CHARGES = {
  charges: [
    {
      id: "ch_1",
      client: { id: "u_sam", name: "Sam" },
      package: { id: "pk", name: "North coaching" },
      amount_cents: 4900,
      currency: "usd",
      billing_type: "recurring",
      state: "paid",
      refunded_cents: 0,
      created_at: "2026-10-01T00:00:00Z",
    },
  ],
  next_cursor: null,
};

const ACTIVE = {
  account_id: "acct_1",
  state: "active",
  charges_enabled: true,
  payouts_enabled: true,
};

function routeGets(over: Record<string, unknown | Error> = {}) {
  const map: Record<string, unknown> = {
    "/v1/coach/money/summary": SUMMARY,
    "/v1/coach/money/attention": ATTENTION,
    "/v1/coach/money/charges": CHARGES,
    "/coach/connect/payouts": [
      {
        id: "po_1",
        amount: 94.8,
        currency: "usd",
        status: "in_transit",
        arrival_date: "2026-10-05T00:00:00Z",
        created_at: "2026-10-02T00:00:00Z",
        description: null,
      },
    ],
    "/coach/connect/metrics": {
      active_clients: 7,
      clients_added_30d: 3,
      sub_coach_acquisition_30d: 0,
      sub_coach_churn_30d: 0,
    },
    "/coach/connect/status": ACTIVE,
    ...over,
  };
  mockGet.mockImplementation(
    async (url: string, cfg?: { params?: Record<string, string> }) => {
      const v = map[url];
      if (v instanceof Error) throw v;
      if (v === undefined) throw httpError(404);
      if (typeof v === "function") return { data: await v(cfg) };
      return { data: url === SUMMARY_URL ? echoWindow(v, cfg) : v };
    },
  );
}

const SUMMARY_URL = "/v1/coach/money/summary";
/** The backend echoes the window it was asked for (coach-money.service). */
function echoWindow(
  v: unknown,
  cfg?: { params?: Record<string, string> },
): unknown {
  const p = cfg?.params;
  if (!p || !v || typeof v !== "object") return v;
  return { ...(v as object), window: { from: p.from, to: p.to } };
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockNavigate.mockReset();
  mockReplace.mockReset();
  mockParentNavigate.mockReset();
  mockOpenBrowser.mockReset();
  mockOnline = true;
});

describe("coachMoneyApi parsing", () => {
  it("computes Today / 30d / YTD windows with the previous period", () => {
    const now = new Date(2026, 9, 2, 15, 0, 0);
    const t = windowsFor("today", now);
    expect(t.from).toEqual(new Date(2026, 9, 2));
    expect(t.compareFrom).toEqual(new Date(2026, 9, 1));
    expect(t.compareTo.getTime() - t.compareFrom.getTime()).toBe(
      t.to.getTime() - t.from.getTime(),
    );
    const m = windowsFor("30d", now);
    expect(m.compareTo).toEqual(m.from);
    expect(m.from.getTime() - m.compareFrom.getTime()).toBe(30 * 86_400_000);
    const y = windowsFor("ytd", now);
    expect(y.from).toEqual(new Date(2026, 0, 1));
    expect(y.compareFrom).toEqual(new Date(2025, 0, 1));
    expect(y.compareTo).toEqual(new Date(2025, 9, 2, 15, 0, 0));
  });

  it("reads the summary and feature-detects the amount held from the next sale", () => {
    const s = toSummary(SUMMARY);
    expect(s.totals.netCents).toBe(9480);
    expect(s.recurring.mrrCents).toBe(9800);
    expect(s.heldFromNextSaleCents).toBeNull();
    expect(
      toSummary({ ...SUMMARY, held_from_next_sale_cents: 812 })
        .heldFromNextSaleCents,
    ).toBe(812);
    // Only the field #641 names is read (Opus #332 assumption: pin it).
    expect(
      toSummary({ ...SUMMARY, held_cents: 812 }).heldFromNextSaleCents,
    ).toBeNull();
    expect(() => toSummary({})).toThrow();
  });

  it("knows charged-back charges and never hides an unknown state", () => {
    const cb = toCharge({ ...CHARGES.charges[0], state: "charged_back" });
    expect(chargeStateLabel(cb)).toBe("Charged back");
    const odd = toCharge({ ...CHARGES.charges[0], state: "chargeback_lost" });
    expect(odd.state).toBeNull();
    expect(chargeStateLabel(odd)).toBe("Chargeback lost");
  });

  it("converts payouts to cents and picks the soonest open payout", () => {
    const list = [
      toPayout({
        id: "a",
        amount: 10,
        currency: "usd",
        status: "paid",
        arrival_date: "2026-09-01T00:00:00Z",
      }),
      toPayout({
        id: "b",
        amount: 20.5,
        currency: "usd",
        status: "pending",
        arrival_date: "2026-10-09T00:00:00Z",
      }),
      toPayout({
        id: "c",
        amount: 30,
        currency: "usd",
        status: "in_transit",
        arrival_date: "2026-10-05T00:00:00Z",
      }),
      toPayout({
        id: "d",
        amount: 1,
        currency: "usd",
        status: "pending",
        arrival_date: new Date(0).toISOString(),
      }),
    ];
    expect(list[1].amountCents).toBe(2050);
    expect(list[3].arrivalDate).toBeNull();
    expect(nextPayout(list)?.id).toBe("c");
  });
});

describe("Money copy", () => {
  it("states the change against the previous period in plain words", () => {
    expect(changeLine("30d", 4740, 100, "usd")).toMatch(
      /^Up \$47\.40 \(100\.0%\) on the 30 days before$/,
    );
    expect(changeLine("today", -500, null, "usd")).toMatch(
      /^Down \$5\.00 on yesterday$/,
    );
    expect(changeLine("ytd", 0, 0, "usd")).toBe(
      "Same as the same time last year",
    );
  });

  it("builds price - processing - TGP 2% = net and notes when TGP paid processing", () => {
    const rows = breakdownRows({
      priceCents: 4900,
      processingCents: 0,
      platformFeeCents: 98,
      headCoachSplitCents: 0,
      refundedCents: 0,
      netCents: 4802,
      processingPaidBy: "platform",
    });
    expect(rows.map((r) => r.label)).toEqual([
      "Clients paid",
      "Card processing (Stripe)",
      "TGP fee (2%)",
      "Net to you",
    ]);
    expect(rows[1].note).toMatch(/TGP paid/);
  });

  it("failed payments read the retry state and only claim a card link when one was sent", () => {
    const a: AttentionItem = {
      kind: "failed_payment",
      id: "p1",
      client: { id: "u", name: "Sam" },
      amountCents: 4900,
      currency: "usd",
      createdAt: null,
      failedPayment: {
        packageName: "North coaching",
        attempt: 2,
        maxAttempts: 4,
        nextRetryAt: "2026-10-04T12:00:00Z",
        lockedOutAt: null,
        cardUpdateLinkSentAt: null,
        lastFailureReason: null,
      },
      dispute: null,
      stripeRequirements: null,
    };
    const c = attentionCopy(a);
    expect(c.title).toBe("Sam's payment did not go through");
    expect(c.lines.join(" ")).toMatch(/Try 2 of 4\./);
    expect(c.lines.join(" ")).not.toMatch(/card update link/);
    const sent = attentionCopy({
      ...a,
      failedPayment: {
        ...a.failedPayment!,
        cardUpdateLinkSentAt: "2026-10-02T12:00:00Z",
      },
    });
    expect(sent.lines.join(" ")).toMatch(/card update link/);
    expect(c.actionLabel).toBe("Message Sam");
    for (const l of [...c.lines, c.title]) expect(l).not.toMatch(/!/);
  });
});

describe("MoneyScreen", () => {
  it("shows net, change, breakdown, attention with Message client, payouts, business and charges", async () => {
    routeGets();
    const { findByTestId, getByTestId, findByText, getByText } = await render(
      <MoneyScreen />,
    );
    expect((await findByTestId("money-net-amount")).props.children).toBe(
      "$94.80",
    );
    expect(getByTestId("money-net-change").props.children).toMatch(
      /^Up \$47\.40/,
    );
    await fireEvent.press(getByTestId("money-net-toggle"));
    await findByText("TGP fee (2%)");
    await findByText("Sam's payment did not go through");
    await fireEvent.press(getByTestId("money-attention-failed_payment-p1"));
    expect(mockParentNavigate).toHaveBeenCalledWith("ClientsStack", {
      screen: "ClientMessages",
      params: { clientId: "u_sam", clientName: "Sam" },
    });
    await fireEvent.press(
      getByTestId("money-attention-stripe_requirements-acct"),
    );
    expect(mockNavigate).toHaveBeenCalledWith("CoachSetup", {
      section: "get_paid",
    });
    await findByTestId("money-next-payout");
    getByText(
      "Expected in your bank on " +
        new Date("2026-10-05T00:00:00Z").toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
    );
    expect(getByTestId("money-kpi-mrr").props.accessibilityLabel).toBe(
      "Monthly recurring: $98.00",
    );
    expect(getByTestId("money-kpi-roster").props.accessibilityLabel).toBe(
      "Clients on your roster: 7",
    );
    await fireEvent.press(getByTestId("money-charge-ch_1"));
    expect(mockNavigate).toHaveBeenCalledWith("CoachMoneyCharge", {
      chargeId: "ch_1",
    });
    await fireEvent.press(getByTestId("money-charges-all"));
    expect(mockNavigate).toHaveBeenCalledWith("CoachMoneyCharges", {});
    await fireEvent.press(getByTestId("money-packages"));
    expect(mockNavigate).toHaveBeenCalledWith("CoachPackagesList");
  });

  it("Payout settings opens the Stripe Express dashboard from the live route", async () => {
    routeGets();
    mockPost.mockResolvedValueOnce({
      data: { url: "https://connect.stripe.com/express/acct_1/xyz" },
    });
    const { findByTestId } = await render(<MoneyScreen />);
    await fireEvent.press(await findByTestId("money-payout-settings"));
    await waitFor(() =>
      expect(mockOpenBrowser).toHaveBeenCalledWith(
        "https://connect.stripe.com/express/acct_1/xyz",
      ),
    );
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/connect/accounts/dashboard-link",
    );
  });

  it("before Stripe: shows the setup action and an empty state, and Payout settings opens setup", async () => {
    routeGets({
      "/coach/connect/status": { account_id: null },
      "/v1/coach/money/summary": {
        ...SUMMARY,
        totals: totals({ net_cents: 0, charge_count: 0, gross_cents: 0 }),
        compare_totals: null,
        change_cents: null,
        change_pct: null,
        attention_count: 0,
      },
      "/v1/coach/money/attention": { count: 0, items: [] },
      "/v1/coach/money/charges": { charges: [], next_cursor: null },
      "/coach/connect/payouts": [],
    });
    const { findByTestId, getByTestId, findByText } = await render(
      <MoneyScreen />,
    );
    await findByTestId("money-setup");
    await findByTestId("money-empty");
    await findByText("Nothing needs you right now.");
    await findByTestId("money-payouts-empty");
    await fireEvent.press(getByTestId("money-payout-settings"));
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("CoachSetup", {
      section: "get_paid",
    });
  });

  it("a failed section shows specific copy with the reference and retries on its own", async () => {
    let fail = true;
    routeGets();
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === "/v1/coach/money/summary" && fail)
        throw httpError(500, { request_id: "req_m1" });
      return base(url, cfg);
    });
    const { findByTestId, getByTestId, findByText } = await render(
      <MoneyScreen />,
    );
    await findByTestId("money-summary-error");
    await findByText("Reference req_m1");
    await findByText("Sam's payment did not go through");
    fail = false;
    await fireEvent.press(getByTestId("money-summary-error-retry"));
    expect((await findByTestId("money-net-amount")).props.children).toBe(
      "$94.80",
    );
  });

  it("offline: keeps the page and says so", async () => {
    mockOnline = false;
    routeGets();
    const { findByTestId } = await render(<MoneyScreen />);
    await findByTestId("money-offline");
  });
});

describe("Money Home card", () => {
  it("shows net 30d with a red attention count and opens Money", async () => {
    routeGets();
    const onOpenMoney = jest.fn();
    const { findByTestId, getByTestId } = await render(
      <MoneyHomeCard onOpenMoney={onOpenMoney} onSetUpStripe={jest.fn()} />,
    );
    expect((await findByTestId("money-home-card-net")).props.children).toBe(
      "$94.80",
    );
    expect(getByTestId("money-home-card-attention")).toBeTruthy();
    await fireEvent.press(getByTestId("money-home-card-open"));
    expect(onOpenMoney).toHaveBeenCalled();
  });

  it("before Stripe offers the setup action", async () => {
    routeGets({
      "/coach/connect/status": { account_id: null },
      "/v1/coach/money/summary": {
        ...SUMMARY,
        totals: totals({ charge_count: 0, net_cents: 0 }),
        attention_count: 0,
      },
    });
    const onSetUpStripe = jest.fn();
    const { findByTestId } = await render(
      <MoneyHomeCard onOpenMoney={jest.fn()} onSetUpStripe={onSetUpStripe} />,
    );
    await fireEvent.press(await findByTestId("money-home-card-setup"));
    expect(onSetUpStripe).toHaveBeenCalled();
  });
});

describe("Charges list and breakdown", () => {
  it("filters by state and pages with the server cursor", async () => {
    mockGet.mockImplementation(
      async (_url: string, cfg: { params: Record<string, unknown> }) => {
        if (cfg.params.status === "failed")
          return {
            data: {
              charges: [{ ...CHARGES.charges[0], id: "ch_f", state: "failed" }],
              next_cursor: null,
            },
          };
        return { data: { charges: CHARGES.charges, next_cursor: "ch_1" } };
      },
    );
    const nav = { navigate: mockNavigate } as never;
    const { findByTestId, getByTestId } = await render(
      <MoneyChargesScreen
        navigation={nav}
        route={{ key: "k", name: "CoachMoneyCharges", params: {} } as never}
      />,
    );
    await findByTestId("money-charges-row-ch_1");
    await fireEvent.press(getByTestId("money-filter-failed"));
    await findByTestId("money-charges-row-ch_f");
    expect(mockGet).toHaveBeenLastCalledWith("/v1/coach/money/charges", {
      params: { status: "failed", limit: 20 },
    });
  });

  it("another coach's charge gets specific copy and a way back", async () => {
    mockGet.mockRejectedValueOnce(
      httpError(404, { code: "MONEY_CHARGE_NOT_FOUND" }),
    );
    const nav = {
      navigate: mockNavigate,
      goBack: jest.fn(),
      getParent: () => undefined,
    } as never;
    const { findByText, getByTestId } = await render(
      <MoneyChargeScreen
        navigation={nav}
        route={
          {
            key: "k",
            name: "CoachMoneyCharge",
            params: { chargeId: "x" },
          } as never
        }
      />,
    );
    await findByText("That charge is not on your account");
    expect(getByTestId("money-charge-back")).toBeTruthy();
  });

  it("shows the per-charge breakdown", async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        charge: CHARGES.charges[0],
        breakdown: {
          price_cents: 4900,
          processing_cents: 172,
          platform_fee_cents: 98,
          head_coach_split_cents: 0,
          refunded_cents: 0,
          net_cents: 4630,
          processing_paid_by: "coach",
          settled: true,
        },
      },
    });
    const nav = {
      navigate: mockNavigate,
      goBack: jest.fn(),
      getParent: () => ({ navigate: mockParentNavigate }),
    } as never;
    const { findByLabelText, getByTestId } = await render(
      <MoneyChargeScreen
        navigation={nav}
        route={
          {
            key: "k",
            name: "CoachMoneyCharge",
            params: { chargeId: "ch_1" },
          } as never
        }
      />,
    );
    await findByLabelText("Net to you: $46.30");
    await findByLabelText("TGP fee (2%): minus $0.98");
    await fireEvent.press(getByTestId("money-charge-message"));
    expect(mockParentNavigate).toHaveBeenCalledWith("ClientsStack", {
      screen: "ClientMessages",
      params: { clientId: "u_sam", clientName: "Sam" },
    });
  });
});

describe("retired routes", () => {
  it("the old Earnings and Business metrics routes redirect to Money", async () => {
    await render(<MoneyRedirect />);
    expect(mockReplace).toHaveBeenCalledWith("CoachMoney");
  });
});

// ─── S-COACH-MOB-4 (agent 114): fix round for AUD-SOL-5 / AUD-OPUS-4 ─────────

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("B-332-1 a period switch never relabels another period's money", () => {
  it("30 days loads, Today fails: no 30-day number under Today, the error and retry show", async () => {
    routeGets();
    const base = mockGet.getMockImplementation()!;
    const { findByTestId, getByTestId, queryByTestId, findByText } =
      await render(<MoneyScreen />);
    expect((await findByTestId("money-net-amount")).props.children).toBe(
      "$94.80",
    );
    mockGet.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === SUMMARY_URL) throw httpError(500, { request_id: "req_t1" });
      return base(url, cfg);
    });
    await fireEvent.press(getByTestId("money-range-today"));
    await findByTestId("money-summary-failed");
    expect(queryByTestId("money-net-amount")).toBeNull();
    expect(queryByTestId("money-net-change")).toBeNull();
    await findByText("Net to you, Today");
    await findByText("Reference req_t1");
    mockGet.mockImplementation(base);
    await fireEvent.press(getByTestId("money-summary-error-retry"));
    const eyebrow = await findByText("Net to you, Today");
    expect(eyebrow).toBeTruthy();
    expect((await findByTestId("money-net-amount")).props.children).toBe(
      "$94.80",
    );
    expect(getByTestId("money-net-change").props.children).toMatch(
      /on yesterday$/,
    );
  });

  it("a slow switch shows a loader for the new period, never the old number", async () => {
    routeGets();
    const base = mockGet.getMockImplementation()!;
    const { findByTestId, getByTestId, queryByTestId } = await render(
      <MoneyScreen />,
    );
    await findByTestId("money-net-amount");
    const slow = deferred<unknown>();
    mockGet.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === SUMMARY_URL) return slow.promise;
      return base(url, cfg);
    });
    await fireEvent.press(getByTestId("money-range-ytd"));
    const loader = await findByTestId("money-summary-loading");
    expect(loader.props.accessibilityLabel).toBe(
      "Loading net to you, Year to date",
    );
    expect(queryByTestId("money-net-amount")).toBeNull();
  });

  it("out of order answers: only the period on screen is shown", async () => {
    routeGets();
    const base = mockGet.getMockImplementation()!;
    const { findByTestId, getByTestId } = await render(<MoneyScreen />);
    await findByTestId("money-net-amount");
    const today = deferred<unknown>();
    mockGet.mockImplementation(
      async (url: string, cfg?: { params?: Record<string, string> }) => {
        if (url !== SUMMARY_URL) return base(url, cfg);
        const fromIso = cfg?.params?.from ?? "";
        const isToday =
          Date.now() - Date.parse(fromIso) < 2 * 86_400_000 &&
          new Date(fromIso).getHours() === 0;
        if (isToday) {
          const late = (await today.promise) as object;
          return { data: echoWindow(late, cfg) };
        }
        return {
          data: echoWindow(
            {
              ...SUMMARY,
              totals: totals({ net_cents: 120000 }),
              compare_totals: totals({ net_cents: 60000 }),
              change_cents: 60000,
            },
            cfg,
          ),
        };
      },
    );
    await fireEvent.press(getByTestId("money-range-today"));
    await fireEvent.press(getByTestId("money-range-ytd"));
    await waitFor(async () =>
      expect((await findByTestId("money-net-amount")).props.children).toBe(
        "$1,200.00",
      ),
    );
    await act(async () => {
      today.resolve({
        ...SUMMARY,
        totals: totals({ net_cents: 111 }),
        compare_totals: totals({ net_cents: 0 }),
        change_cents: 111,
      });
    });
    expect(getByTestId("money-net-amount").props.children).toBe("$1,200.00");
  });

  it("a failed refresh of the same period keeps the numbers, says when they are from and offers retry", async () => {
    routeGets();
    const base = mockGet.getMockImplementation()!;
    const { findByTestId, getByTestId } = await render(<MoneyScreen />);
    await findByTestId("money-net-amount");
    mockGet.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === SUMMARY_URL) throw httpError(503);
      return base(url, cfg);
    });
    await act(async () => {
      await getByTestId("money-screen").props.refreshControl.props.onRefresh();
    });
    await findByTestId("money-summary-stale");
    expect(getByTestId("money-net-amount").props.children).toBe("$94.80");
    expect(getByTestId("money-summary-error-retry")).toBeTruthy();
  });
});

describe("B-332-2 charges name their real cadence", () => {
  const rec = (billing_interval: unknown, billing_interval_count: unknown) =>
    toCharge({
      ...CHARGES.charges[0],
      billing_type: "recurring",
      billing_interval,
      billing_interval_count,
    });
  it("weekly, every 2 weeks, monthly, every 3 months, yearly, unknown", () => {
    expect(cadenceLabel(rec("week", 1))).toBe("Weekly");
    expect(cadenceLabel(rec("week", 2))).toBe("Every 2 weeks");
    expect(cadenceLabel(rec("month", 1))).toBe("Monthly");
    expect(cadenceLabel(rec("month", 3))).toBe("Every 3 months");
    expect(cadenceLabel(rec("year", 1))).toBe("Yearly");
    expect(cadenceLabel(rec(null, null))).toBe("Recurring");
    expect(cadenceLabel(rec("fortnight", 1))).toBe("Recurring");
    expect(
      cadenceLabel(
        toCharge({ ...CHARGES.charges[0], billing_type: "one_time" }),
      ),
    ).toBe("One time");
  });

  it("the charge screen says Every 3 months for a quarterly purchase, never Monthly", async () => {
    mockGet.mockResolvedValue({
      data: {
        charge: {
          ...CHARGES.charges[0],
          amount_cents: 12000,
          billing_interval: "month",
          billing_interval_count: 3,
        },
        breakdown: {
          price_cents: 12000,
          processing_cents: 378,
          platform_fee_cents: 240,
          head_coach_split_cents: 0,
          refunded_cents: 0,
          net_cents: 11382,
          processing_paid_by: "coach",
          settled: true,
        },
      },
    });
    const nav = {
      goBack: jest.fn(),
      getParent: () => ({ navigate: jest.fn() }),
    };
    const { findByTestId } = await render(
      <MoneyChargeScreen
        navigation={nav as never}
        route={
          {
            key: "k",
            name: "CoachMoneyCharge",
            params: { chargeId: "ch_1" },
          } as never
        }
      />,
    );
    const meta = await findByTestId("money-charge-meta");
    const text = [meta.props.children].flat().join("");
    expect(text).toMatch(/Every 3 months/);
    expect(text).not.toMatch(/Monthly/);
  });
});

describe("B-332-3 no invented money: invalid payloads fail with specific copy", () => {
  it("rejects missing amounts, currency, counts and incoherent change", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as MoneyPayloadError).response.data.code;
      }
      return "parsed";
    };
    expect(code(() => toSummary({ totals: {}, recurring: {} }))).toBe(
      "MONEY_PAYLOAD_INVALID",
    );
    const { currency: _c, ...noCurrency } = SUMMARY;
    expect(code(() => toSummary(noCurrency))).toBe("MONEY_PAYLOAD_INVALID");
    expect(
      code(() =>
        toSummary({ ...SUMMARY, totals: totals({ net_cents: 12.5 }) }),
      ),
    ).toBe("MONEY_PAYLOAD_INVALID");
    expect(
      code(() =>
        toSummary({ ...SUMMARY, totals: totals({ net_cents: "9480" }) }),
      ),
    ).toBe("MONEY_PAYLOAD_INVALID");
    expect(code(() => toSummary({ ...SUMMARY, change_cents: 1 }))).toBe(
      "MONEY_PAYLOAD_INVALID",
    );
    expect(code(() => toSummary({ ...SUMMARY, recurring: {} }))).toBe(
      "MONEY_PAYLOAD_INVALID",
    );
    expect(code(() => toSummary({ ...SUMMARY, attention_count: -1 }))).toBe(
      "MONEY_PAYLOAD_INVALID",
    );
    // An answer for another window or currency is refused.
    expect(
      code(() =>
        toSummary(SUMMARY, {
          window: { from: new Date(0), to: new Date(1000) },
        }),
      ),
    ).toBe("MONEY_PAYLOAD_INVALID");
    expect(code(() => toSummary(SUMMARY, { currency: "gbp" }))).toBe(
      "MONEY_PAYLOAD_INVALID",
    );
    const { amount_cents: _a, ...noAmount } = CHARGES.charges[0];
    expect(code(() => toCharge(noAmount))).toBe("MONEY_PAYLOAD_INVALID");
    expect(
      code(() => toCharge({ ...CHARGES.charges[0], currency: undefined })),
    ).toBe("MONEY_PAYLOAD_INVALID");
    expect(
      code(() => toAttentionItem({ ...ATTENTION.items[0], currency: null }, 0)),
    ).toBe("MONEY_PAYLOAD_INVALID");
    expect(
      code(() => toPayout({ id: "p", amount: "10", currency: "usd" })),
    ).toBe("MONEY_PAYLOAD_INVALID");
    expect(code(() => toSummary(SUMMARY))).toBe("parsed");
  });

  it("the invalid-payload copy is specific and carries the request reference", () => {
    let err: unknown;
    try {
      toSummary({ totals: {} }, undefined, { "x-request-id": "req_bad1" });
    } catch (e) {
      err = e;
    }
    const f = describeError(err, "load your Money numbers");
    expect(f.title).toBe("These money figures could not be checked");
    expect(f.body).toMatch(/not showing them/);
    expect(f.body).toMatch(/req_bad1/);
    expect(f.retryable).toBe(true);
    expect(`${f.title} ${f.body}`).not.toMatch(
      /\bwe\b|something went wrong|!/i,
    );
  });

  it("the Money page shows the error instead of $0.00 when the summary is malformed", async () => {
    routeGets({ [SUMMARY_URL]: { totals: {}, recurring: {} } });
    const { findByTestId, queryByTestId, findByText } = await render(
      <MoneyScreen />,
    );
    await findByTestId("money-summary-failed");
    await findByText("These money figures could not be checked");
    expect(queryByTestId("money-net-amount")).toBeNull();
    expect(queryByTestId("money-business")).toBeNull();
  });
});

describe("C-332-1 the Home card never presents a stale number as current", () => {
  it("a failed refresh keeps the last number with its time, the error and a retry", async () => {
    routeGets();
    const base = mockGet.getMockImplementation()!;
    const { findByTestId, getByTestId } = await render(
      <MoneyHomeCard onOpenMoney={jest.fn()} onSetUpStripe={jest.fn()} />,
    );
    await findByTestId("money-home-card-net");
    mockGet.mockImplementation(async (url: string, cfg?: unknown) => {
      if (url === SUMMARY_URL) throw httpError(500, { request_id: "req_h1" });
      return base(url, cfg);
    });
    await act(async () => {
      mockFocus.current?.();
    });
    await findByTestId("money-home-card-stale");
    expect(getByTestId("money-home-card-net").props.children).toBe("$94.80");
    await findByTestId("money-home-card-error");
  });
});

describe("C-332-1 (Opus) an active sub-coach sees who handles money", () => {
  const blocked = () =>
    httpError(403, {
      kind: "sub_coach_billing_blocked",
      message: "Sub-coaches cannot access billing or financial surfaces.",
    });
  it("maps the guard's 403 to quiet head-coach copy, not a permission error", () => {
    expect(isSubCoachBillingBlocked(blocked())).toBe(true);
    expect(isSubCoachBillingBlocked(httpError(403))).toBe(false);
    const f = describeError(blocked(), "load your Money numbers");
    expect(f.title).toBe("Money is handled by your head coach");
    expect(f.retryable).toBe(false);
  });
  it("the Home card says so instead of an error card", async () => {
    routeGets({
      [SUMMARY_URL]: blocked(),
      "/coach/connect/status": blocked(),
    });
    const { findByTestId, queryByTestId } = await render(
      <MoneyHomeCard onOpenMoney={jest.fn()} onSetUpStripe={jest.fn()} />,
    );
    await findByTestId("money-home-card-head-coach");
    expect(queryByTestId("money-home-card-error")).toBeNull();
  });
});

describe("C-332-3 an unknown payout status is never the next payout", () => {
  it("reads as unknown with its own label", () => {
    const odd = toPayout({
      id: "x",
      amount: 5,
      currency: "usd",
      status: "held_by_bank",
      arrival_date: "2026-10-03T00:00:00Z",
    });
    expect(odd.status).toBe("unknown");
    expect(odd.rawStatus).toBe("held_by_bank");
    expect(PAYOUT_LABEL.unknown).toBe("Status from Stripe not recognised");
    expect(nextPayout([odd])).toBeNull();
  });
});

describe("C-332-4 Export CSV for taxes (backend #641 export.csv)", () => {
  it("exports the selected period and currency through the share sheet", async () => {
    routeGets({
      "/v1/coach/money/export.csv": "date_utc,type,charge_id\r\n",
    });
    const base = mockGet.getMockImplementation()!;
    mockGet.mockImplementation(async (url: string, cfg?: unknown) => {
      const r = await base(url, cfg);
      return url === "/v1/coach/money/export.csv"
        ? {
            ...r,
            headers: {
              "content-disposition":
                'attachment; filename="tgp-money-2026-09-02-to-2026-10-02-usd.csv"',
            },
          }
        : r;
    });
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: "sharedAction" } as never);
    const { findByTestId } = await render(<MoneyScreen />);
    await findByTestId("money-net-amount");
    await fireEvent.press(await findByTestId("money-export-csv"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share).toHaveBeenCalledWith({
      title: "tgp-money-2026-09-02-to-2026-10-02-usd.csv",
      message: "date_utc,type,charge_id\r\n",
    });
    const call = mockGet.mock.calls.find(
      (c) => c[0] === "/v1/coach/money/export.csv",
    )!;
    expect(call[1].params.currency).toBe("usd");
    expect(call[1].params.from).toEqual(expect.any(String));
    share.mockRestore();
  });

  it("a period too large to export says what to do", async () => {
    routeGets({
      "/v1/coach/money/export.csv": httpError(400, {
        code: "MONEY_EXPORT_TOO_LARGE",
        message:
          "This period has more than 20000 ledger rows, which is too many for one file. Choose a shorter period, for example one quarter, and export each part.",
      }),
    });
    const { findByTestId, findByText } = await render(<MoneyScreen />);
    await fireEvent.press(await findByTestId("money-export-csv"));
    await findByTestId("money-export-csv-error");
    await findByText(/Choose a shorter period/);
  });
});

describe("#641 per-currency summary: switch currency, never add currencies together", () => {
  it("shows a currency switch and asks the server for the chosen one", async () => {
    routeGets({
      [SUMMARY_URL]: (cfg?: { params?: Record<string, string> }) => {
        const cur = cfg?.params?.currency ?? "usd";
        return echoWindow(
          {
            ...SUMMARY,
            currency: cur,
            currencies: ["gbp", "usd"],
            totals: totals({ net_cents: cur === "gbp" ? 5000 : 9480 }),
            compare_totals: totals({ net_cents: 4740 }),
            change_cents: (cur === "gbp" ? 5000 : 9480) - 4740,
          },
          cfg,
        );
      },
    });
    const { findByTestId, getByTestId } = await render(<MoneyScreen />);
    expect((await findByTestId("money-net-amount")).props.children).toBe(
      "$94.80",
    );
    await fireEvent.press(getByTestId("money-currency-gbp"));
    await waitFor(() =>
      expect(getByTestId("money-net-amount").props.children).toBe("£50.00"),
    );
    const last = mockGet.mock.calls.filter((c) => c[0] === SUMMARY_URL).pop()!;
    expect(last[1].params.currency).toBe("gbp");
  });

  it("the disputed filter exists and copy never speaks as we", () => {
    expect(FILTER_LABEL.disputed).toBe("Disputed");
    const c = attentionCopy({
      kind: "failed_payment",
      id: "p",
      client: { id: "u", name: "Sam" },
      amountCents: 4900,
      currency: "usd",
      createdAt: null,
      failedPayment: {
        packageName: "North",
        attempt: 1,
        maxAttempts: 4,
        nextRetryAt: "2026-10-04T12:00:00Z",
        lockedOutAt: null,
        cardUpdateLinkSentAt: "2026-10-02T12:00:00Z",
        lastFailureReason: null,
      },
      dispute: null,
      stripeRequirements: null,
    });
    expect(c.lines.join(" ")).toMatch(/TGP tries the card again/);
    expect(c.lines.join(" ")).not.toMatch(/\bWe\b|\bwe\b/);
  });
});
