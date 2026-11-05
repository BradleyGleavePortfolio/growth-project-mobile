/**
 * HELD-RENEWAL-M (agent 193): a renewal TGP holds while the coach's Stripe
 * account cannot take payments reads as held, never as a failed payment.
 *
 * The server says a renewal is held with `waiting_on: "coach_account"`
 * (b#1202). It sends three shapes:
 * - today, never paid: state pending, waiting_on coach_account, settled false;
 * - HELD-RENEWAL-BE, paid before: state pending, waiting_on coach_account,
 *   settled true (the plan's earlier payments stay counted);
 * - today, paid before: state failed, waiting_on null. Those bytes are the
 *   same as a real failed renewal, so the phone cannot tell them apart and
 *   keeps main's reading until the server sends waiting_on (pinned below).
 * A real failed payment still reads failed everywhere.
 */
import React from "react";
import { StyleSheet, type TextStyle } from "react-native";
import { fireEvent, render, within } from "@testing-library/react-native";

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
jest.mock("../../../../hooks/useAIBudget", () => ({
  useAIBudget: () => ({
    data: undefined,
    error: null,
    isFetching: false,
    refetch: async () => undefined,
  }),
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
      // EXPO_PUBLIC_FF_COACH_TABS_V2: MoneyBack.tsx:28 reads the stack index (a pushed screen).
      getState: () => ({ index: 1, routes: [] }),
      getParent: () => ({ navigate: jest.fn() }),
    }),
    useIsFocused: () => true,
    useFocusEffect: (cb: () => void) => {
      const R = jest.requireActual("react");
      R.useEffect(() => {
        cb();
      }, [cb]);
    },
  };
});

import MoneyChargeScreen from "../MoneyChargeScreen";
import MoneyChargesScreen from "../MoneyChargesScreen";
import MoneyScreen from "../MoneyScreen";
import { toCharge } from "../../../../api/coachMoneyApi";
import {
  chargeHeld,
  chargeIsProblem,
  chargeRowLabel,
  chargeStateLabel,
} from "../../../../lib/money/moneyCopy";

const HELD_LABEL = "Waiting on your Stripe account";
const HELD_LINE =
  "1 renewal is waiting on your Stripe account. Fix it in Stripe, and TGP tries again.";

function charge(over: Record<string, unknown> = {}) {
  return {
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
    ...over,
  };
}

/** Plan paid three times before: $300 in, fees out. */
const PAID_BEFORE = {
  price_cents: 30000,
  processing_cents: 900,
  platform_fee_cents: 600,
  head_coach_split_cents: 0,
  refunded_cents: 0,
  net_cents: 28500,
  processing_paid_by: "coach",
  settled: true,
};

/** Never paid: the price only, nothing settled. */
const NEVER_PAID = {
  price_cents: 10000,
  processing_cents: 0,
  platform_fee_cents: 0,
  head_coach_split_cents: 0,
  refunded_cents: 0,
  net_cents: 0,
  processing_paid_by: "none",
  settled: false,
};

/** Today: a held renewal never paid (b#1202 main). */
const HELD_NEVER_PAID = { state: "pending", waiting_on: "coach_account" };
/** HELD-RENEWAL-BE: a held renewal on a plan paid before. */
const HELD_PAID_BEFORE = { state: "pending", waiting_on: "coach_account" };
/** A failed row the server marks held (any server that keeps state failed). */
const HELD_MARKED_FAILED = { state: "failed", waiting_on: "coach_account" };
/** A real failed payment, and today's held paid-before (same bytes). */
const REAL_FAILED = { state: "failed", waiting_on: null };

async function renderCharge(
  c: Record<string, unknown>,
  b: Record<string, unknown>,
) {
  mockGet.mockResolvedValueOnce({
    data: { charge: charge(c), breakdown: b },
  });
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
  const r = await render(<MoneyChargeScreen navigation={nav} route={route} />);
  await r.findByTestId("money-charge-meta");
  return r;
}

