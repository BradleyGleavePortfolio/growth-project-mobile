/**
 * S-COACH-3 (agent 113) — truthful Connect status copy. Stripe's charges and
 * payouts are separate switches; each state's copy says exactly what works
 * today. The restricted / pending cases failed at 83ee0e46 ("Send these to
 * Stripe to start taking payments" while clients could already pay, and no
 * mention that payouts were paused).
 */
import { connectCopy } from "../../../../lib/coachSetup/connectCopy";
import type { ConnectView } from "../../../../api/coachSetupApi";

const view = (over: Partial<ConnectView>): ConnectView => ({
  state: "restricted",
  accountId: "acct_1",
  chargesEnabled: false,
  payoutsEnabled: false,
  detailsSubmitted: true,
  actionRequired: true,
  currentlyDue: ["external_account"],
  pastDue: [],
  eventuallyDue: [],
  pendingVerification: [],
  deadline: null,
  disabledReason: null,
  refreshed: true,
  ...over,
});

describe("connectCopy is truthful for every Stripe switch combination", () => {
  it("restricted, charges on, payouts off: payouts are paused, clients can still pay", () => {
    const c = connectCopy(view({ chargesEnabled: true }));
    expect(c.title).toBe("Stripe has paused your payouts");
    expect(c.body).toMatch(/^Clients can still pay you\./);
    expect(c.action).toBe("Update details with Stripe");
    expect(c.due).toEqual(["Bank account for payouts"]);
  });

  it("restricted, charges off, payouts on: new payments are paused, earned money still pays out", () => {
    const c = connectCopy(view({ payoutsEnabled: true }));
    expect(c.title).toBe("Stripe has paused new payments");
    expect(c.body).toMatch(/Clients cannot pay you/);
    expect(c.body).toMatch(/still pays out/);
  });

  it("restricted, both off: says both, with the deadline", () => {
    const c = connectCopy(view({ deadline: "2026-11-01T00:00:00Z" }));
    expect(c.body).toMatch(/Clients cannot pay you and payouts are paused/);
    expect(c.body).toMatch(/by .*2026/);
  });

  it("pending verification never claims payouts work, and says when clients can already pay", () => {
    const charging = connectCopy(
      view({
        state: "pending_verification",
        chargesEnabled: true,
        actionRequired: false,
      }),
    );
    expect(charging.body).toMatch(/^Clients can pay you now\./);
    expect(charging.body).toMatch(/payouts to your bank once it has finished/);
    const waiting = connectCopy(
      view({ state: "pending_verification", actionRequired: false }),
    );
    expect(waiting.body).toMatch(
      /Clients can pay you once Stripe has finished/,
    );
  });

  it("no copy speaks as we, none has an exclamation mark", () => {
    for (const state of [
      "not_started",
      "details_needed",
      "pending_verification",
      "restricted",
      "active",
      "deauthorized",
    ] as const) {
      for (const charges of [true, false])
        for (const payouts of [true, false]) {
          const c = connectCopy(
            view({ state, chargesEnabled: charges, payoutsEnabled: payouts }),
          );
          expect(`${c.title} ${c.body}`).not.toMatch(
            /\b(we|We|us|our|Our)\b|!/,
          );
        }
    }
  });
});
