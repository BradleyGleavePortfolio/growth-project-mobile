/**
 * B-327-3 — the data-export adapter validates every 2xx body before the
 * screen can act on it.
 */
import api from "../api";
import {
  dataExportApi,
  DataExportResponseError,
  parseDataExportRecord,
  parseDownloadLink,
} from "../dataExportApi";

jest.mock("../api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const mockGet = api.get as jest.Mock;
const mockPost = api.post as jest.Mock;
const NOW = Date.parse("2026-01-01T00:00:00Z");

const goodLink = {
  download_path: "/v1/me/data-export/download?token=aaa.bbb.ccc",
  token: "aaa.bbb.ccc",
  expires_at: "2026-01-01T00:05:00Z",
  file_name: "tgp-data-export-2026-01-01.json",
  file_size_bytes: 10,
};

const goodRecord = {
  id: "e1",
  status: "READY",
  created_at: "2026-01-01T00:00:00Z",
  completed_at: "2026-01-01T00:01:00Z",
  expires_at: "2026-01-08T00:01:00Z",
  file_size_bytes: 10,
  download_available: true,
  download_token: "tok",
  next_request_at: null,
};

function problemOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof DataExportResponseError) return err.problem;
    throw err;
  }
  return "ACCEPTED";
}

describe("parseDownloadLink", () => {
  it("accepts the download route with a matching token and a future expiry", () => {
    expect(parseDownloadLink(goodLink, null, NOW)).toEqual(goodLink);
  });

  it.each([
    ["{}", {}],
    ["null", null],
    ["an empty token", { ...goodLink, token: "" }],
    ["a missing path", { ...goodLink, download_path: undefined }],
    [
      "another route",
      { ...goodLink, download_path: "/v1/me/other?token=aaa.bbb.ccc" },
    ],
    [
      "an absolute URL",
      {
        ...goodLink,
        download_path:
          "https://evil.test/v1/me/data-export/download?token=aaa.bbb.ccc",
      },
    ],
    [
      "extra query parts",
      {
        ...goodLink,
        download_path:
          "/v1/me/data-export/download?token=aaa.bbb.ccc&next=https://evil.test",
      },
    ],
    [
      "a token that does not match",
      { ...goodLink, download_path: "/v1/me/data-export/download?token=zzz" },
    ],
    ["a past expiry", { ...goodLink, expires_at: "2025-12-31T23:59:00Z" }],
    ["an unparseable expiry", { ...goodLink, expires_at: "soon" }],
  ])('refuses %s (never yields "apiundefined")', (_label, body) => {
    expect(problemOf(() => parseDownloadLink(body, null, NOW))).not.toBe(
      "ACCEPTED",
    );
  });

  it("keeps the outbound request id as the reference, or makes a fresh one", () => {
    try {
      parseDownloadLink(
        { ...goodLink, download_path: "/elsewhere?token=aaa.bbb.ccc" },
        "sent-1",
        NOW,
      );
    } catch (err) {
      expect((err as DataExportResponseError).reference).toBe("sent-1");
      expect((err as Error).message).not.toContain("aaa.bbb.ccc");
    }
    try {
      parseDownloadLink({}, null, NOW);
    } catch (err) {
      expect((err as DataExportResponseError).reference.length).toBeGreaterThan(
        7,
      );
    }
  });
});

describe("parseDataExportRecord", () => {
  it("accepts a complete record and normalises optional fields", () => {
    expect(parseDataExportRecord(goodRecord, "status")).toEqual(goodRecord);
    expect(
      parseDataExportRecord(
        { id: "e2", status: "PENDING", created_at: "2026-01-01T00:00:00Z" },
        "request",
      ),
    ).toMatchObject({
      download_available: false,
      download_token: null,
      next_request_at: null,
    });
  });

  it.each([
    ["{}", {}],
    ["a missing status", { ...goodRecord, status: undefined }],
    ["an unknown status", { ...goodRecord, status: "QUEUED" }],
    ["a null status", { ...goodRecord, status: null }],
    ["a string availability", { ...goodRecord, download_available: "true" }],
    ["a missing id", { ...goodRecord, id: "" }],
    ["a missing created_at", { ...goodRecord, created_at: undefined }],
    ["a string size", { ...goodRecord, file_size_bytes: "10" }],
    ["an empty download token", { ...goodRecord, download_token: "" }],
  ])("refuses %s", (_label, body) => {
    expect(problemOf(() => parseDataExportRecord(body, "status"))).not.toBe(
      "ACCEPTED",
    );
  });
});

describe("dataExportApi", () => {
  beforeEach(() => jest.clearAllMocks());

  it("createDownloadLink rejects a {} body with DataExportResponseError carrying the sent request id", async () => {
    mockPost.mockResolvedValue({
      data: {},
      config: { headers: { "X-Request-Id": "sent-7" } },
    });
    await expect(dataExportApi.createDownloadLink()).rejects.toMatchObject({
      code: "DATA_EXPORT_BAD_RESPONSE",
      reference: "sent-7",
    });
  });

  it("getStatus: 404 and an empty 2xx body mean no export; {} is a bad response", async () => {
    mockGet.mockRejectedValueOnce({ response: { status: 404 } });
    expect(await dataExportApi.getStatus()).toBeNull();
    mockGet.mockResolvedValueOnce({ data: null });
    expect(await dataExportApi.getStatus()).toBeNull();
    mockGet.mockResolvedValueOnce({ data: {} });
    await expect(dataExportApi.getStatus()).rejects.toBeInstanceOf(
      DataExportResponseError,
    );
  });

  it("requestExport validates the receipt", async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        id: "e3",
        status: "PENDING",
        created_at: "2026-01-01T00:00:00Z",
        message: "queued",
      },
    });
    expect((await dataExportApi.requestExport()).status).toBe("PENDING");
    mockPost.mockResolvedValueOnce({ data: { message: "queued" } });
    await expect(dataExportApi.requestExport()).rejects.toBeInstanceOf(
      DataExportResponseError,
    );
  });
});
