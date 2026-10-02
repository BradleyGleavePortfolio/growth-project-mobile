import React from "react";
import { Linking } from "react-native";
import { render, fireEvent, act } from "@testing-library/react-native";
import DataExportScreen from "../DataExportScreen";
import {
  dataExportApi,
  DataExportResponseError,
} from "../../../services/dataExportApi";
import { authEvents } from "../../../utils/authEvents";

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("../../../services/dataExportApi", () => ({
  ...jest.requireActual("../../../services/dataExportApi"),
  dataExportApi: {
    requestExport: jest.fn(),
    getStatus: jest.fn(),
    createDownloadLink: jest.fn(),
  },
}));

jest.mock("../../../services/api", () => ({ __esModule: true, default: {} }));

let mockUser: { id: string; email: string } | null = {
  id: "user-a",
  email: "a@example.test",
};
jest.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => mockUser,
}));

jest.mock("../../../config/env", () => ({
  env: { API_URL: "https://api.example.test/api" },
}));

const mockCaptureError = jest.fn();
jest.mock("../../../services/sentry", () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));

jest.mock("../../../theme", () => ({
  useTheme: () => ({
    colors: {
      background: "#FAF9F6",
      ink: "#1A1A1A",
      border: "#E0DDD8",
      error: "#B91C1C",
    },
  }),
}));

// Suppress act() warning noise in test output
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = (msg: string) => {
    if (!msg.includes("act(")) originalWarn(msg);
  };
});
afterAll(() => {
  console.warn = originalWarn;
});

const mockGetStatus = dataExportApi.getStatus as jest.Mock;
const mockRequestExport = dataExportApi.requestExport as jest.Mock;
const mockCreateLink = dataExportApi.createDownloadLink as jest.Mock;

