/**
 * S-MWB — Programs failure copy: known codes are specific and recoverable;
 * unknown failures carry a reference, a support path and a Sentry event.
 */
const mockCaptureError = jest.fn();
jest.mock("../../services/sentry", () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

import {
  bulkResultCopy,
  describeProgramFailure,
  isOutcomeUnknown,
} from "../programErrors";

function httpError(status: number, data: Record<string, unknown>) {
  return { response: { status, data, headers: {} } };
}

beforeEach(() => mockCaptureError.mockClear());

describe("describeProgramFailure", () => {
  it("maps a known backend code to specific copy with no reference and no Sentry noise", () => {
    const f = describeProgramFailure(
      httpError(409, {
        code: "program_in_package",
        message: "x",
        request_id: "req-1",
      }),
      "archive the program",
    );
    expect(f.code).toBe("program_in_package");
    expect(f.message).toMatch(/Remove it from the package first/);
    expect(f.reference).toBeNull();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("a stale version asks the screen to reload", () => {
    const f = describeProgramFailure(
      httpError(409, { code: "program_version_conflict" }),
      "save",
    );
    expect(f.reload).toBe(true);
  });

  it("flag-off backend (programs_unavailable) offers support", () => {
    const f = describeProgramFailure(
      httpError(404, { code: "programs_unavailable" }),
      "load your programs",
    );
    expect(f.support).toBe(true);
    expect(f.message).toMatch(/not switched on/);
  });

  it("an unknown 500 shows the server request id as reference, a support path, and reports to Sentry", () => {
    const f = describeProgramFailure(
      httpError(500, {
        code: "internal_error",
        request_id: "ab12cd34-0000-4000-8000-000000000000",
      }),
      "assign the program",
    );
    expect(f.reference).toBe("AB12CD34");
    expect(f.support).toBe(true);
    expect(f.message).toMatch(
      /Could not assign the program because of a problem on the server/,
    );
    expect(f.message).toMatch(/AB12CD34/);
    expect(f.message).not.toMatch(/Something went wrong/);
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        area: "programs",
        reference: "ab12cd34-0000-4000-8000-000000000000",
      }),
    );
  });

  it("a network failure says the server was unreachable and still carries a reference", () => {
    const f = describeProgramFailure(
      new Error("Network Error"),
      "load your programs",
    );
    expect(f.message).toMatch(/could not reach the server/);
    expect(f.reference).toMatch(/^[A-Z0-9]{1,8}$/);
  });

  it("a validation 400 surfaces the server sentence and keeps the reference + support path", () => {
    const f = describeProgramFailure(
      httpError(400, {
        code: "bad_request",
        message: "weeks must not be greater than 52",
        request_id: "cd34ef56-0000-4000-8000-000000000000",
      }),
      "create the program",
    );
    expect(f.message).toBe(
      "Could not create the program: weeks must not be greater than 52. If this keeps happening, contact support and quote reference CD34EF56.",
    );
    expect(f.reference).toBe("CD34EF56");
    expect(f.support).toBe(true);
    expect(mockCaptureError).toHaveBeenCalled();
  });

  it("a Nest DTO validation list is joined into one sentence", () => {
    const f = describeProgramFailure(
      httpError(400, {
        message: ["weeks must be an integer", "name should not be empty"],
      }),
      "create the program",
    );
    expect(f.message).toMatch(
      /^Could not create the program: weeks must be an integer; name should not be empty\. If this keeps happening/,
    );
    expect(f.support).toBe(true);
  });

  it("B-328-3: a 401 asks the coach to sign in again, not a server retry", () => {
    const f = describeProgramFailure(
      httpError(401, { code: "unauthorized" }),
      "save",
    );
    expect(f.message).toMatch(/session has ended\. Sign in again/);
    expect(f.message).not.toMatch(/problem on our side/);
    expect(f.recovery).toBe("sign_in");
  });

  it("B-328-3: a 429 says to wait, a bare 403 names the access problem with a support path", () => {
    const limited = describeProgramFailure(
      httpError(429, {}),
      "assign the program",
    );
    expect(limited.message).toMatch(/Wait a minute, then retry/);
    expect(limited.recovery).toBe("wait");
    const denied = describeProgramFailure(
      httpError(403, { request_id: "ef56ab12-0000-4000-8000-000000000000" }),
      "open this program",
    );
    expect(denied.message).toMatch(/does not have access/);
    expect(denied.message).toMatch(/EF56AB12/);
    expect(denied.support).toBe(true);
  });
});

