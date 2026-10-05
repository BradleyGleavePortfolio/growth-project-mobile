/**
 * S-MWB — programsApi: route contract (paths, Idempotency-Key, bodies) and
 * the pure helpers the Programs screens rely on.
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
const mockGetClients = jest.fn();

jest.mock("../../services/api", () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPut(...a),
    patch: (...a: unknown[]) => mockPatch(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a) },
}));
jest.mock("../../services/sentry", () => ({ captureError: jest.fn() }));

import {
  chunkClientIds,
  indexDays,
  isValidIsoDate,
  nextMonday,
  programsApi,
  RosterIncompleteError,
  toIsoDate,
} from "../programsApi";
import { describeProgramFailure } from "../../utils/programErrors";

beforeEach(() => {
  jest.clearAllMocks();
  const ok = { data: {} };
  mockGet.mockResolvedValue(ok);
  mockPost.mockResolvedValue(ok);
  mockPut.mockResolvedValue(ok);
  mockPatch.mockResolvedValue(ok);
  mockDelete.mockResolvedValue(ok);
});

describe("programsApi routes", () => {
  it("list sends trimmed search, goal and status; drops empty filters", async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [], next_cursor: null, goal_tags: [] },
    });
    await programsApi.list({
      q: "  intro ",
      goal_tag: "Intro",
      status: "active",
    });
    expect(mockGet).toHaveBeenCalledWith("/v1/coach/programs", {
      params: { q: "intro", goal_tag: "Intro", status: "active" },
    });
    await programsApi.list({ q: "   " });
    expect(mockGet).toHaveBeenLastCalledWith("/v1/coach/programs", {
      params: {},
    });
  });

  it("every write carries an Idempotency-Key; assign reuses the caller key", async () => {
    await programsApi.create({ name: "Intro", weeks: 4, days_per_week: 3 });
    const createHeaders = mockPost.mock.calls[0][2].headers;
    expect(typeof createHeaders["Idempotency-Key"]).toBe("string");

    await programsApi.assign(
      "p-1",
      { client_ids: ["a", "b"], start_date: "2026-10-05" },
      "key-1",
    );
    expect(mockPost).toHaveBeenLastCalledWith(
      "/v1/coach/programs/p-1/assign",
      { client_ids: ["a", "b"], start_date: "2026-10-05" },
      { headers: { "Idempotency-Key": "key-1" } },
    );

    await programsApi.setDay(
      "p-1",
      1,
      2,
      { source: "copy_day", from_week_index: 0, from_day_index: 0 },
      "k2",
    );
    expect(mockPut).toHaveBeenLastCalledWith(
      "/v1/coach/programs/p-1/days/1/2",
      { source: "copy_day", from_week_index: 0, from_day_index: 0 },
      { headers: { "Idempotency-Key": "k2" } },
    );

    await programsApi.update("p-1", { name: "X", expected_version: 3 }, "k3");
    expect(mockPatch).toHaveBeenLastCalledWith(
      "/v1/coach/programs/p-1",
      { name: "X", expected_version: 3 },
      { headers: { "Idempotency-Key": "k3" } },
    );

    await programsApi.unassign("p-1", "client/1", "k4");
    expect(mockDelete).toHaveBeenLastCalledWith(
      "/v1/coach/programs/p-1/assignees/client%2F1",
      {
        headers: { "Idempotency-Key": "k4" },
      },
    );
  });

  it("assignees pages with the server cursor and tolerates a backend without one", async () => {
    mockGet.mockResolvedValueOnce({
      data: { items: [{ client_id: "c1" }], next_cursor: "cur-2" },
    });
    const first = await programsApi.assignees("p-1");
    expect(mockGet).toHaveBeenLastCalledWith(
      "/v1/coach/programs/p-1/assignees",
      {
        params: undefined,
      },
    );
    expect(first.next_cursor).toBe("cur-2");
    mockGet.mockResolvedValueOnce({ data: { items: [] } });
    const second = await programsApi.assignees("p-1", "cur-2");
    expect(mockGet).toHaveBeenLastCalledWith(
      "/v1/coach/programs/p-1/assignees",
      {
        params: { cursor: "cur-2" },
      },
    );
    expect(second.next_cursor).toBeNull();
  });

  it("promote uses the named-regimes route with the display name", async () => {
    await programsApi.promoteToRegime("p-1", "Intro");
    expect(mockPost).toHaveBeenLastCalledWith(
      "/coach/regimes/p-1/promote-from-program",
      {
        regime_display_name: "Intro",
      },
    );
  });

  it("assignableClients keeps active rows with a usable name, sorted", async () => {
    mockGetClients.mockResolvedValueOnce({
      data: [
        { id: "c2", name: "Zed", email: "z@x.test" },
        { id: "c1", name: "", email: "a@x.test" },
        { id: "c3", name: "Gone", archived_at: "2026-01-01" },
        { name: "no id" },
      ],
    });
    const rows = await programsApi.assignableClients();
    expect(mockGetClients).toHaveBeenCalledWith("active", undefined, 20);
    expect(rows).toEqual([
      { id: "c1", name: "a@x.test", email: "a@x.test" },
      { id: "c2", name: "Zed", email: "z@x.test" },
    ]);
  });
});

describe("assignableClients reads the whole roster (B-355-3 / B-358-1)", () => {
  const roster = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({
      id: `client-${String(from + i).padStart(3, "0")}`,
      name: `Client ${String(from + i).padStart(3, "0")}`,
      email: `c${from + i}@example.invalid`,
      archived_at: null,
    }));

  it("pages past the first 20 clients with the last row id as the cursor", async () => {
    const all = roster(25);
    mockGetClients.mockResolvedValueOnce({ data: all.slice(0, 20) });
    mockGetClients.mockResolvedValueOnce({ data: all.slice(20) });
    const rows = await programsApi.assignableClients();
    expect(rows.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(mockGetClients).toHaveBeenNthCalledWith(2, "active", "client-019", 20);
  });

  it("an exact page boundary asks once more, and repeated rows appear once", async () => {
    const all = roster(20);
    mockGetClients.mockResolvedValueOnce({ data: all });
    mockGetClients.mockResolvedValueOnce({ data: [all[19]] });
    const rows = await programsApi.assignableClients();
    expect(rows).toHaveLength(20);
    expect(mockGetClients).toHaveBeenCalledTimes(2);
  });

  it("a failed later page fails the load instead of showing a partial list", async () => {
    mockGetClients.mockResolvedValueOnce({ data: roster(20) });
    mockGetClients.mockRejectedValueOnce({ response: { status: 503, data: {} } });
    await expect(programsApi.assignableClients()).rejects.toMatchObject({
      response: { status: 503 },
    });
  });

  it("a reply that is not a list fails with the roster copy", async () => {
    mockGetClients.mockResolvedValueOnce({ data: { items: [] } });
    const err = await programsApi.assignableClients().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RosterIncompleteError);
    const f = describeProgramFailure(err, "load your clients");
    expect(f.code).toBe("client_roster_incomplete");
    expect(f.message).toBe(
      "Your full client list did not load, so no clients are shown yet. Retry; if it keeps happening, contact support (Settings, Help).",
    );
  });
});

describe("programsApi helpers", () => {
  it("chunkClientIds de-duplicates and splits at 50", () => {
    const ids = Array.from({ length: 120 }, (_, i) => `c${i}`).concat([
      "c0",
      "c1",
    ]);
    const chunks = chunkClientIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(new Set(chunks.flat()).size).toBe(120);
  });

  it("isValidIsoDate accepts real dates only", () => {
    expect(isValidIsoDate("2026-10-05")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("10/05/2026")).toBe(false);
    expect(isValidIsoDate("2026-1-5")).toBe(false);
  });

  it("nextMonday is strictly after the given day; toIsoDate uses the local calendar", () => {
    const fri = new Date(2026, 9, 2, 10, 0); // Friday 2 Oct 2026
    expect(toIsoDate(nextMonday(fri))).toBe("2026-10-05");
    const mon = new Date(2026, 9, 5, 8, 0);
    expect(toIsoDate(nextMonday(mon))).toBe("2026-10-12");
  });

  it("indexDays keys by week:day", () => {
    const map = indexDays([
      {
        week_index: 1,
        day_index: 3,
        plan_id: "p",
        name: "Upper",
        type: "strength",
        duration_estimate_minutes: null,
        exercise_count: 5,
        updated_at: "x",
      },
    ]);
    expect(map.get("1:3")?.name).toBe("Upper");
    expect(map.get("0:0")).toBeUndefined();
  });
});
