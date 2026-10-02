/**
 * Owner rule 13:34 (no vague errors) for deletion, export and help links,
 * plus C-313-6 (an expired session is not "wrong password").
 */
jest.mock("../../../services/sentry", () => ({ captureError: jest.fn() }));
import { captureError } from "../../../services/sentry";
import {
  DELETION_SUPPORT_EMAIL,
  SESSION_ENDED_COPY,
  deletionErrorCopy,
  errorReference,
  isSessionEnded401,
} from "../deletionErrors";

const http = (
  status: number,
  data: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) => ({
  response: { status, data, headers },
});

describe("deletionErrorCopy", () => {
  beforeEach(() => jest.mocked(captureError).mockClear());

  it("network: says the server was not reached and to check the connection", () => {
    const copy = deletionErrorCopy(new Error("Network Error"), "schedule", "t");
    expect(copy).toBe(
      "We could not reach the server to schedule your account deletion. Check your connection, then try again.",
    );
    expect(captureError).not.toHaveBeenCalled();
  });

  it("429, 409 on cancel and the guard 401 get specific copy", () => {
    expect(deletionErrorCopy(http(429), "confirm", "t")).toMatch(
      /^Too many attempts/,
    );
    expect(deletionErrorCopy(http(409), "cancel", "t")).toBe(
      "Your deletion is already being finished, so it can no longer be cancelled.",
    );
    expect(
      deletionErrorCopy(
        http(401, { code: "USER_NOT_FOUND", message: "User not found" }),
        "check",
        "t",
      ),
    ).toBe(SESSION_ENDED_COPY);
  });

  it("schedule with a rejected or reused recent-auth proof asks to confirm again", () => {
    const expired =
      "The check that it is you has expired. Confirm it is you again, then send the request.";
    expect(
      deletionErrorCopy(
        http(401, { message: "Recent authentication required" }),
        "schedule",
        "t",
      ),
    ).toBe(expired);
    expect(
      deletionErrorCopy(
        http(403, { error: "RECENT_AUTH_TOKEN_ALREADY_USED" }),
        "schedule",
        "t",
      ),
    ).toBe(expired);
  });

  it("unknown server error: reference, support address, Sentry", () => {
    const copy = deletionErrorCopy(
      http(
        500,
        { message: "boom" },
        { "x-request-id": "3f0c7a52-6a51-4c55-9a0e-0c9d6f1b2a10" },
      ),
      "export",
      "trust_center.export",
    );
    expect(copy).toBe(
      `We could not start your data export because of a problem on our side. Reference: 3f0c7a52. Try again in a few minutes, or write to ${DELETION_SUPPORT_EMAIL} and mention the reference.`,
    );
    expect(captureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        where: "trust_center.export",
        status: 500,
        reference: "3f0c7a52",
      }),
    );
  });

  it("never uses the banned generic phrases", () => {
    for (const err of [
      new Error("x"),
      http(500),
      http(503),
      http(418),
      http(429),
      http(409),
    ]) {
      const copy = deletionErrorCopy(err, "cancel", "t");
      expect(copy).not.toMatch(/something went wrong/i);
      expect(copy).not.toMatch(/^please try again\.?$/i);
      expect(copy).not.toContain("!");
    }
  });
});

describe("C-313-6 guard 401 versus credential 401", () => {
  it("recognises the guard 401s", () => {
    expect(
      isSessionEnded401(http(401, { message: "Invalid or expired token" })),
    ).toBe(true);
    expect(
      isSessionEnded401(
        http(401, { message: "No authentication token provided" }),
      ),
    ).toBe(true);
    expect(isSessionEnded401(http(401, { code: "USER_NOT_FOUND" }))).toBe(true);
  });
  it("a rejected password is not a session end", () => {
    expect(
      isSessionEnded401(http(401, { message: "Invalid credentials" })),
    ).toBe(false);
    expect(
      isSessionEnded401(http(403, { message: "Invalid or expired token" })),
    ).toBe(false);
  });
  it("reads the reference from the body or headers", () => {
    expect(errorReference(http(500, { request_id: "abcd1234ef" }))).toBe(
      "abcd1234",
    );
    expect(errorReference(http(500))).toBeNull();
  });
});
