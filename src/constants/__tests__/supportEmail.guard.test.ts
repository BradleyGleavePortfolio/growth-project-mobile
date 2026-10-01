/**
 * S-ERRORS (owner ruling 2026-10-01 14:19 PDT): one support email everywhere.
 *
 * SUPPORT_EMAIL in src/constants/support.ts is the only support contact the
 * app may show. This guard fails the build if any other email address appears
 * in shipped source (src/, app config), unless it is a reserved placeholder
 * domain or listed in ALLOWED with the reason it is not a support contact.
 */
import * as fs from "fs";
import * as path from "path";
import { SUPPORT_EMAIL, supportMailto } from "../support";

const OWNER_SUPPORT_EMAIL = "Bradleyapple1031@gmail.com";

// Not support contacts. Every entry needs a reason; an entry that no longer
// appears in source fails the stale-entry test, so the list cannot drift.
const ALLOWED: Record<string, string> = {
  "you@email.com":
    "Email field placeholder text (LoginScreen, CreateAccountScreen); shows the format only.",
  "your@email.com":
    "Email field placeholder text (ForgotPasswordScreen); shows the format only.",
  "demo@trygrowthproject.com":
    "Store-screenshot fixture account (src/screenshots); never offered as a contact.",
};

// RFC 2606 / RFC 6761 reserved names cannot receive mail: test data and placeholders.
const RESERVED_DOMAIN =
  /(^|\.)(example\.(com|org|net)|invalid|test|example|localhost)$/i;

// Retired support addresses, named so a regression reads clearly in CI.
const RETIRED = [
  "hello@thegrowthproject.app",
  "hello@trygrowthproject.com",
  "Bradley@Bradleytgpcoaching.com",
];

const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC = path.join(ROOT, "src");
const SCANNED_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".md"]);
const ROOT_CONFIG = ["app.json", "app.config.ts", "app.config.js", "eas.json"];

function isTestPath(file: string): boolean {
  const parts = file.split(path.sep);
  return (
    /\.(test|spec)\.[jt]sx?$/.test(file) ||
    parts.includes("__tests__") ||
    parts.includes("__mocks__")
  );
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SCANNED_EXT.has(path.extname(entry.name)) && !isTestPath(full))
      out.push(full);
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  address: string;
}

function disallowedAddresses(text: string, file = "<inline>"): Hit[] {
  const hits: Hit[] = [];
  text.split("\n").forEach((lineText, i) => {
    for (const m of lineText.matchAll(EMAIL)) {
      const address = m[0].replace(/\.+$/, "");
      const domain = address.slice(address.lastIndexOf("@") + 1);
      if (address.toLowerCase() === SUPPORT_EMAIL.toLowerCase()) continue;
      if (RESERVED_DOMAIN.test(domain)) continue;
      if (
        Object.keys(ALLOWED).some(
          (a) => a.toLowerCase() === address.toLowerCase(),
        )
      )
        continue;
      hits.push({ file, line: i + 1, address });
    }
  });
  return hits;
}

describe("support email guard (S-ERRORS, one support email)", () => {
  const files = [
    ...walk(SRC),
    ...ROOT_CONFIG.map((f) => path.join(ROOT, f)).filter((f) =>
      fs.existsSync(f),
    ),
  ];
  const corpus = files.map((f) => ({
    f: path.relative(ROOT, f),
    text: fs.readFileSync(f, "utf8"),
  }));

  it("SUPPORT_EMAIL is the owner-ruled address", () => {
    expect(SUPPORT_EMAIL).toBe(OWNER_SUPPORT_EMAIL);
  });

  it("supportMailto builds a mailto to SUPPORT_EMAIL with an encoded subject", () => {
    expect(supportMailto()).toBe(`mailto:${OWNER_SUPPORT_EMAIL}`);
    expect(supportMailto("Support request")).toBe(
      `mailto:${OWNER_SUPPORT_EMAIL}?subject=Support%20request`,
    );
    expect(supportMailto("Request access to The Growth Project")).toBe(
      `mailto:${OWNER_SUPPORT_EMAIL}?subject=Request%20access%20to%20The%20Growth%20Project`,
    );
  });

  it("scans a real source tree (the guard cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(300);
    expect(
      corpus.some(
        ({ f }) =>
          f ===
          path.join("src", "screens", "support", "SupportInboxScreen.tsx"),
      ),
    ).toBe(true);
  });

  it("no other email address appears in shipped source unless reserved or allowlisted with a reason", () => {
    expect(
      corpus.flatMap(({ f, text }) => disallowedAddresses(text, f)),
    ).toEqual([]);
  });

  it("no retired support address remains in shipped source", () => {
    const found = corpus.flatMap(({ f, text }) =>
      RETIRED.filter((r) => text.toLowerCase().includes(r.toLowerCase())).map(
        (r) => `${f}: ${r}`,
      ),
    );
    expect(found).toEqual([]);
  });

  it("every mailto in shipped source goes to SUPPORT_EMAIL (literal or via the constant)", () => {
    const bad: string[] = [];
    for (const { f, text } of corpus) {
      for (const m of text.matchAll(/mailto:([^?'"`\s)]*)/g)) {
        const target = m[1];
        if (target === "" || target === "${SUPPORT_EMAIL}") continue;
        if (target.toLowerCase() === SUPPORT_EMAIL.toLowerCase()) continue;
        bad.push(`${f}: mailto:${target}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("every allowlist entry is still used (no stale exceptions)", () => {
    const all = corpus.map(({ text }) => text.toLowerCase()).join("\n");
    expect(
      Object.keys(ALLOWED).filter((a) => !all.includes(a.toLowerCase())),
    ).toEqual([]);
  });

  it("the detector flags a planted support address and a retired one (negative control)", () => {
    expect(disallowedAddresses("email support@tgp-help.com today")).toEqual([
      { file: "<inline>", line: 1, address: "support@tgp-help.com" },
    ]);
    expect(
      disallowedAddresses("const a = 'hello@thegrowthproject.app';"),
    ).toHaveLength(1);
    expect(
      disallowedAddresses(`mailto:${OWNER_SUPPORT_EMAIL.toLowerCase()}`),
    ).toEqual([]);
    expect(disallowedAddresses("jane@example.com")).toEqual([]);
  });
});