/** Nothing on the page reads as a failed payment or points to Needs attention. */
function expectNoFailure(r: Awaited<ReturnType<typeof renderCharge>>) {
  expect(r.queryByText("Payment failed")).toBeNull();
  expect(r.queryByText("Latest payment failed")).toBeNull();
  expect(r.queryByText("No money moved")).toBeNull();
  expect(r.queryByText(/did not go through/)).toBeNull();
  expect(r.queryByText(/Needs attention/)).toBeNull();
  expect(r.queryByTestId("money-charge-latest-failed")).toBeNull();
  expect(r.queryByTestId("money-charge-no-money")).toBeNull();
}

beforeEach(() => mockGet.mockReset());

describe("the server's hold flag is read, and nothing else is guessed", () => {
  it("waiting_on coach_account is read; missing, null, unknown or odd values read as not held and never fail the read", () => {
    expect(toCharge(charge(HELD_NEVER_PAID)).waitingOn).toBe("coach_account");
    expect(toCharge(charge({ state: "pending" })).waitingOn).toBeNull();
    expect(
      toCharge(charge({ state: "failed", waiting_on: null })).waitingOn,
    ).toBeNull();
    expect(
      toCharge(charge({ state: "pending", waiting_on: "something_new" }))
        .waitingOn,
    ).toBeNull();
    expect(
      toCharge(charge({ state: "pending", waiting_on: 7 })).waitingOn,
    ).toBeNull();
  });

  it("held only for a renewal not paid yet or not taken; a paid or refunded charge never reads held", () => {
    expect(chargeHeld(toCharge(charge(HELD_NEVER_PAID)))).toBe(true);
    expect(chargeHeld(toCharge(charge(HELD_MARKED_FAILED)))).toBe(true);
    expect(chargeHeld(toCharge(charge(REAL_FAILED)))).toBe(false);
    expect(
      chargeHeld(toCharge(charge({ state: "paid", waiting_on: "coach_account" }))),
    ).toBe(false);
    expect(
      chargeHeld(
        toCharge(charge({ state: "refunded", waiting_on: "coach_account" })),
      ),
    ).toBe(false);
  });

  it("the row label and spoken label say held, not failed and not problem coloured", () => {
    for (const shape of [HELD_NEVER_PAID, HELD_PAID_BEFORE, HELD_MARKED_FAILED]) {
      const c = toCharge(charge(shape));
      expect(chargeStateLabel(c)).toBe(HELD_LABEL);
      expect(chargeIsProblem(c)).toBe(false);
      expect(chargeRowLabel(c)).toContain(HELD_LABEL);
      expect(chargeRowLabel(c)).not.toMatch(/failed/i);
    }
  });

  it("a real failed payment still reads Payment failed, in the problem colour", () => {
    const c = toCharge(charge(REAL_FAILED));
    expect(chargeStateLabel(c)).toBe("Payment failed");
    expect(chargeIsProblem(c)).toBe(true);
  });
});

