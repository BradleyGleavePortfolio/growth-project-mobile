/**
 * S-MWB-3 (B-328-6): definite refusal vs unknown outcome for builder undo /
 * redo. Only a definite refusal may say "nothing was undone".
 */
const mockCaptureError = jest.fn();
jest.mock("../../../services/sentry", () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));
jest.mock("../../../services/api", () => ({
  __esModule: true,
  default: { patch: jest.fn(), post: jest.fn(), get: jest.fn() },
}));

import { WorkoutAutosaveApiError } from "../../../api/workoutAutosaveApi";
import {
  describeHistoryFailure,
  describeUnconfirmedHistory,
  isUnknownHistoryOutcome,
} from "../workoutBuilderUndo";

const err = (kind: WorkoutAutosaveApiError["kind"], status: number) =>
  new WorkoutAutosaveApiError(kind, status, "x");

beforeEach(() => mockCaptureError.mockClear());

describe("isUnknownHistoryOutcome", () => {
  it.each([
    ["network", 0],
    ["server", 503],
    ["aborted", 0],
    ["contract", 200],
    ["unknown", -1],
  ] as const)("%s (%i) may have committed", (kind, status) => {
    expect(isUnknownHistoryOutcome(err(kind, status))).toBe(true);
  });

  it.each([
    ["gone", 404],
    ["forbidden", 403],
    ["unauthorized", 401],
    ["conflict", 409],
    ["contract", 400],
    ["unknown", 422],
  ] as const)("%s (%i) is a definite refusal", (kind, status) => {
    expect(isUnknownHistoryOutcome(err(kind, status))).toBe(false);
  });

  it("a non-HTTP error is unknown", () => {
    expect(isUnknownHistoryOutcome(new Error("boom"))).toBe(true);
  });
});

describe("copy", () => {
  it("unconfirmed network copy names the connection and never says nothing was undone", () => {
    const f = describeUnconfirmedHistory(err("network", 0), "undo");
    expect(f.message).toMatch(
      /could not confirm whether the change was undone/,
    );
    expect(f.message).toMatch(/Check your connection, then tap Check again/);
    expect(f.message).not.toMatch(/nothing was undone/);
    expect(f.reference).toBeNull();
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("unconfirmed server copy carries a reference, the support path and a Sentry event", () => {
    const f = describeUnconfirmedHistory(err("server", 503), "redo");
    expect(f.message).toMatch(
      /could not confirm whether the change was redone/,
    );
    expect(f.message).toMatch(
      /contact support \(Settings, Help\) and quote reference [A-Z0-9]{1,8}\./,
    );
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "redo_unconfirmed" }),
    );
  });

  it("a plain 409 is a retryable refusal", () => {
    const f = describeHistoryFailure(err("conflict", 409), "undo");
    expect(f.message).toMatch(/nothing was undone\. Tap Undo again\./);
  });

  it("no history copy uses first person or exclamation marks", () => {
    const all = [
      describeHistoryFailure(err("gone", 404), "undo").message,
      describeHistoryFailure(err("forbidden", 403), "undo").message,
      describeHistoryFailure(err("unauthorized", 401), "undo").message,
      describeHistoryFailure(err("conflict", 409), "undo").message,
      describeHistoryFailure(err("unknown", 422), "undo").message,
      describeUnconfirmedHistory(err("network", 0), "undo").message,
      describeUnconfirmedHistory(err("server", 500), "undo").message,
    ];
    for (const m of all) {
      expect(m).not.toMatch(/\b(we|us|our)\b/i);
      expect(m).not.toMatch(/!/);
    }
  });
});
