/**
 * LS-925 B1: K4V3 Style A, frame 09-client draws this plan on a rounded
 * forest panel. The area GOAL applies even when a held-state frame is absent.
 * Frame: planning/MOCKUP3/K4V3/renders/A/K4V3-A-09-client-390-100.png
 * Section 4 of its index specifies forest #2C4A36 for the plan on screen 9.
 * This witness checks the panel, not a particular component or wrapper.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";

const mockGet = jest.fn();
jest.mock("../../../services/api", () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args), post: jest.fn() },
}));
jest.mock("../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ canGoBack: () => true, goBack: jest.fn(), getParent: () => undefined }),
}));
jest.mock("../../../hooks/useCoachRoleType", () => ({
  useCoachTeamStatus: () => ({ role: "head_coach", hasSubCoaches: false }),
}));

import ClientPaymentsScreen from "../ClientPaymentsScreen";
import { lightTokens } from "../../../theme/tokens";

const route = {
  key: "goal-review",
  name: "ClientPayments" as const,
  params: { clientId: "client-1", clientName: "Jane" },
};

it.each([
  ["held-first", "past_due", "coach_account", false],
  ["held-paid-before", "unpaid", "coach_account", true],
  ["real-decline", "past_due", null, true],
] as const)("K4V3 frame 09: %s plan state belongs inside the rounded forest plan panel", async (id, status, waitingOn, paidBefore) => {
  mockGet.mockResolvedValue({ data: { plans: [{
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
    waiting_on: waitingOn,
    actions: { refund: paidBefore, pause: false, resume: false, cancel: true, restart: false },
    payments: paidBefore ? [{
      charge_id: `ch-${id}`, amount_cents: 14900, refunded_cents: 0,
      refundable_cents: 14900, currency: "usd", paid_at: "2026-09-30T09:00:00.000Z",
      refunds: [],
    }] : [],
  }] } });
  await render(<ClientPaymentsScreen route={route} />);
  const state = await screen.findByTestId(`plan-state-${id}`);
  let node = state.parent;
  let insideGoalPanel = false;
  while (node) {
    const style = StyleSheet.flatten(node.props.style);
    if (style?.backgroundColor === lightTokens.accent && Number(style.borderRadius) >= 16) {
      insideGoalPanel = true;
      break;
    }
    node = node.parent;
  }
  expect(insideGoalPanel).toBe(true);
});
