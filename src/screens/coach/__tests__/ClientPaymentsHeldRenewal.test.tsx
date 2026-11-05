/**
 * HELD-RENEWAL-M2 (LS-1216 B1, LO-1216 C1): a renewal TGP holds on the
 * coach's own Stripe account is not the client's failed payment. b#1216
 * sends such a plan on GET /v1/coach/clients/:id/payments with its row's
 * status (past_due or unpaid, so a cancel still ends it now) and
 * waiting_on: "coach_account". The plan card says the approved words
 * "Waiting on your Stripe account" (m#920 W1) instead of "The latest payment
 * did not go through"; a real decline (waiting_on null) and today's server
 * (no waiting_on field) keep the failure sentence. The fixtures below are
 * b#1216's own list result shapes (planView), 4 held rows and 2 real
 * declines, as in LS-1216's witness.
 */
import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../../services/api", () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock("../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("../../../ui/haptics/haptics.service", () => ({
  HapticService: { mediumImpact: jest.fn(), warning: jest.fn(), success: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../utils/idempotency", () => ({ generateIdempotencyKey: () => "key-1" }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ canGoBack: () => true, goBack: jest.fn(), getParent: () => undefined }),
}));
jest.mock("../../../hooks/useCoachRoleType", () => ({
  useCoachTeamStatus: () => ({ role: "head_coach", hasSubCoaches: false }),
}));

import ClientPaymentsScreen from "../ClientPaymentsScreen";
import { toPlan } from "../../../api/coachClientPaymentsApi";
import { changeDone, confirmCopy, planStateLine } from "../../../lib/money/clientPaymentsCopy";

const FAILURE = "The latest payment did not go through, so billing cannot be paused. Cancel plan ends the plan now.";
const HELD = "Waiting on your Stripe account.";
const CANCEL_NOW = "The plan ends now and unpaid invoices are voided, so nothing more is charged. Jane's access to Monthly coaching ends.";

/** b#1216 planView for a live recurring plan whose renewal failed or is held. */
function b1216Plan(status: "past_due" | "unpaid", held: boolean, paidBefore: boolean, id: string) {
  const payments = paidBefore
    ? [{
      charge_id: `ch-${id}`, amount_cents: 14900, refunded_cents: 0, refundable_cents: 14900,
      currency: "usd", paid_at: "2026-09-30T09:00:00.000Z", refunds: [],
    }]
    : [];
  return {
    purchase_id: id,
    package_name: "Monthly coaching",
    billing_type: "recurring",
    status,
    amount_cents: 14900,
    currency: "usd",
    created_at: "2026-09-30T09:00:00.000Z",
    current_period_end: "2026-11-30T09:00:00.000Z",
    access_expires_at: null,
    cancel_at_period_end: false,
    entitlement_active: true,
    billing: "running",
    waiting_on: held ? "coach_account" : null,
    actions: { refund: paidBefore, pause: false, resume: false, cancel: true, restart: false },
    payments,
  };
}

const HELD_ROWS = [
  ["past_due, first renewal", b1216Plan("past_due", true, false, "held-pd-first")],
  ["past_due, paid before", b1216Plan("past_due", true, true, "held-pd-paid")],
  ["unpaid, first renewal", b1216Plan("unpaid", true, false, "held-un-first")],
  ["unpaid, paid before", b1216Plan("unpaid", true, true, "held-un-paid")],
] as const;
const DECLINES = [
  ["past_due, paid before", b1216Plan("past_due", false, true, "decline-pd")],
  ["unpaid, paid before", b1216Plan("unpaid", false, true, "decline-un")],
] as const;
/** Today's production server: the same plan with no waiting_on field at all. */
function todays(status: "past_due" | "unpaid") {
  const { waiting_on: _drop, ...rest } = b1216Plan(status, false, true, `today-${status}`);
  return rest;
}

const route = { key: "k", name: "ClientPayments" as const, params: { clientId: "client-1", clientName: "Jane" } };
async function open(...plans: unknown[]) {
  mockGet.mockResolvedValue({ data: { plans } });
  await render(<ClientPaymentsScreen route={route} />);
  await waitFor(() => expect(screen.getByTestId("client-payments-screen")).toBeTruthy());
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("HELD-RENEWAL-M2: a renewal held on the coach's Stripe account (b#1216 list shapes)", () => {
  it.each(HELD_ROWS)("held (%s) reads as waiting on the coach's Stripe account, not a failed payment", (_label, raw) => {
    const plan = toPlan(raw);
    expect(plan.waitingOn).toBe("coach_account");
    expect(plan.status).toBe(raw.status);
    const line = planStateLine(plan, "Jane");
    expect(line).toBe(HELD);
    expect(line).not.toContain("did not go through");
    // The cancel sheet's words stay true: b#1216 cancels a held renewal now.
    expect(confirmCopy("cancel", plan, "Jane").body).toBe(CANCEL_NOW);
    expect(plan.actions.pause).toBe(false);
    expect(changeDone("cancel", plan, null)).toBe(HELD);
  });

  it.each(DECLINES)("a real decline (%s) keeps the failure sentence", (_label, raw) => {
    const plan = toPlan(raw);
    expect(plan.waitingOn).toBeNull();
    expect(planStateLine(plan, "Jane")).toBe(FAILURE);
    expect(confirmCopy("cancel", plan, "Jane").body).toBe(CANCEL_NOW);
  });

  it.each(["past_due", "unpaid"] as const)("today's server (%s, no waiting_on field) is unchanged", (status) => {
    const plan = toPlan(todays(status));
    expect(plan.waitingOn).toBeNull();
    expect(planStateLine(plan, "Jane")).toBe(FAILURE);
  });

  it("an unknown waiting_on value never claims a hold, and never breaks the list", () => {
    const plan = toPlan({ ...b1216Plan("past_due", false, true, "odd"), waiting_on: "something_else" });
    expect(plan.waitingOn).toBeNull();
    expect(planStateLine(plan, "Jane")).toBe(FAILURE);
  });

  it("a held plan on an active row or a canceled-at-period-end plan keeps its own line", () => {
    const active = toPlan({ ...b1216Plan("past_due", true, true, "a"), status: "active" });
    expect(planStateLine(active, "Jane")).toMatch(/^Billing is on\. The next payment is due /);
    const canceling = toPlan({ ...b1216Plan("past_due", true, true, "c"), cancel_at_period_end: true });
    expect(planStateLine(canceling, "Jane")).toMatch(/^Canceled\. Jane keeps access until /);
  });

  it("the plan card says it on screen: held plans wait on the Stripe account, the real decline still failed", async () => {
    await open(HELD_ROWS[0][1], HELD_ROWS[1][1], DECLINES[0][1]);
    expect((await screen.findByTestId("plan-state-held-pd-first")).props.children).toBe(HELD);
    expect(screen.getByTestId("plan-state-held-pd-paid").props.children).toBe(HELD);
    expect(screen.getByTestId("plan-state-decline-pd").props.children).toBe(FAILURE);
    expect(screen.queryAllByText(FAILURE)).toHaveLength(1);
    // No Pause on a held plan; Cancel still asks first and says it ends now.
    expect(screen.queryByTestId("plan-action-pause-billing-held-pd-paid")).toBeNull();
    await fireEvent.press(screen.getByTestId("plan-action-cancel-plan-held-pd-paid"));
    expect(String(jest.mocked(Alert.alert).mock.calls[0][1])).toBe(CANCEL_NOW);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
