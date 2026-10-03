// B-TRIALS-2 — the editor's trial rule mirrors backend #656 and every coded
// refusal maps to specific copy; the API sends trial_days on create + update.
import {
  isTrialErrorCode,
  parseTrialDays,
  TRIAL_DAY_PRESETS,
  TRIAL_DAYS_MAX,
  trialErrorMessage,
} from "../packageTrial";
import {
  toBackendCreate,
  toBackendUpdate,
  trialDaysChange,
} from "../../api/packagesApi";

describe("parseTrialDays", () => {
  it("empty is no trial; presets and 1..30 are accepted", () => {
    expect(parseTrialDays("", "monthly")).toEqual({ ok: true, days: 0 });
    expect(parseTrialDays("  ", "yearly")).toEqual({ ok: true, days: 0 });
    for (const d of TRIAL_DAY_PRESETS)
      expect(parseTrialDays(String(d), "monthly")).toEqual({
        ok: true,
        days: d,
      });
    expect(parseTrialDays("1", "quarterly")).toEqual({ ok: true, days: 1 });
    expect(TRIAL_DAYS_MAX).toBe(30);
  });

  it("refuses 31, negatives, decimals and words with the rule in words", () => {
    for (const bad of ["31", "365", "-1", "7.5", "seven", "1e1"]) {
      const r = parseTrialDays(bad, "monthly");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/from 1 to 30 days/);
    }
  });

  it("a one-time package never carries a trial", () => {
    expect(parseTrialDays("7", "one_time")).toEqual({ ok: true, days: 0 });
  });
});

describe("trial refusal copy", () => {
  it("knows every backend trial code and prefers the server message", () => {
    expect(isTrialErrorCode("PACKAGE_TRIAL_DAYS_OUT_OF_RANGE")).toBe(true);
    expect(isTrialErrorCode("PACKAGE_TRIAL_REQUIRES_RECURRING")).toBe(true);
    expect(isTrialErrorCode("PACKAGE_TRIAL_NOT_ON_FREE")).toBe(true);
    expect(isTrialErrorCode("PACKAGE_PRICING_LOCKED")).toBe(false);
    expect(isTrialErrorCode(undefined)).toBe(false);
    expect(
      trialErrorMessage("PACKAGE_TRIAL_NOT_ON_FREE", "Server says this."),
    ).toBe("Server says this.");
    expect(trialErrorMessage("PACKAGE_TRIAL_NOT_ON_FREE", null)).toMatch(
      /Set a price, or remove the trial/,
    );
    expect(trialErrorMessage("PACKAGE_TRIAL_REQUIRES_RECURRING", "")).toMatch(
      /plans that renew/,
    );
  });

  it("copy has no exclamation marks, emojis or first person", () => {
    for (const code of [
      "PACKAGE_TRIAL_DAYS_OUT_OF_RANGE",
      "PACKAGE_TRIAL_REQUIRES_RECURRING",
      "PACKAGE_TRIAL_NOT_ON_FREE",
    ] as const) {
      const text = trialErrorMessage(code, null);
      expect(text).not.toMatch(/!/);
      expect(text).not.toMatch(/\b(we|us|our)\b/i);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("packagesApi sends trial_days (backend #656 DTOs accept it)", () => {
  it("create: renewing plan carries the days; no trial and one-time omit the field (C-338-3)", () => {
    expect(
      toBackendCreate({
        title: "A",
        priceCents: 4900,
        billingInterval: "monthly",
        trialDays: 7,
      }),
    ).toMatchObject({ billing_type: "recurring", trial_days: 7 });
    expect(
      toBackendCreate({
        title: "A",
        priceCents: 4900,
        billingInterval: "monthly",
        trialDays: null,
      }),
    ).not.toHaveProperty("trial_days");
    expect(
      toBackendCreate({
        title: "A",
        priceCents: 4900,
        billingInterval: "monthly",
        trialDays: 0,
      }),
    ).not.toHaveProperty("trial_days");
    const oneTime = toBackendCreate({
      title: "A",
      priceCents: 4900,
      billingInterval: "one_time",
      trialDays: 7,
    });
    expect(oneTime).toMatchObject({ billing_type: "one_time" });
    expect(oneTime).not.toHaveProperty("trial_days");
  });

  it("edit: trial_days goes on the wire only when the trial changed (C-338-3)", () => {
    const monthly = "monthly" as const;
    expect(
      trialDaysChange(
        { billingInterval: monthly, trialDays: 7 },
        { billingInterval: monthly, trialDays: 7 },
      ),
    ).toBeUndefined();
    expect(
      trialDaysChange(
        { billingInterval: monthly, trialDays: null },
        { billingInterval: monthly, trialDays: 0 },
      ),
    ).toBeUndefined();
    expect(
      trialDaysChange(
        { billingInterval: monthly, trialDays: 14 },
        { billingInterval: monthly, trialDays: 0 },
      ),
    ).toBe(0);
    expect(
      trialDaysChange(
        { billingInterval: monthly, trialDays: null },
        { billingInterval: monthly, trialDays: 7 },
      ),
    ).toBe(7);
  });

  it("update: sends trial_days only when the editor provided it; 0 clears", () => {
    expect(toBackendUpdate({ title: "B" })).not.toHaveProperty("trial_days");
    expect(
      toBackendUpdate({ billingInterval: "yearly", trialDays: 14 }),
    ).toEqual({ trial_days: 14 });
    expect(
      toBackendUpdate({ billingInterval: "monthly", trialDays: 0 }),
    ).toEqual({ trial_days: 0 });
  });
});
