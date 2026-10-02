import {
  PACKAGE_FREE_ONE_TIME_MESSAGE,
  PACKAGE_PRICE_HELPER,
  PAID_PACKAGE_MIN_CENTS,
  packagePriceIssue,
} from "../packagePrice";

describe("packagePriceIssue (S-FEE $19.99 minimum or free)", () => {
  it("allows $19.99 and up on every billing option", () => {
    expect(PAID_PACKAGE_MIN_CENTS).toBe(1999);
    expect(packagePriceIssue(1999, "one_time")).toBeNull();
    expect(packagePriceIssue(4900, "monthly")).toBeNull();
    expect(packagePriceIssue(100000, "yearly")).toBeNull();
  });

  it("rejects a paid price under $19.99 with the owner copy", () => {
    expect(packagePriceIssue(1998, "one_time")).toBe(PACKAGE_PRICE_HELPER);
    expect(packagePriceIssue(50, "monthly")).toBe(
      "Paid packages start at $19.99, or make it free.",
    );
  });

  it("allows $0 only as a one-time free package", () => {
    expect(packagePriceIssue(0, "one_time")).toBeNull();
    expect(packagePriceIssue(0, "monthly")).toBe(PACKAGE_FREE_ONE_TIME_MESSAGE);
  });

  it("keeps an unchanged price saved before the rule editable", () => {
    const saved = { priceCents: 1000, billingInterval: "one_time" as const };
    expect(packagePriceIssue(1000, "one_time", saved)).toBeNull();
    expect(packagePriceIssue(900, "one_time", saved)).toBe(PACKAGE_PRICE_HELPER);
  });

  it("C-321-1: a new billing interval at the old price is a new price (floor applies)", () => {
    const saved = { priceCents: 1000, billingInterval: "monthly" as const };
    expect(packagePriceIssue(1000, "monthly", saved)).toBeNull();
    expect(packagePriceIssue(1000, "yearly", saved)).toBe(PACKAGE_PRICE_HELPER);
    expect(packagePriceIssue(1000, "one_time", saved)).toBe(PACKAGE_PRICE_HELPER);
    expect(packagePriceIssue(1999, "yearly", saved)).toBeNull();
  });

  it("a new package has no grandfathered price", () => {
    expect(packagePriceIssue(1000, "one_time", null)).toBe(PACKAGE_PRICE_HELPER);
  });

  it("asks for a price when the field cannot be read", () => {
    expect(packagePriceIssue(null, "one_time")).toBe(
      "Enter a price, for example 19.99, or 0 to make it free.",
    );
  });
});
