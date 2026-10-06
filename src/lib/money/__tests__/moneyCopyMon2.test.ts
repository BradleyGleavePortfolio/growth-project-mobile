/**
 * FIX ROUND (B-MON2-122, agent 122): Sol B-348-1. A pending charge is one no
 * payment has gone through for yet (for example a card-upfront free trial
 * that has not billed). Its label never claims a payment is processing.
 */
import { chargeStateLabel } from "../moneyCopy";
import type { MoneyCharge } from "../../../api/coachMoneyApi";

const charge = (state: MoneyCharge["state"]): MoneyCharge => ({
  id: "ch_trial",
  client: { id: "u_sam", name: "Sam" },
  packageName: "North coaching",
  amountCents: 4900,
  currency: "usd",
  billingType: "recurring",
  billingInterval: "month",
  billingIntervalCount: 1,
  state,
  rawState: state ?? "odd",
  refundedCents: 0,
  chargedBackCents: 0,
  createdAt: "2026-10-01T00:00:00Z",
});

describe("B-348-1: an unpaid free trial is not labelled as a processing payment", () => {
  it("pending reads Not paid yet, never Processing", () => {
    expect(chargeStateLabel(charge("pending"))).toBe("Not paid yet");
    expect(chargeStateLabel(charge("pending"))).not.toMatch(/process/i);
  });

  it("a real paid charge still reads Paid", () => {
    expect(chargeStateLabel(charge("paid"))).toBe("Paid");
  });
});