describe("the charge screen", () => {
  it("today's held renewal, never paid: held, the price not paid yet, no free-trial line, nothing failed", async () => {
    const r = await renderCharge(HELD_NEVER_PAID, NEVER_PAID);
    expect(r.getByText(HELD_LABEL)).toBeTruthy();
    const held = r.getByTestId("money-charge-held");
    expect(within(held).getByText(HELD_LINE)).toBeTruthy();
    expect(r.getByLabelText("Price, not paid yet: $100.00")).toBeTruthy();
    expect(r.queryByText(/free trial/)).toBeNull();
    expect(r.queryByText("Not paid yet")).toBeNull();
    expect(r.queryByText(/Clients paid/)).toBeNull();
    expectNoFailure(r);
  });

  it("HELD-RENEWAL-BE's held renewal, paid before: held, and the plan's payments so far stay counted", async () => {
    const r = await renderCharge(HELD_PAID_BEFORE, PAID_BEFORE);
    expect(r.getByText(HELD_LABEL)).toBeTruthy();
    const held = r.getByTestId("money-charge-held");
    expect(within(held).getByText(/Earlier payments are counted below\./)).toBeTruthy();
    expect(within(held).getByText(`${HELD_LINE} Earlier payments are counted below.`)).toBeTruthy();
    expect(r.getByText("This plan so far")).toBeTruthy();
    expect(r.getByLabelText("Clients paid so far: $300.00")).toBeTruthy();
    expect(r.getByLabelText("Net to you: $285.00")).toBeTruthy();
    expect(r.queryByText("Price, not paid yet")).toBeNull();
    expect(r.queryByTestId("money-charge-unsettled")).toBeNull();
    expectNoFailure(r);
  });

  it("a held renewal the server still marks failed reads held too, totals kept", async () => {
    const r = await renderCharge(HELD_MARKED_FAILED, PAID_BEFORE);
    expect(r.getByText(HELD_LABEL)).toBeTruthy();
    expect(r.getByTestId("money-charge-held")).toBeTruthy();
    expect(r.getByLabelText("Clients paid so far: $300.00")).toBeTruthy();
    expectNoFailure(r);
  });

  it("a plan not paid this time but paid before, with no hold flag, keeps its totals so far (no 'Price, not paid yet')", async () => {
    const r = await renderCharge({ state: "pending" }, PAID_BEFORE);
    expect(r.getByText("Not paid yet")).toBeTruthy();
    expect(r.getByText("This plan so far")).toBeTruthy();
    expect(r.getByLabelText("Clients paid so far: $300.00")).toBeTruthy();
    expect(r.queryByText("Price, not paid yet")).toBeNull();
    expect(r.queryByTestId("money-charge-held")).toBeNull();
  });

  it("an unpaid free trial (no hold flag) is unchanged", async () => {
    const r = await renderCharge({ state: "pending" }, NEVER_PAID);
    expect(r.getByText("Not paid yet")).toBeTruthy();
    expect(r.getByText(/A free trial is billed when it ends\./)).toBeTruthy();
    expect(r.getByLabelText("Price, not paid yet: $100.00")).toBeTruthy();
    expect(r.queryByTestId("money-charge-held")).toBeNull();
  });

  it("a real failed renewal on a plan paid before still reads failed (today's held paid-before shape is the same bytes)", async () => {
    const r = await renderCharge(REAL_FAILED, PAID_BEFORE);
    expect(r.getByText("Payment failed")).toBeTruthy();
    expect(r.getByTestId("money-charge-latest-failed")).toBeTruthy();
    expect(r.getByLabelText("Clients paid so far: $300.00")).toBeTruthy();
    expect(r.queryByTestId("money-charge-held")).toBeNull();
  });

  it("a real failed one-time payment still reads failed with no money moved", async () => {
    const r = await renderCharge(
      {
        ...REAL_FAILED,
        billing_type: "one_time",
        billing_interval: null,
        billing_interval_count: null,
      },
      NEVER_PAID,
    );
    expect(r.getByText("Payment failed")).toBeTruthy();
    expect(r.getByTestId("money-charge-no-money")).toBeTruthy();
    expect(r.queryByTestId("money-charge-held")).toBeNull();
  });
});

function labelColor(node: { props: Record<string, unknown> }): unknown {
  const flat = StyleSheet.flatten(node.props.style as TextStyle | TextStyle[]);
  return flat?.color;
}

