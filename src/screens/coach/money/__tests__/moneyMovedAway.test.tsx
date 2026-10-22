/**
 * SWITCH-TELL-M: a charge whose client moved to the house coach after buying
 * from this coach (backend b#1132, CONTRACT 6348078315 item 2) carries
 * moved_away_at. The charge keeps its name, date and amount; client.id is ""
 * and the package is empty. Every charge surface shows the quiet line
 * "Moved to another coach · {date}" (the coach's local date) and nothing more;
 * a charge without moved_away_at shows no line. Names are fictional.
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

import { toCharge, MoneyPayloadError } from "../../../../api/coachMoneyApi";
import { chargeRowLabel, movedAwayLine } from "../../../../lib/money/moneyCopy";
import MoneyChargeScreen from "../MoneyChargeScreen";
import MoneyChargesScreen from "../MoneyChargesScreen";
import MoneyScreen from "../MoneyScreen";

// Midday UTC, so the local date is Oct 20 in every US and European zone.
const MOVED_AT = "2026-10-20T12:00:00.000Z";
const LINE = "Moved to another coach · Oct 20";

const KEPT = {
  id: "ch_kept",
  client: { id: "u_ana", name: "Ana Ruiz" },
  package: { id: "pk", name: "North coaching" },
  amount_cents: 12000,
  currency: "usd",
  billing_type: "one_time",
  state: "paid",
  refunded_cents: 0,
  created_at: "2026-10-01T12:00:00Z",
  moved_away_at: null,
};
const MOVED = {
  ...KEPT,
  id: "ch_moved",
  client: { id: "", name: "Sam Lee" },
  package: { id: "", name: "" },
  moved_away_at: MOVED_AT,
};

const TOTALS = {
  gross_cents: 12000,
  processing_cents: 378,
  platform_fee_cents: 240,
  head_coach_split_cents: 0,
  refunded_cents: 0,
  head_coach_income_cents: 0,
  net_cents: 11382,
  charge_count: 1,
  processing_paid_by: "coach",
};

function serve() {
  mockGet.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => {
    if (url === "/v1/coach/money/summary")
      return {
        data: {
          currency: "usd",
          window: { from: cfg?.params?.from, to: cfg?.params?.to },
          totals: TOTALS,
          compare_totals: TOTALS,
          change_cents: 0,
          change_pct: null,
          recurring: { mrr_cents: 0, paying_clients: 1, churned_30d: 0, new_clients_30d: 0 },
          attention_count: 0,
          held_from_next_sale_cents: 0,
          generated_at: "2026-10-22T19:00:00Z",
        },
      };
    if (url === "/coach/connect/status")
      return {
        data: { account_id: "acct_1", state: "active", charges_enabled: true, payouts_enabled: true },
      };
    if (url === "/v1/coach/money/charges")
      return { data: { charges: [MOVED, KEPT], next_cursor: null } };
    if (url === "/v1/coach/money/charges/ch_moved")
      return {
        data: {
          charge: MOVED,
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
      };
    throw Object.assign(new Error("HTTP 404"), {
      response: { status: 404, data: {}, headers: {} },
    });
  });
}

const nav = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  getParent: () => ({ navigate: jest.fn() }),
} as never;

beforeEach(() => mockGet.mockReset());

describe("SWITCH-TELL-M: the moved-away line on Money charges", () => {
  it("reads moved_away_at; null or absent (today's server) is no line", () => {
    expect(toCharge(MOVED).movedAwayAt).toBe(MOVED_AT);
    expect(toCharge(KEPT).movedAwayAt).toBeNull();
    const older: Record<string, unknown> = { ...KEPT };
    delete older.moved_away_at;
    expect(toCharge(older).movedAwayAt).toBeNull();
    expect(() => toCharge({ ...KEPT, moved_away_at: "soon" })).toThrow(
      MoneyPayloadError,
    );
    expect(movedAwayLine(toCharge(MOVED))).toBe(LINE);
    expect(movedAwayLine(toCharge(KEPT))).toBeNull();
  });

  it("the spoken row label has no empty package and says the move", () => {
    expect(chargeRowLabel(toCharge(MOVED))).toBe(
      "Sam Lee, $120.00, Paid, Moved to another coach, Oct 20. Open the breakdown",
    );
    expect(chargeRowLabel(toCharge(KEPT))).toBe(
      "Ana Ruiz, North coaching, $120.00, Paid. Open the breakdown",
    );
  });

  it("All charges: the moved row has the line, the other row does not", async () => {
    serve();
    const r = await render(
      <MoneyChargesScreen
        navigation={nav}
        route={{ key: "k", name: "CoachMoneyCharges", params: {} } as never}
      />,
    );
    await r.findByTestId("money-charges-row-ch_moved");
    expect(r.getAllByText(LINE)).toHaveLength(1);
    expect(
      r.getByLabelText(
        "Sam Lee, $120.00, Paid, Moved to another coach, Oct 20. Open the breakdown",
      ),
    ).toBeTruthy();
    expect(r.getByText("Ana Ruiz")).toBeTruthy();
  });

  it("Recent charges on Money: the same line", async () => {
    serve();
    const r = await render(<MoneyScreen />);
    await r.findByTestId("money-charge-ch_moved");
    expect(r.getAllByText(LINE)).toHaveLength(1);
  });

  it("the charge page: name, amount and the line; no Message button", async () => {
    serve();
    const route = {
      key: "k",
      name: "CoachMoneyCharge",
      params: { chargeId: "ch_moved" },
    } as never;
    const r = await render(<MoneyChargeScreen navigation={nav} route={route} />);
    expect((await r.findByTestId("money-charge-moved")).props.children).toBe(
      LINE,
    );
    expect(r.getByText("Sam Lee")).toBeTruthy();
    expect(r.queryByText(/^Message /)).toBeNull();
  });
});
