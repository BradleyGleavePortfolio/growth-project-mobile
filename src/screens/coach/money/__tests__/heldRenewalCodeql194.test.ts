import { readFileSync } from "fs";
import { join } from "path";

describe("LS-920 CodeQL regression", () => {
  it("constant held-copy assertions do not use the partial regular-expression escaping rejected by CodeQL", () => {
    const assertionSource = readFileSync(
      join(__dirname, "moneyHeldRenewal.test.tsx"),
      "utf8",
    );
    // A literal text assertion avoids turning constant product copy into a
    // regular expression and removes the exact pattern in scan alert 6.
    expect(assertionSource).not.toContain(
      String.raw`new RegExp(HELD_LINE.replace(/\./g, "\\."))`,
    );
  });
});
