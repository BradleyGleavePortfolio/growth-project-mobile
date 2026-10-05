/**
 * FIX ROUND (B-MON2-122, agent 122): the charge page and the held balance say
 * only what is true.
 * - Opus B-349-1: a recurring plan's breakdown is the plan's totals so far,
 *   not one payment; a failed renewal keeps the earlier payments.
 * - Sol B-349-1: a free trial that has not billed shows no paid-money
 *   equation and no payment-clearing claim.
 * - Sol B-349-2: the held balance is explained as money being recovered on
 *   refunds and chargebacks, not as fees only.
 */
import React from "react";
import { render } from "@testing-library/react-native";

const mockGet = jest.fn();
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() },
}));
jest.mock("../../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("expo-web-browser", () => ({
  __esModule: true,
  openBrowserAsync: jest.fn(),
}));
jest.mock("../../../../hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      replace: jest.fn(),
      goBack: jest.fn(),
      canGoBack: () => true,
      getParent: () => ({ navigate: jest.fn() }),
    }),
    useFocusEffect: (cb: () => void) => {
      const R = jest.requireActual("react");
      R.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

import MoneyChargeScreen from "../MoneyChargeScreen";
import MoneyScreen from "../MoneyScreen";

function detail(
  charge: Record<string, unknown>,
  breakdown: Record<string, unknown>,
) {
  return {
    data: {
      charge: {
        id: "ch_1",
        client: { id: "u_sam", name: "Sam" },
        package: { id: "pk", name: "North coaching" },
        amount_cents: 10000,
        currency: "usd",
        billing_type: "recurring",
        billing_interval: "month",
        billing_interval_count: 1,
        state: "paid",
        refunded_cents: 0,
        created_at: "2026-10-01T00:00:00Z",
        ...charge,
      },
      breakdown: {
        price_cents: 30000,
        processing_cents: 900,
        platform_fee_cents: 600,
        head_coach_split_cents: 0,
        refunded_cents: 0,
        net_cents: 28500,
        processing_paid_by: "coach",
        settled: true,
        ...breakdown,
      },
    },
  };
}

async function renderCharge() {
  const nav = {
    navigate: jest.fn(),
    goBack: jest.fn(),
    canGoBack: () => true,
    getParent: () => ({ navigate: jest.fn() }),
  } as never;
  const route = {
    key: "k",
    name: "CoachMoneyCharge",
    params: { chargeId: "ch_1" },
  } as never;
  return render(<MoneyChargeScreen navigation={nav} route={route} />);
}

beforeEach(() => mockGet.mockReset());

describe("Opus B-349-1: a recurring plan's breakdown is the plan so far", () => {
  it("one $100 monthly charge paid three times: the header is one payment, the breakdown is labelled as the plan so far", async () => {
    mockGet.mockResolvedValueOnce(detail({}, {}));
    const r = await renderCharge();
    await r.findByText("$100.00 monthly");
    expect(r.getByText("This plan so far")).toBeTruthy();
    expect(r.getByLabelText("Clients paid so far: $300.00")).toBeTruthy();
    expect(r.queryByText("How this adds up to your net")).toBeNull();
    expect(r.queryByText("Clients paid")).toBeNull();
  });

  it("the latest renewal failed: says so and keeps the earlier payments, never that the client was not charged", async () => {
    mockGet.mockResolvedValueOnce(detail({ state: "failed" }, {}));
    const r = await renderCharge();
    await r.findByTestId("money-charge-latest-failed");
    expect(
      r.getByText(/latest payment on this plan did not go through/),
    ).toBeTruthy();
    expect(r.getByTestId("money-charge-breakdown")).toBeTruthy();
    expect(r.getByLabelText("Clients paid so far: $300.00")).toBeTruthy();
    expect(r.queryByText(/client was not charged/)).toBeNull();
    expect(r.queryByTestId("money-charge-no-money")).toBeNull();
  });

  it("a one-time charge keeps the single-charge wording", async () => {
    mockGet.mockResolvedValueOnce(
      detail(
        {
          billing_type: "one_time",
          billing_interval: null,
          billing_interval_count: null,
        },
        {
          price_cents: 10000,
          processing_cents: 320,
          platform_fee_cents: 200,
          net_cents: 9480,
        },
      ),
    );
    const r = await renderCharge();
    await r.findByText("How this adds up to your net");
    expect(r.getByLabelText("Clients paid: $100.00")).toBeTruthy();
    expect(r.queryByText(/so far|monthly/)).toBeNull();
  });
});

describe("Sol B-349-1: an unpaid free trial shows no paid-money equation", () => {
  it("a $49 trial that has not billed: Not paid yet, the scheduled price, no Clients paid, no net, no clearing claim", async () => {
    mockGet.mockResolvedValueOnce(
      detail(
        { amount_cents: 4900, state: "pending" },
        {
          price_cents: 4900,
          processing_cents: 0,
          platform_fee_cents: 0,
          net_cents: 0,
          processing_paid_by: "none",
          settled: false,
        },
      ),
    );
    const r = await renderCharge();
    await r.findByTestId("money-charge-unsettled");
    expect(r.getByText("Not paid yet")).toBeTruthy();
    expect(r.getByLabelText("Price, not paid yet: $49.00")).toBeTruthy();
    expect(r.queryByText(/Clients paid/)).toBeNull();
    expect(r.queryByText(/Net to you/)).toBeNull();
    expect(r.queryByText(/TGP fee/)).toBeNull();
    expect(r.queryByText(/clears/)).toBeNull();
  });
});

describe("Sol B-349-2: the held balance is not described as fees only", () => {
  it("a $100 hold after refunding a sale already paid out names the paid-out money being recovered", async () => {
    const totals = {
      gross_cents: 0,
      processing_cents: 0,
      platform_fee_cents: 0,
      head_coach_split_cents: 0,
      refunded_cents: 0,
      head_coach_income_cents: 0,
      net_cents: 0,
      charge_count: 0,
      processing_paid_by: "none",
    };
    const summary = {
      currency: "usd",
      window: { from: "2026-09-02T00:00:00Z", to: "2026-10-02T00:00:00Z" },
      totals,
      compare_totals: totals,
      change_cents: 0,
      change_pct: null,
      recurring: {
        mrr_cents: 0,
        paying_clients: 0,
        churned_30d: 0,
        new_clients_30d: 0,
      },
      attention_count: 0,
      held_from_next_sale_cents: 10000,
      generated_at: "2026-10-02T19:00:00Z",
    };
    mockGet.mockImplementation(
      async (url: string, cfg?: { params?: Record<string, string> }) => {
        if (url === "/v1/coach/money/summary")
          return {
            data: {
              ...summary,
              window: { from: cfg?.params?.from, to: cfg?.params?.to },
            },
          };
        if (url === "/coach/connect/status")
          return {
            data: {
              account_id: "acct_1",
              state: "active",
              charges_enabled: true,
              payouts_enabled: true,
            },
          };
        throw Object.assign(new Error("HTTP 404"), {
          response: { status: 404, data: {}, headers: {} },
        });
      },
    );
    const r = await render(<MoneyScreen />);
    const held = await r.findByTestId("money-held");
    expect(r.getByText(/already paid out to your bank/)).toBeTruthy();
    expect(held).toBeTruthy();
    expect(
      r.queryByText(
        /TGP keeps its 2% and the Stripe fees on that charge from your next sale, on top/,
      ),
    ).toBeNull();
  });
});