describe("isOutcomeUnknown", () => {
  it("no response, a timeout or a 5xx may have applied; a 4xx answer did not", () => {
    expect(isOutcomeUnknown(new Error("Network Error"))).toBe(true);
    expect(isOutcomeUnknown(httpError(503, {}))).toBe(true);
    expect(isOutcomeUnknown(httpError(408, {}))).toBe(true);
    expect(isOutcomeUnknown(httpError(400, {}))).toBe(false);
    expect(
      isOutcomeUnknown(httpError(409, { code: "program_version_conflict" })),
    ).toBe(false);
  });
});

describe("bulkResultCopy", () => {
  it("known per-client codes win; otherwise the server message; never empty", () => {
    expect(bulkResultCopy("not_your_client", "raw")).toMatch(
      /Not one of your clients/,
    );
    expect(
      bulkResultCopy("assign_failed", "Could not assign (reference 1234)."),
    ).toBe("Could not assign (reference 1234).");
    expect(bulkResultCopy(undefined, undefined)).toMatch(/Retry this client/);
  });
});

describe("S-MWB-3 C-328-7: consultation-set codes and unmapped refusals", () => {
  it.each(["program_in_clinic_set", "program_in_clinic_set_needs_a_day"])(
    "%s has specific copy with the support path and no reference",
    (code) => {
      const f = describeProgramFailure(
        httpError(409, { code, message: "server copy", request_id: "r-1" }),
        "archive the program",
      );
      expect(f.code).toBe(code);
      expect(f.message).toMatch(/consultation/);
      expect(f.message).toMatch(/contact support \(Settings, Help\)/);
      expect(f.message).not.toBe("server copy");
      expect(f.support).toBe(true);
      expect(f.reference).toBeNull();
      expect(mockCaptureError).not.toHaveBeenCalled();
    },
  );

  it.each([409, 422])(
    "an unmapped %i code with a server message shows that message and a reference",
    (status) => {
      const f = describeProgramFailure(
        httpError(status, {
          code: "brand_new_rule",
          message: "This program is locked while a delivery runs.",
          request_id: "aa11bb22-0000-4000-8000-000000000000",
        }),
        "clear the day",
      );
      expect(f.message).toBe(
        "Could not clear the day: This program is locked while a delivery runs. If this keeps happening, contact support and quote reference AA11BB22.",
      );
      expect(f.message).not.toMatch(/problem on/);
      expect(f.reference).toBe("AA11BB22");
      expect(f.support).toBe(true);
    },
  );

  it("an unmapped 404 says it is gone and offers reload, not a server problem", () => {
    const f = describeProgramFailure(
      httpError(404, { request_id: "cc33dd44-0000-4000-8000-000000000000" }),
      "open this program",
    );
    expect(f.message).toMatch(/no longer exists or is not shared with you/);
    expect(f.message).toMatch(/CC33DD44/);
    expect(f.reload).toBe(true);
  });

  it("no Programs copy uses first person", () => {
    for (const code of [
      "program_version_conflict",
      "program_in_clinic_set",
      "program_in_clinic_set_needs_a_day",
    ]) {
      const f = describeProgramFailure(httpError(409, { code }), "save");
      expect(f.message).not.toMatch(/\b(we|us|our)\b/i);
    }
    const unknown = describeProgramFailure(httpError(500, {}), "save");
    expect(unknown.message).not.toMatch(/\b(we|us|our)\b/i);
  });
});