/** An axios-shaped HTTP error with the backend's envelope. */
function httpError(status: number, code?: string, requestId?: string) {
  return {
    isAxiosError: true,
    response: {
      status,
      data: {
        statusCode: status,
        ...(code ? { code } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
      headers: {},
    },
  };
}

function offlineError() {
  return { isAxiosError: true, message: "Cannot reach server." };
}

function link() {
  return {
    download_path: "/v1/me/data-export/download?token=fresh.jwt.token",
    token: "fresh.jwt.token",
    expires_at: "2026-01-01T00:06:00Z",
    file_name: "tgp-data-export-2026-01-01.json",
    file_size_bytes: 45678,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pendingRecord() {
  return {
    id: "e1",
    status: "PENDING" as const,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    expires_at: null,
    file_size_bytes: null,
    download_token: null,
  };
}

function readyRecord() {
  return {
    id: "e1",
    status: "READY" as const,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T00:01:00Z",
    expires_at: "2026-01-08T00:01:00Z",
    file_size_bytes: 45678,
    download_token: "jwt-token-abc",
    // download_available was added when the screen gained an S3-availability
    // guard around the Download button. Without it, READY records render
    // without a download CTA — the user sees the metadata but can't act.
    download_available: true,
  };
}

function expiredRecord() {
  return { ...readyRecord(), status: "EXPIRED" as const };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DataExportScreen", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockUser = { id: "user-a", email: "a@example.test" };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  it("renders the heading and included-data list", async () => {
    mockGetStatus.mockResolvedValue(null);

    const { getByText, findByText, getAllByText } = await render(
      <DataExportScreen />,
    );
    await findByText(/works for 5 minutes and only for you/);

    // "Request my data" appears twice in this state — the screen heading and the
    // CTA button label. v14 surfaces both host <Text> nodes, so anchor the async
    // wait on the unique intro paragraph, then assert the heading text exists
    // (one of the two occurrences) rather than requiring a single match.
    await findByText(/right to receive a complete copy/);
    expect(getAllByText("Request my data").length).toBeGreaterThanOrEqual(1);
    expect(getByText(/Weight, food, and water logs/)).toBeTruthy();
    expect(getByText(/Coaching messages you sent/)).toBeTruthy();
    expect(getByText(/Audit log entries about your account/)).toBeTruthy();
    // C-636-2 / backend archive inventory: recipes, Roman chats, AI consent.
    expect(getByText("Recipes you created and recipes you saved")).toBeTruthy();
    expect(getByText("Your Roman chats you have not deleted")).toBeTruthy();
    expect(
      getByText("Your AI consent choices and when you made them"),
    ).toBeTruthy();
  });

  it("shows the Request button when no export exists (idle state)", async () => {
    mockGetStatus.mockResolvedValue(null);

    const { findByRole } = await render(<DataExportScreen />);

    const btn = await findByRole("button", { name: /Request my data/i });
    expect(btn).toBeTruthy();
  });

  // ── Request flow ───────────────────────────────────────────────────────────

  it("moves to polling state after requesting export", async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockResolvedValue(pendingRecord());

    const { findByRole, findByText } = await render(<DataExportScreen />);

    const btn = await findByRole("button", { name: /Request my data/i });
    await fireEvent.press(btn);

    await findByText("Export in progress");
  });

  it("a 409 DATA_EXPORT_IN_PROGRESS shows the export already being built", async () => {
    mockGetStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValue(pendingRecord());
    mockRequestExport.mockRejectedValue(
      httpError(409, "DATA_EXPORT_IN_PROGRESS"),
    );

    const { findByRole, findByText } = await render(<DataExportScreen />);

    const btn = await findByRole("button", { name: /Request my data/i });
    await fireEvent.press(btn);

    await findByText("Export in progress");
  });

  it("a 409 DATA_EXPORT_RATE_LIMITED shows the recent export and when a new one is allowed", async () => {
    const next = new Date(Date.now() + 3 * 3_600_000).toISOString();
    mockGetStatus
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ ...readyRecord(), next_request_at: next });
    mockRequestExport.mockRejectedValue(
      httpError(409, "DATA_EXPORT_RATE_LIMITED"),
    );

    const { findByRole, findByText, queryByRole } = await render(
      <DataExportScreen />,
    );
    await fireEvent.press(
      await findByRole("button", { name: /Request my data/i }),
    );

    await findByText("You already have a recent export");
    await findByText(/You can request a new export after/);
    expect(
      queryByRole("button", { name: /Request a new data export/i }),
    ).toBeNull();
    expect(
      await findByRole("button", { name: /Download your data file/i }),
    ).toBeTruthy();
  });

  it("an unknown request failure says what to do, quotes the reference and reports to Sentry", async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(httpError(500, undefined, "req-42"));

    const { findByRole, findByText, queryByText } = await render(
      <DataExportScreen />,
    );

    await fireEvent.press(
      await findByRole("button", { name: /Request my data/i }),
    );

    await findByText("We could not start your export");
    await findByText(
      /Tap Request my data again\. If it keeps happening, email Bradleyapple1031@gmail\.com and quote reference req-42\./,
    );
    await findByText("Reference: req-42");
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        screen: "DataExportScreen",
        step: "request",
        support_reference: "req-42",
      }),
    );
    expect(queryByText(/Something went wrong|Please try again/)).toBeNull();
  });

  it("a request while offline says so and gives the next step", async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(offlineError());

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Request my data/i }),
    );

    await findByText("You appear to be offline");
    await findByText(/Check your connection, then tap Request my data again/);
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("storage being down (503 DATA_EXPORT_STORAGE_UNAVAILABLE) says the data is safe", async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(
      httpError(503, "DATA_EXPORT_STORAGE_UNAVAILABLE", "req-7"),
    );

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Request my data/i }),
    );

    await findByText("File storage is not responding");
    await findByText(/Your data is safe\. Wait a minute/);
  });

  it("a failed status load offers Check again, which reloads", async () => {
    mockGetStatus
      .mockRejectedValueOnce(httpError(500, undefined, "req-9"))
      .mockResolvedValue(null);

    const { findByRole, findByText } = await render(<DataExportScreen />);

    await findByText("We could not load your export");
    await fireEvent.press(
      await findByRole("button", { name: /Check your export status again/i }),
    );
    await findByRole("button", { name: /Request my data export/i });
  });

  // ── Status polling ─────────────────────────────────────────────────────────

  it("transitions from polling to ready when status becomes READY", async () => {
    // Initial load: PENDING (triggers polling state)
    mockGetStatus.mockResolvedValueOnce(pendingRecord());
    // Poll response: READY
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByText } = await render(<DataExportScreen />);

    // Should start in polling state
    await findByText("Export in progress");

    // Advance the polling interval
    await act(async () => {
      jest.advanceTimersByTime(5500);
    });

    await findByText("Your file is ready");
  });

  it("shows file size and expiry date when ready", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByText } = await render(<DataExportScreen />);

    await findByText("Your file is ready");
    // The status body is a single Text node interpolating
    // "File size: 44.6 KB." and "Available until 8 January 2026." together —
    // findByText needs a matcher that scans the combined string.
    await findByText(/44\.6 KB/);
    await findByText(/available until/i);
  });

  it("shows Download button when READY", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());

    const { findByRole } = await render(<DataExportScreen />);

    const btn = await findByRole("button", {
      name: /Download your data file/i,
    });
    expect(btn).toBeTruthy();
  });

  it("Download file mints a fresh link at tap time and opens it in the browser", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockResolvedValue(link());
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("Download started in your browser");
    expect(mockCreateLink).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(
      "https://api.example.test/api/v1/me/data-export/download?token=fresh.jwt.token",
    );
    // The stale status token is never used by this build.
    expect(openURL).not.toHaveBeenCalledWith(
      expect.stringContaining("jwt-token-abc"),
    );
    openURL.mockRestore();
  });

  it("a backend without /download-link (bare 404) falls back to the status token", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(404));
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("Download started in your browser");
    expect(openURL).toHaveBeenCalledWith(
      "https://api.example.test/api/v1/me/data-export/download?token=jwt-token-abc",
    );
    openURL.mockRestore();
  });

  // B-327-6: the pinned React Native rejections quote the URL (and its token).
  it.each([
    [
      "iOS",
      "Unable to open URL: https://api.example.test/api/v1/me/data-export/download?token=fresh.jwt.token",
    ],
    [
      "Android",
      "Could not open URL 'https://api.example.test/api/v1/me/data-export/download?token=fresh.jwt.token': No Activity found to handle Intent",
    ],
  ])(
    "a %s browser-open rejection gets a clear next step, a reference, and never reaches Sentry with the link",
    async (_os, nativeMessage) => {
      mockGetStatus.mockResolvedValue(readyRecord());
      mockCreateLink.mockResolvedValue(link());
      const openURL = jest
        .spyOn(Linking, "openURL")
        .mockRejectedValue(new Error(nativeMessage));

      const { findByRole, findByText } = await render(<DataExportScreen />);
      await fireEvent.press(
        await findByRole("button", { name: /Download your data file/i }),
      );

      await findByText("Your phone could not open the download");
      await findByText(/Check that a web browser is installed/);
      const ref = (await findByText(/^Reference: /)).props.children;
      expect(mockCaptureError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          step: "open_browser",
          known_launch_failure: true,
        }),
      );
      const sent = JSON.stringify(
        mockCaptureError.mock.calls.map(([e, ctx]) => [
          String(e),
          (e as Error).message,
          ctx,
        ]),
      );
      expect(sent).not.toContain("fresh.jwt.token");
      expect(sent).not.toContain("/data-export/download");
      const reportedRef = mockCaptureError.mock.calls[0][1].support_reference;
      expect(String(ref).replace(/^Reference: /, "")).toContain(reportedRef);
      openURL.mockRestore();
    },
  );

  it("an unexpected browser-open failure is not called a browser problem: reference + support path", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockResolvedValue(link());
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockRejectedValue(new TypeError("bridge exploded"));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("We could not open your download");
    await findByText(/email Bradleyapple1031@gmail\.com and quote reference/);
    expect(mockCaptureError.mock.calls[0][1]).toMatchObject({
      step: "open_browser",
      known_launch_failure: false,
    });
    openURL.mockRestore();
  });

  it("an export that expired while on screen moves to the expired state", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(410, "DATA_EXPORT_EXPIRED"));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("Previous export expired");
  });

  it("a missing file (410 DATA_EXPORT_FILE_MISSING) offers a new export instead of support", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(
      httpError(410, "DATA_EXPORT_FILE_MISSING"),
    );

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("This file is no longer available");
    expect(
      await findByRole("button", { name: /Request a new data export/i }),
    ).toBeTruthy();
  });

  it("a READY record without a stored file never shows a broken Download button", async () => {
    mockGetStatus.mockResolvedValue({
      ...readyRecord(),
      download_available: false,
      download_token: null,
    });

    const { findByText, queryByRole } = await render(<DataExportScreen />);

    await findByText("This file is no longer available");
    expect(
      queryByRole("button", { name: /Download your data file/i }),
    ).toBeNull();
  });

  it("an ended session during download says to log in again", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(401, undefined, "req-5"));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("Your session has ended");
    await findByText(/Log in again/);
    // The Download button stays so the user can retry after logging in.
    expect(
      await findByRole("button", { name: /Download your data file/i }),
    ).toBeTruthy();
  });

  it("an unknown download failure quotes the reference and keeps Download available", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(httpError(500, undefined, "req-77"));

    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("We could not prepare your download");
    await findByText("Reference: req-77");
    expect(mockCaptureError).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ step: "download", status: 500 }),
    );
  });

  it("three failed polls in a row stop polling and say what happened", async () => {
    mockGetStatus
      .mockResolvedValueOnce(pendingRecord())
      .mockRejectedValue(offlineError());

    const { findByText } = await render(<DataExportScreen />);
    await findByText("Export in progress");

    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(5500);
      });
    }

    await findByText("You appear to be offline");
    await findByText(/tap Check again/);
  });

  it("transitions from polling to failed when status becomes FAILED", async () => {
    mockGetStatus.mockResolvedValueOnce(pendingRecord());
    mockGetStatus.mockResolvedValue({
      ...pendingRecord(),
      status: "FAILED",
    });

    const { findByText } = await render(<DataExportScreen />);
    await findByText("Export in progress");

    await act(async () => {
      jest.advanceTimersByTime(5500);
    });

    await findByText("Your last export is not available");
    await findByText(/It did not finish, or its file could not be kept/);
    await findByText(/email Bradleyapple1031@gmail\.com/);
  });

  // ── Expired state ──────────────────────────────────────────────────────────

  it("shows expired state when initial status is EXPIRED", async () => {
    mockGetStatus.mockResolvedValue(expiredRecord());

    const { findByText } = await render(<DataExportScreen />);

    await findByText("Previous export expired");
    await findByText(/kept for 7 days/i);
  });

  it("shows Request new export button in expired state", async () => {
    mockGetStatus.mockResolvedValue(expiredRecord());
    mockRequestExport.mockResolvedValue(pendingRecord());

    const { findByRole, findByText } = await render(<DataExportScreen />);

    await findByText("Previous export expired");
    const btn = await findByRole("button", {
      name: /Request a fresh data export/i,
    });
    await fireEvent.press(btn);

    await findByText("Export in progress");
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it("all interactive elements have accessibilityLabel and accessibilityRole", async () => {
    mockGetStatus.mockResolvedValue(null);

    const { findByRole } = await render(<DataExportScreen />);

    const btn = await findByRole("button", { name: /Request my data/i });
    expect(btn).toBeTruthy();
  });
});

