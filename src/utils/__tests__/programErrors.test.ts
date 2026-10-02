/**
 * S-MWB — Programs failure copy: known codes are specific and recoverable;
 * unknown failures carry a reference, a support path and a Sentry event.
 */
const mockCaptureError = jest.fn();
jest.mock("../../services/sentry", () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

import { bulkResultCopy, describeProgramFailure } from "../programErrors";

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
      /Could not assign the program because of a problem on our side/,
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

  it("a validation 400 surfaces the server sentence", () => {
    const f = describeProgramFailure(
      httpError(400, {
        code: "bad_request",
        message: "weeks must not be greater than 52",
      }),
      "create the program",
    );
    expect(f.message).toBe(
      "Could not create the program: weeks must not be greater than 52",
    );
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
