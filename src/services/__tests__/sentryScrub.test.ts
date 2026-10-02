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
    const out = scrubEvent(a);
    expect(out.msg).not.toContain(JWT);
    expect(out.self).toBe("[circular]");
  });

  // C-327-2: console breadcrumbs carry the app's live objects by reference;
  // the scrub must never rewrite them.
  it("never writes to the caller's objects (console breadcrumb arguments)", () => {
    const session = { access_token: JWT, user: { id: "u1" } };
    const shareUrl = "https://app.example.test/join?code=ABC123";
    const payload = { session, shareUrl };
    const args: unknown[] = ["state", payload];
    const crumb = { category: "console", data: { arguments: args } };
    const out = scrubEvent(crumb);
    expect(JSON.stringify(out)).not.toContain(JWT);
    expect(JSON.stringify(out)).not.toContain("ABC123");
    expect(session.access_token).toBe(JWT);
    expect(payload.shareUrl).toBe(shareUrl);
    expect(crumb.data.arguments).toBe(args);
  });

  it("copies Errors with scrubbed text and keeps shared siblings", () => {
    const shared = { link: URL };
    const out = scrubEvent({
      a: shared,
      b: shared,
      err: new Error(`failed ${URL}`),
    });
    expect(JSON.stringify(out)).not.toContain(JWT);
    expect(out.b).toEqual(out.a);
    expect(shared.link).toBe(URL);
  });

  it("bounds depth and breadth without forwarding unscrubbed branches", () => {
    let deep: Record<string, unknown> = { msg: URL };
    for (let i = 0; i < 12; i += 1) deep = { next: deep };
    expect(JSON.stringify(scrubEvent(deep))).not.toContain(JWT);
    const wide = Array.from({ length: 500 }, () => URL);
    const outWide = scrubEvent({ wide }).wide;
    expect(outWide).toHaveLength(200);
  });
});
