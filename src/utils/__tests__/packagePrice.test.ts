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
    expect(packagePriceIssue(1000, "one_time", 1000)).toBeNull();
    expect(packagePriceIssue(900, "one_time", 1000)).toBe(PACKAGE_PRICE_HELPER);
  });

  it("asks for a price when the field cannot be read", () => {
    expect(packagePriceIssue(null, "one_time")).toBe(
      "Enter a price, for example 19.99, or 0 to make it free.",
    );
  });
});
