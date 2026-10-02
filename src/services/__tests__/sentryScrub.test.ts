/**
 * B-327-6 — no download token or signed URL survives the telemetry boundary.
 */
import { scrubEvent, scrubText } from "../sentryScrub";

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLWEiLCJlaWQiOiJlMSJ9.c2lnbmF0dXJlLXZhbHVlLWhlcmU";
const URL = `https://api.example.test/api/v1/me/data-export/download?token=${JWT}`;

describe("sentryScrub", () => {
  it.each([
    ["iOS Linking rejection", `Unable to open URL: ${URL}`],
    [
      "Android Linking rejection",
      `Could not open URL '${URL}': No Activity found to handle Intent`,
    ],
    ["a bare token query", "GET /x?token=abc.def.ghi&y=1"],
    [
      "a signed storage URL",
      "https://p.supabase.co/storage/v1/object/sign/data-exports/e1.json?token=zzz",
    ],
  ])("scrubs %s", (_label, text) => {
    const out = scrubText(text);
    expect(out).not.toContain(JWT);
    expect(out).not.toMatch(/token=(?!\[redacted\])/);
  });

  it("scrubs message, exception values, extras, contexts, breadcrumbs and request, keeping the reference", () => {
    const event = {
      message: `Unable to open URL: ${URL}`,
      exception: {
        values: [{ type: "Error", value: `Unable to open URL: ${URL}` }],
      },
      extra: {
        url: URL,
        nested: { cause: { message: URL } },
        support_reference: "ref-123",
      },
      contexts: { link: { href: URL } },
      tags: { last: URL },
      breadcrumbs: [
        { category: "console", message: `opening ${URL}`, data: { url: URL } },
      ],
      request: { url: URL, query_string: `token=${JWT}` },
    };
    const out = JSON.stringify(scrubEvent(event));
    expect(out).not.toContain(JWT);
    expect(out).not.toContain("token=eyJ");
    expect(out).toContain("ref-123");
  });

  it("survives cycles", () => {
    const a: Record<string, unknown> = { msg: URL };
    a.self = a;
    expect(() => scrubEvent(a)).not.toThrow();
    expect(a.msg).not.toContain(JWT);
  });
});
