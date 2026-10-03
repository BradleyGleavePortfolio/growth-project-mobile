/**
 * OR-114-4 (B-COACH-5) — csvFile helper: platform-safe file names and the
 * text fallback when the system cannot share files.
 */
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

import { Share } from "react-native";
import { CsvFileError, safeCsvFilename, shareCsvFile } from "../csvFile";

// A spy, not a module mock: replacing all of react-native breaks the Expo
// test preset's own setup (it reads Platform at load).
const mockShare = jest.spyOn(Share, "share");
const live = () => true;

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
    mockShare.mockReset();
    mockShare.mockResolvedValue({ action: "sharedAction" });
    mockIsAvailable.mockReset();
  });

  it("shares as text when file sharing is unavailable, and says so", async () => {
    mockIsAvailable.mockResolvedValueOnce(false);
    await expect(shareCsvFile("date_utc\r\n", "x.csv", live)).resolves.toBe(
      "text",
    );
    expect(mockShare).toHaveBeenCalledWith({
      title: "x.csv",
      message: "date_utc\r\n",
    });
  });

  it("treats a failed availability check as unavailable", async () => {
    mockIsAvailable.mockRejectedValueOnce(new Error("no module"));
    await expect(shareCsvFile("date_utc\r\n", "x.csv", live)).resolves.toBe(
      "text",
    );
  });

  it("a text share that cannot open is a CsvFileError('share')", async () => {
    mockIsAvailable.mockResolvedValueOnce(false);
    mockShare.mockRejectedValueOnce(new Error("busy"));
    await expect(shareCsvFile("d", "x.csv", live)).rejects.toEqual(
      new CsvFileError("share"),
    );
  });
});

describe("B-340-1 (Sol): an export that stopped being current writes and shares nothing", () => {
  beforeEach(() => {
    mockShare.mockReset();
    mockShare.mockResolvedValue({ action: "sharedAction" });
    mockIsAvailable.mockReset();
  });

  const cases: Array<[string, boolean]> = [
    ["file sharing available", true],
    ["file sharing unavailable (text branch)", false],
  ];
  it.each(cases)(
    "%s: the screen closes while availability is held",
    async (_label: string, available: boolean) => {
      let answer!: (v: boolean) => void;
      mockIsAvailable.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          }),
      );
      let current = true;
      const pending = shareCsvFile("date_utc\r\n", "x.csv", () => current);
      current = false;
      answer(available);
      await expect(pending).resolves.toBe("canceled");
      expect(mockShare).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require("expo-file-system") as {
        File: jest.Mock;
        Directory: jest.Mock;
      };
      expect(fs.File).not.toHaveBeenCalled();
      expect(fs.Directory).not.toHaveBeenCalled();
    },
  );

  it("an export that is already stale does not even ask for availability", async () => {
    await expect(shareCsvFile("d", "x.csv", () => false)).resolves.toBe(
      "canceled",
    );
    expect(mockIsAvailable).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
  });
});