describe("the Money page's recent charges", () => {
  it("a held row says held in the plain colour; a real failed row still says Payment failed in the problem colour", async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url === "/v1/coach/money/charges")
        return {
          data: {
            charges: [
              charge({ id: "ch_held", ...HELD_NEVER_PAID }),
              charge({ id: "ch_held2", ...HELD_PAID_BEFORE }),
              charge({ id: "ch_fail", ...REAL_FAILED }),
              charge({ id: "ch_paid" }),
            ],
            next_cursor: null,
          },
        };
      throw Object.assign(new Error("HTTP 404"), {
        response: { status: 404, data: {}, headers: {} },
      });
    });
    const r = await render(<MoneyScreen />);
    const held = await r.findByTestId("money-charge-ch_held");
    const held2 = r.getByTestId("money-charge-ch_held2");
    const failed = r.getByTestId("money-charge-ch_fail");
    const paid = r.getByTestId("money-charge-ch_paid");
    const heldLabel = within(held).getByText(HELD_LABEL);
    expect(within(held2).getByText(HELD_LABEL)).toBeTruthy();
    const failedLabel = within(failed).getByText("Payment failed");
    const paidLabel = within(paid).getByText("Paid");
    expect(within(held).queryByText(/failed/i)).toBeNull();
    expect(labelColor(heldLabel)).toBe(labelColor(paidLabel));
    expect(labelColor(heldLabel)).not.toBe(labelColor(failedLabel));
    expect(held.props.accessibilityLabel).toContain(HELD_LABEL);
  });
});

describe("the Charges list and its Failed filter", () => {
  async function renderList(byFilter: Record<string, unknown[]>) {
    mockGet.mockImplementation(
      async (_url: string, cfg: { params: Record<string, unknown> }) => ({
        data: {
          charges: byFilter[String(cfg.params.status)] ?? [],
          next_cursor: null,
        },
      }),
    );
    const nav = { navigate: jest.fn() };
    const r = await render(
      <MoneyChargesScreen
        navigation={nav as never}
        route={{ key: "k", name: "CoachMoneyCharges", params: {} } as never}
      />,
    );
    return Object.assign(r, { nav });
  }

  it("All shows a held row as held, a real failed row as failed", async () => {
    const r = await renderList({
      all: [
        charge({ id: "ch_held", ...HELD_NEVER_PAID }),
        charge({ id: "ch_fail", ...REAL_FAILED }),
      ],
    });
    const held = await r.findByTestId("money-charges-row-ch_held");
    expect(within(held).getByText(HELD_LABEL)).toBeTruthy();
    expect(within(held).queryByText(/failed/i)).toBeNull();
    const failed = r.getByTestId("money-charges-row-ch_fail");
    expect(within(failed).getByText("Payment failed")).toBeTruthy();
    // A held row still opens its charge (no dead end).
    await fireEvent.press(held);
    expect(r.nav.navigate).toHaveBeenCalledWith("CoachMoneyCharge", {
      chargeId: "ch_held",
    });
  });

  it("Failed leaves out a row the server marks held and keeps every real failed payment", async () => {
    const r = await renderList({
      all: [charge({ id: "ch_paid" })],
      failed: [
        charge({ id: "ch_held", ...HELD_MARKED_FAILED }),
        charge({ id: "ch_fail", ...REAL_FAILED }),
      ],
    });
    await r.findByTestId("money-charges-row-ch_paid");
    await fireEvent.press(r.getByTestId("money-filter-failed"));
    const failed = await r.findByTestId("money-charges-row-ch_fail");
    expect(within(failed).getByText("Payment failed")).toBeTruthy();
    expect(r.queryByTestId("money-charges-row-ch_held")).toBeNull();
    expect(r.queryByText(HELD_LABEL)).toBeNull();
  });

  it("Failed with only a held row shows the empty Failed line, not a failed payment", async () => {
    const r = await renderList({
      all: [charge({ id: "ch_paid" })],
      failed: [charge({ id: "ch_held", ...HELD_MARKED_FAILED })],
    });
    await r.findByTestId("money-charges-row-ch_paid");
    await fireEvent.press(r.getByTestId("money-filter-failed"));
    await r.findByTestId("money-charges-empty");
    expect(r.queryByTestId("money-charges-row-ch_held")).toBeNull();
  });
});