// ─── Fix round 1 (Sol B-327-1..6, C-327-1) ─────────────────────────────────────

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const RETIRED_ADDRESSES = [
  "hello@thegrowthproject.app",
  "Bradley@Bradleytgpcoaching.com",
];

const realTimers: { setImmediate: (fn: () => void) => void } =
  jest.requireActual("timers");

/**
 * Press a button whose handler is held open on purpose. fireEvent.press
 * resolves with the handler's own promise, so it is not awaited; we wait
 * (on real timers) only until its act() scope has closed.
 */
async function pressHeld(el: Parameters<typeof fireEvent.press>[0]) {
  void fireEvent.press(el);
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((r) => realTimers.setImmediate(r));
  }
}

describe("DataExportScreen fix round 1", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockUser = { id: "user-a", email: "a@example.test" };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // B-327-1
  it("the FAILED state gives the single support address", async () => {
    mockGetStatus.mockResolvedValue({ ...pendingRecord(), status: "FAILED" });
    const failed = await render(<DataExportScreen />);
    await failed.findByText(/email Bradleyapple1031@gmail\.com/);
    const text = JSON.stringify(failed.toJSON());
    for (const retired of RETIRED_ADDRESSES)
      expect(text).not.toContain(retired);
  });

  it("an unknown failure gives the single support address and never a retired one", async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(new Error("boom"));
    const unknown = await render(<DataExportScreen />);
    await fireEvent.press(
      await unknown.findByRole("button", { name: /Request my data/i }),
    );
    await unknown.findByText(
      /email Bradleyapple1031@gmail\.com and quote reference/,
    );
    const text = JSON.stringify(unknown.toJSON());
    for (const retired of RETIRED_ADDRESSES)
      expect(text).not.toContain(retired);
  });

  // B-327-2
  it("a link that arrives after the screen is left never opens the browser", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    const pending = deferred<ReturnType<typeof link>>();
    mockCreateLink.mockReturnValue(pending.promise);
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

    const screen = await render(<DataExportScreen />);
    await pressHeld(
      await screen.findByRole("button", { name: /Download your data file/i }),
    );
    await screen.unmount();
    await act(async () => {
      pending.resolve(link());
    });
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it("account A's pending link is dropped when A logs out, also on the legacy-token path", async () => {
    for (const legacy of [false, true]) {
      jest.clearAllMocks();
      mockUser = { id: "user-a", email: "a@example.test" };
      mockGetStatus.mockResolvedValue(readyRecord());
      const pending = deferred<ReturnType<typeof link>>();
      mockCreateLink.mockReturnValue(pending.promise);
      const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

      const screen = await render(<DataExportScreen />);
      await pressHeld(
        await screen.findByRole("button", { name: /Download your data file/i }),
      );
      await act(async () => {
        authEvents.emit("logout");
      });
      mockUser = { id: "user-b", email: "b@example.test" };
      await act(async () => {
        if (legacy) pending.reject(httpError(404));
        else pending.resolve(link());
      });
      expect(openURL).not.toHaveBeenCalled();
      openURL.mockRestore();
      await screen.unmount();
    }
  });

  it("a signed-in identity change while the link is pending drops it; the same account still downloads", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    const pending = deferred<ReturnType<typeof link>>();
    mockCreateLink
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(link());
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

    const screen = await render(<DataExportScreen />);
    await pressHeld(
      await screen.findByRole("button", { name: /Download your data file/i }),
    );
    mockUser = { id: "user-b", email: "b@example.test" };
    await screen.rerender(<DataExportScreen />);
    await act(async () => {
      pending.resolve(link());
    });
    expect(openURL).not.toHaveBeenCalled();
    await screen.unmount();

    // Same account, no retirement: opens normally.
    const again = await render(<DataExportScreen />);
    await fireEvent.press(
      await again.findByRole("button", { name: /Download your data file/i }),
    );
    await again.findByText("Download started in your browser");
    expect(openURL).toHaveBeenCalledTimes(1);
    openURL.mockRestore();
  });

  // B-327-2 (re-audit): the same mounted screen must drop account A's READY
  // record, link and busy state and load account B's own status.
  it("an identity change on the same mounted screen clears A's ready file and loads B's status", async () => {
    mockGetStatus
      .mockResolvedValueOnce(readyRecord())
      .mockResolvedValueOnce(null);
    const pending = deferred<ReturnType<typeof link>>();
    mockCreateLink.mockReturnValueOnce(pending.promise);
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

    const screen = await render(<DataExportScreen />);
    await pressHeld(
      await screen.findByRole("button", { name: /Download your data file/i }),
    );
    mockUser = { id: "user-b", email: "b@example.test" };
    await screen.rerender(<DataExportScreen />);
    await act(async () => {
      pending.resolve(link());
    });

    expect(openURL).not.toHaveBeenCalled();
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    const request = await screen.findByRole("button", {
      name: /Request my data/i,
    });
    expect(request.props.accessibilityState?.disabled).not.toBe(true);
    expect(screen.queryByText(/Your file is ready/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Download your data file/i }),
    ).toBeNull();
    openURL.mockRestore();
    await screen.unmount();
  });

  // B-327-3
  it("a malformed link answer opens nothing and gives a reference that matches Sentry", async () => {
    mockGetStatus.mockResolvedValue(readyRecord());
    mockCreateLink.mockRejectedValue(
      new DataExportResponseError(
        "/v1/me/data-export/download-link",
        "token missing",
        "ref-bad-1",
      ),
    );
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

    const { findByRole, findByText, queryByText } = await render(
      <DataExportScreen />,
    );
    await fireEvent.press(
      await findByRole("button", { name: /Download your data file/i }),
    );

    await findByText("We could not prepare your download");
    await findByText(
      /The answer from our server was incomplete, so nothing was opened/,
    );
    await findByText("Reference: ref-bad-1");
    expect(openURL).not.toHaveBeenCalled();
    expect(queryByText("Download started in your browser")).toBeNull();
    expect(mockCaptureError.mock.calls[0][1]).toMatchObject({
      step: "download",
      support_reference: "ref-bad-1",
      code: "DATA_EXPORT_BAD_RESPONSE",
    });
    openURL.mockRestore();
  });

  it("a malformed status answer while polling ends the spinner with a specific message", async () => {
    mockGetStatus
      .mockResolvedValueOnce(pendingRecord())
      .mockRejectedValue(
        new DataExportResponseError(
          "/v1/me/data-export/status",
          "unknown status",
          "ref-st-1",
        ),
      );
    const { findByText, queryByText } = await render(<DataExportScreen />);
    await findByText("Export in progress");
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(5500);
      });
    }
    await findByText("We could not load your export");
    await findByText("Reference: ref-st-1");
    expect(queryByText("Export in progress")).toBeNull();
  });

  // B-327-4
  it("an unknown failure without a server reference shows the request id this app sent, the same one Sentry gets", async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue({
      isAxiosError: true,
      config: { headers: { "X-Request-Id": "sent-req-9" } },
      response: { status: 500, data: "<html>bad gateway</html>", headers: {} },
    });
    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Request my data/i }),
    );
    await findByText("Reference: sent-req-9");
    expect(mockCaptureError.mock.calls[0][1].support_reference).toBe(
      "sent-req-9",
    );
  });

  it("a local failure gets a fresh reference, shown and reported identically", async () => {
    mockGetStatus.mockResolvedValue(null);
    mockRequestExport.mockRejectedValue(new Error("local bug"));
    const { findByRole, findByText } = await render(<DataExportScreen />);
    await fireEvent.press(
      await findByRole("button", { name: /Request my data/i }),
    );
    const shown = await findByText(/^Reference: /);
    const reported = mockCaptureError.mock.calls[0][1].support_reference;
    expect(typeof reported).toBe("string");
    expect(reported.length).toBeGreaterThan(7);
    expect(String(shown.props.children)).toContain(reported);
    expect(mockCaptureError.mock.calls[0][0]).not.toBeInstanceOf(TypeError);
  });

  // B-327-5
  it("only one status request is in flight at a time, so an old answer cannot overwrite a newer state", async () => {
    const slow = deferred<ReturnType<typeof pendingRecord>>();
    mockGetStatus
      .mockResolvedValueOnce(pendingRecord())
      .mockReturnValueOnce(slow.promise);
    const { findByText } = await render(<DataExportScreen />);
    await findByText("Export in progress");
    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(5500);
      });
    }
    // initial load + exactly one poll, still waiting
    expect(mockGetStatus).toHaveBeenCalledTimes(2);
    mockGetStatus.mockResolvedValue(readyRecord());
    await act(async () => {
      slow.resolve(pendingRecord());
    });
    await act(async () => {
      jest.advanceTimersByTime(5500);
    });
    await findByText("Your file is ready");
  });

  it("a poll answer that lands after the screen is left is dropped", async () => {
    const slow = deferred<never>();
    mockGetStatus
      .mockResolvedValueOnce(pendingRecord())
      .mockReturnValueOnce(slow.promise);
    const screen = await render(<DataExportScreen />);
    await screen.findByText("Export in progress");
    await act(async () => {
      jest.advanceTimersByTime(5500);
    });
    await screen.unmount();
    await act(async () => {
      slow.reject(httpError(500));
    });
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it("an export that disappears while polling stops polling and offers a new request", async () => {
    mockGetStatus
      .mockResolvedValueOnce(pendingRecord())
      .mockResolvedValue(null);
    const { findByText, findByRole } = await render(<DataExportScreen />);
    await findByText("Export in progress");
    await act(async () => {
      jest.advanceTimersByTime(5500);
    });
    await findByText("We could not find your export");
    expect(
      await findByRole("button", { name: /Request my data export/i }),
    ).toBeTruthy();
    const calls = mockGetStatus.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(mockGetStatus.mock.calls.length).toBe(calls);
  });

  // C-327-1
  it("the replacement action appears when its deadline passes, without leaving the screen", async () => {
    jest.setSystemTime(new Date("2026-01-02T10:00:00Z"));
    mockGetStatus.mockResolvedValue({
      ...readyRecord(),
      next_request_at: "2026-01-02T10:01:00Z",
    });
    const { findByText, queryByRole, findByRole } = await render(
      <DataExportScreen />,
    );
    await findByText(/You can request a new export after/);
    expect(
      queryByRole("button", { name: /Request a new data export/i }),
    ).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    expect(
      await findByRole("button", { name: /Request a new data export/i }),
    ).toBeTruthy();
  });
});
