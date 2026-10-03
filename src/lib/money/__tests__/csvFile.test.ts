/**
 * OR-114-4 (B-COACH-5) — csvFile helper: platform-safe file names and the
 * text fallback when the system cannot share files.
 */
const mockShare = jest.fn(async () => ({ action: "sharedAction" }));
jest.mock("react-native", () => ({
  Share: { share: (a: unknown) => mockShare(a) },
}));
const mockIsAvailable = jest.fn(async () => true);
jest.mock("expo-sharing", () => ({
  isAvailableAsync: () => mockIsAvailable(),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-file-system", () => ({
  Directory: jest.fn(),
  File: jest.fn(),
  Paths: { cache: { uri: "file:///cache" } },
}));

import { CsvFileError, safeCsvFilename, shareCsvFile } from "../csvFile";

describe("safeCsvFilename", () => {
  it("keeps a server name and allows only safe characters", () => {
    expect(safeCsvFilename("tgp-money-2026-09-02-to-2026-10-02-usd.csv")).toBe(
      "tgp-money-2026-09-02-to-2026-10-02-usd.csv",
    );
    expect(safeCsvFilename("../../etc/passwd")).toBe("etc-passwd.csv");
    expect(safeCsvFilename("Q3 taxes / José.CSV")).toBe("Q3-taxes-Jos.csv");
    expect(safeCsvFilename("")).toBe("tgp-money.csv");
    expect(safeCsvFilename("a".repeat(300))).toHaveLength(120);
  });
});

describe("shareCsvFile fallback", () => {
  beforeEach(() => {
    mockShare.mockClear();
    mockIsAvailable.mockReset();
  });

  it("shares as text when file sharing is unavailable, and says so", async () => {
    mockIsAvailable.mockResolvedValueOnce(false);
    await expect(shareCsvFile("date_utc\r\n", "x.csv")).resolves.toBe("text");
    expect(mockShare).toHaveBeenCalledWith({
      title: "x.csv",
      message: "date_utc\r\n",
    });
  });

  it("treats a failed availability check as unavailable", async () => {
    mockIsAvailable.mockRejectedValueOnce(new Error("no module"));
    await expect(shareCsvFile("date_utc\r\n", "x.csv")).resolves.toBe("text");
  });

  it("a text share that cannot open is a CsvFileError('share')", async () => {
    mockIsAvailable.mockResolvedValueOnce(false);
    mockShare.mockRejectedValueOnce(new Error("busy"));
    await expect(shareCsvFile("d", "x.csv")).rejects.toEqual(
      new CsvFileError("share"),
    );
  });
});
