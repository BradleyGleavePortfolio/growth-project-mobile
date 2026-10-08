/**
 * COACH-PAY-M-130: a coach's payments for one client on the CF-COACH-PAY-BE-128
 * routes. Seen in a test: plans, payments and only the allowed actions; a
 * refund sends the payment, amount and one key per tap and says what it does
 * to access (an earlier month included); pause and cancel ask first; refusals
 * and lost replies say what happened; the Summary pill appears only while
 * coach_payment_actions is on and never for a sub-coach.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import { Alert, type AlertButton } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockGet = jest.fn();
const mockPost = jest.fn();
let mockKey = 0;
jest.mock("../../../services/api", () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock("../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("../../../utils/idempotency", () => ({ generateIdempotencyKey: () => `key-${++mockKey}` }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ canGoBack: () => true, goBack: jest.fn(), getParent: () => undefined }),
}));
jest.mock("../../../hooks/useMacros", () => ({
  useCurrentMacrosForClient: () => ({ data: undefined, isLoading: true, isError: false, refetch: jest.fn() }),
}));
jest.mock("../../../components/coach/CoachAiSection", () => () => null);
jest.mock("../client-detail/ConsultationSummaryCard", () => ({ ConsultationSummaryCard: () => null }));
let mockRole = "head_coach";
jest.mock("../../../hooks/useCoachRoleType", () => ({
  useCoachTeamStatus: () => ({ role: mockRole, hasSubCoaches: false }),
}));

import ClientPaymentsScreen from "../ClientPaymentsScreen";
import { SummaryTab } from "../client-detail/SummaryTab";
import { makeStyles } from "../client-detail/styles";
import type { ThemeColors } from "../../../theme/ThemeProvider";
import { headCoachHandlesMoney, noteHeadCoachHandlesMoney } from "../../../lib/money/headCoachRole";

const PAID = "2026-10-01T12:00:00.000Z";
const NEXT = "2026-11-01T12:00:00.000Z";
const ALL_OFF = { refund: false, pause: false, resume: false, cancel: false, restart: false };
const payment = (over: Record<string, unknown> = {}) => ({
  charge_id: "ch-1", amount_cents: 5000, refunded_cents: 0, refundable_cents: 5000,
  currency: "usd", paid_at: PAID, refunds: [], ...over,
});
const plan = (over: Record<string, unknown> = {}) => ({
  purchase_id: "pur-1", package_name: "Strength 12", billing_type: "recurring", status: "active",
  amount_cents: 5000, currency: "usd", created_at: PAID, current_period_end: NEXT,
  access_expires_at: null, cancel_at_period_end: false, entitlement_active: true, billing: "running",
  actions: { ...ALL_OFF, refund: true, pause: true, cancel: true }, payments: [payment()], ...over,
});
const list = (...plans: unknown[]) => ({ data: { plans } });
const route = { key: "k", name: "ClientPayments" as const, params: { clientId: "client-1", clientName: "Jane" } };

async function open(...plans: unknown[]) {
  mockGet.mockResolvedValue(list(...plans));
  await render(<ClientPaymentsScreen route={route} />);
  await waitFor(() => expect(screen.getByTestId("client-payments-screen")).toBeTruthy());
}
async function confirmAlert(title: string): Promise<string> {
  const call = jest.mocked(Alert.alert).mock.calls.find((c) => c[0] === title);
  if (!call) throw new Error(`no alert ${title}`);
  const buttons = (call[2] ?? []) as AlertButton[];
  await act(async () => buttons[buttons.length - 1].onPress?.());
  return String(call[1]);
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("ClientPaymentsScreen (COACH-PAY-M-130)", () => {
  it("lists each plan with its price, billing state, payments and only the allowed actions", async () => {
    const oneTime = plan({
      purchase_id: "pur-2", package_name: "Nutrition", billing_type: "one_time", billing: "one_time",
      amount_cents: 12000, current_period_end: null, actions: { ...ALL_OFF, refund: true },
      payments: [payment({ charge_id: "ch-2", amount_cents: 12000, refunded_cents: 2000, refundable_cents: 10000,
        refunds: [{ id: "r1", amount_cents: 2000, status: "succeeded" }, { id: "r2", amount_cents: 500, status: "pending" }] })],
    });
    await open(plan(), oneTime);
    expect(mockGet).toHaveBeenCalledWith("/v1/coach/clients/client-1/payments");
    expect(await screen.findByText("$50.00, recurring")).toBeTruthy();
    expect(screen.getByTestId("plan-state-pur-1").props.children).toMatch(/^Billing is on\. The next payment is due /);
    expect(screen.getByTestId("plan-action-pause-billing-pur-1")).toBeTruthy();
    expect(screen.getByTestId("plan-action-cancel-plan-pur-1")).toBeTruthy();
    expect(screen.queryByTestId("plan-action-resume-billing-pur-1")).toBeNull();
    expect(screen.getByText("$120.00, one time")).toBeTruthy();
    expect(screen.getByText("Paid once. Nothing more is charged.")).toBeTruthy();
    expect(screen.getByText(/\$20\.00 refunded\. \$5\.00 refund in progress\.$/)).toBeTruthy();
    expect(screen.queryByTestId("plan-action-cancel-plan-pur-2")).toBeNull();
    expect(screen.getByTestId("payment-refund-ch-1")).toBeTruthy();
    expect(screen.getByTestId("payment-refund-ch-2")).toBeTruthy();
  });

  it("shows no Refund when nothing is left to refund, and Resume on a paused plan", async () => {
    await open(plan({
      billing: "paused", actions: { ...ALL_OFF, refund: true, resume: true, cancel: true },
      payments: [payment({ refunded_cents: 5000, refundable_cents: 0, refunds: [{ id: "r1", amount_cents: 5000, status: "succeeded" }] })],
    }));
    expect(await screen.findByText(/^Paid .*\. Refunded in full\.$/)).toBeTruthy();
    expect(screen.queryByTestId("payment-refund-ch-1")).toBeNull();
    expect(screen.getByText("Billing is paused. Nothing is charged while it is paused, and Jane keeps access.")).toBeTruthy();
    expect(screen.getByTestId("plan-action-resume-billing-pur-1")).toBeTruthy();
    expect(screen.queryByTestId("plan-action-pause-billing-pur-1")).toBeNull();
  });

  it("refunds what is left by default, says on the button that access ends, and sends charge, amount and key", async () => {
    await open(plan());
    await fireEvent.press(await screen.findByTestId("payment-refund-ch-1"));
    expect(screen.getByTestId("refund-amount").props.value).toBe("50.00");
    expect(screen.getByTestId("refund-consequence").props.children).toBe(
      "Refunding all of this payment ends Jane's access to Strength 12 and pauses its billing until the plan is restarted.",
    );
    mockPost.mockResolvedValue({ data: {
      refund: { id: "re_1", charge_id: "ch-1", amount_cents: 5000, currency: "usd", status: "succeeded" },
      plan: plan({ status: "refunded", billing: "paused_by_refund_or_dispute",
        actions: { ...ALL_OFF, cancel: true, restart: true },
        payments: [payment({ refunded_cents: 5000, refundable_cents: 0 })] }),
    } });
    await fireEvent.press(screen.getByText("Refund $50.00 and end access"));
    await waitFor(() => expect(screen.getByTestId("plan-notice-pur-1")).toBeTruthy());
    const [url, body] = mockPost.mock.calls[0];
    expect(url).toBe("/v1/coach/clients/client-1/payments/pur-1/refund");
    expect(body).toEqual({ idempotency_key: expect.stringMatching(/^key-/), charge_id: "ch-1", amount_cents: 5000 });
    expect(screen.getByText("Refunded $50.00. It goes back to the card Jane paid with.")).toBeTruthy();
    expect(screen.getByTestId("plan-state-pur-1").props.children).toMatch(/^Billing is paused after a full refund/);
    expect(screen.getByTestId("plan-action-restart-plan-pur-1")).toBeTruthy();
    expect(screen.queryByTestId("refund-sheet")).toBeNull();
  });

  it("refunding all of an earlier month warns that it still ends access and pauses billing", async () => {
    await open(plan({ payments: [payment({ charge_id: "ch-new" }), payment({ charge_id: "ch-old", paid_at: "2026-09-01T12:00:00.000Z" })] }));
    await fireEvent.press(await screen.findByTestId("payment-refund-ch-old"));
    expect(screen.getByTestId("refund-consequence").props.children).toBe(
      "This is an earlier payment, but refunding all of it still ends Jane's access to Strength 12 and pauses its billing until the plan is restarted.",
    );
    expect(screen.getByText("Refund $50.00 and end access")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("refund-amount"), "49.99");
    expect(screen.getByText("Refund $49.99")).toBeTruthy();
  });

  it("a partial refund keeps access; an amount above what is left cannot be sent", async () => {
    await open(plan());
    await fireEvent.press(await screen.findByTestId("payment-refund-ch-1"));
    await fireEvent.changeText(screen.getByTestId("refund-amount"), "20");
    expect(screen.getByTestId("refund-consequence").props.children).toBe("Jane keeps access, and billing carries on as before.");
    expect(screen.getByText("Refund $20.00")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("refund-amount"), "60");
    expect(screen.getByTestId("refund-consequence").props.children).toBe("Enter an amount up to $50.00.");
    await fireEvent.press(screen.getByTestId("refund-confirm"));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a refused refund shows the server's reason; a retry after a lost reply reuses the key", async () => {
    await open(plan());
    await fireEvent.press(await screen.findByTestId("payment-refund-ch-1"));
    const refused = "That amount is more than is left to refund on this payment, so nothing was refunded. Pull down to refresh.";
    mockPost.mockRejectedValueOnce({ response: { status: 409, data: { code: "REFUND_AMOUNT_TOO_LARGE", error: "Conflict", message: refused } } });
    await fireEvent.press(screen.getByTestId("refund-confirm"));
    expect(await screen.findByText(refused)).toBeTruthy();
    mockPost.mockRejectedValueOnce(new Error("Network Error"));
    await fireEvent.press(screen.getByTestId("refund-confirm"));
    expect(await screen.findByText(/^No answer came back, so it is not known whether TGP could refund this payment\./)).toBeTruthy();
    expect(mockPost.mock.calls[1][1].idempotency_key).toBe(mockPost.mock.calls[0][1].idempotency_key);
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it("pause asks first, then pauses with the key of that tap", async () => {
    await open(plan());
    await fireEvent.press(await screen.findByTestId("plan-action-pause-billing-pur-1"));
    mockPost.mockResolvedValue({ data: { plan: plan({ billing: "paused", actions: { ...ALL_OFF, refund: true, resume: true, cancel: true } }) } });
    expect(await confirmAlert("Pause billing?")).toMatch(/^Nothing is charged while billing is paused, and Jane keeps access to Strength 12\./);
    await waitFor(() => expect(screen.getByText("Billing paused for Strength 12.")).toBeTruthy());
    expect(mockPost).toHaveBeenCalledWith("/v1/coach/clients/client-1/payments/pur-1/pause", { idempotency_key: expect.stringMatching(/^key-/) });
    expect(screen.getByTestId("plan-action-resume-billing-pur-1")).toBeTruthy();
  });

  it("cancel says when billing stops and shows the server's outcome", async () => {
    await open(plan());
    await fireEvent.press(await screen.findByTestId("plan-action-cancel-plan-pur-1"));
    const outcome = "Billing stops at the end of the current period. The client keeps access until then and is not charged again.";
    mockPost.mockResolvedValue({ data: { outcome: "scheduled", access_ends_at: NEXT, voided_invoice_count: 0, voided_amount_cents: 0,
      message: outcome, plan: plan({ cancel_at_period_end: true, actions: { ...ALL_OFF, refund: true } }) } });
    expect(await confirmAlert("Cancel this plan?")).toMatch(/^Billing stops at the end of the current period, on .+\. Jane keeps access until then/);
    expect(await screen.findByText(outcome)).toBeTruthy();
    expect(mockPost.mock.calls[0][0]).toBe("/v1/coach/clients/client-1/payments/pur-1/cancel");
    expect(screen.getByTestId("plan-state-pur-1").props.children).toMatch(/^Canceled\. Jane keeps access until .+, and nothing more is charged\.$/);
  });

  it("a failed latest payment says why there is no pause, and cancel ends the plan now", async () => {
    await open(plan({ status: "past_due", actions: { ...ALL_OFF, refund: true, cancel: true } }));
    expect(await screen.findByText("The latest payment did not go through, so billing cannot be paused. Cancel plan ends the plan now.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("plan-action-cancel-plan-pur-1"));
    const body = String(jest.mocked(Alert.alert).mock.calls[0][1]);
    expect(body).toBe("The plan ends now and unpaid invoices are voided, so nothing more is charged. Jane's access to Strength 12 ends.");
  });

  it("empty, sub-coach and unreadable replies each say what happened", async () => {
    await open();
    expect(await screen.findByText("Jane has not paid for any of your packages yet. Payments show here once they do.")).toBeTruthy();
    await screen.unmount();
    mockGet.mockRejectedValue({ response: { status: 403, data: { kind: "sub_coach_billing_blocked" } } });
    await render(<ClientPaymentsScreen route={route} />);
    expect(await screen.findByText("Money is handled by your head coach")).toBeTruthy();
    expect(headCoachHandlesMoney()).toBe(true);
    noteHeadCoachHandlesMoney(false);
    await screen.unmount();
    mockGet.mockReset();
    await open(plan({ amount_cents: "50.00" }));
    expect(await screen.findByText("These money figures could not be checked")).toBeTruthy();
    expect(screen.queryByText(/\$50\.00/)).toBeNull();
  });
});

describe("entry and parity (COACH-PAY-M-130)", () => {
  const colors = {} as ThemeColors;
  const noop = () => undefined;
  const tab = (onOpenPayments?: () => void) => (
    <SummaryTab profile={null} totals={{ calories: 0, protein: 0, carbs: 0, fat: 0 }} foodShared={false} clientId="client-1"
      clientName="Jane" nudgeSuccess={false} onOpenMessages={noop} onOpenNudge={noop} onOpenMacrosReview={noop}
      onOpenWorkoutBuilder={noop} onOpenPayments={onOpenPayments} colors={colors} styles={makeStyles(colors)} />
  );
  const ACTIONS = ["Open messages", "Send nudge notification", "Review client macros", "Open workout builder"];

  it("Summary keeps its four actions and adds Payments only when passed, never for a sub-coach", async () => {
    await render(tab());
    for (const a of ACTIONS) expect(screen.getByLabelText(a)).toBeTruthy();
    expect(screen.queryByTestId("summary-tab-payments-pill")).toBeNull();
    await screen.unmount();
    const onOpen = jest.fn();
    await render(tab(onOpen));
    for (const a of ACTIONS) expect(screen.getByLabelText(a)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("summary-tab-payments-pill"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await screen.unmount();
    mockRole = "sub_coach";
    await render(tab(onOpen));
    expect(screen.queryByTestId("summary-tab-payments-pill")).toBeNull();
    await screen.unmount();
    mockRole = "head_coach";
    noteHeadCoachHandlesMoney(true);
    await render(tab(onOpen));
    expect(screen.queryByTestId("summary-tab-payments-pill")).toBeNull();
    await screen.unmount();
    noteHeadCoachHandlesMoney(false);
  });

  it("the client page passes Payments only while coach_payment_actions is on; the route is registered once", () => {
    const src = (...p: string[]) => fs.readFileSync(path.resolve(__dirname, "..", "..", "..", ...p), "utf8");
    expect(src("screens", "coach", "ClientDetailScreen.tsx")).toMatch(
      /onOpenPayments=\{\s*serverFlags\.flags\.coach_payment_actions\s*\?\s*\(\) => navigation\.navigate\('ClientPayments', \{ clientId, clientName: route\.params\.clientName \}\)\s*:\s*undefined/,
    );
    const nav = src("navigation", "CoachNavigator.tsx");
    expect(nav.match(/name="ClientPayments"/g)).toHaveLength(1);
    const stack = nav.slice(nav.indexOf("function ClientsStackNavigator"));
    expect(stack.slice(0, stack.indexOf("</ClientsStack.Navigator>"))).toMatch(/<ClientsStack\.Screen name="ClientPayments" component=\{ClientPaymentsScreen\} \/>/);
  });
});
