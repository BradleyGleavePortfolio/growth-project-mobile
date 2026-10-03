/**
 * OR-114-4 (B-COACH-5) — the coach's tax CSV leaves the app as a real .csv
 * file attachment, not pasted text.
 *
 * The server's CSV is written to one file in the app's cache directory
 * (cache/money-exports/<name>.csv) and handed to the system share sheet with
 * the CSV content type, so Mail attaches it, Files saves it and Numbers or
 * Excel open it. Before each export the folder is emptied, so at most one
 * export is ever kept on the device, inside the app's own sandbox, and the
 * system may clear it at any time.
 *
 * expo-file-system and expo-sharing ship inside the Expo SDK 56 runtime
 * (expo-file-system is a dependency of expo itself), so this needs no native
 * build. Where the system offers no file sharing (some Android profiles,
 * web), the CSV goes to the text share sheet instead and the result says so.
 */
import { Share } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export const CSV_EXPORT_DIR = "money-exports";
export const CSV_MIME = "text/csv";
export const CSV_UTI = "public.comma-separated-values-text";
// A UTF-8 byte-order mark, so spreadsheet apps read names with accents.
const BOM = "\uFEFF";

/** How the CSV left the app. */
export type CsvShareOutcome = "file" | "text";

/** The file could not be written, or the share sheet could not open. */
export class CsvFileError extends Error {
  constructor(readonly reason: "write" | "share") {
    super(`csv export ${reason} failed`);
    this.name = "CsvFileError";
  }
}

/**
 * A file name that is safe on every platform: letters, digits, dot, dash and
 * underscore only, one .csv extension, at most 120 characters.
 */
export function safeCsvFilename(name: string): string {
  const stem =
    name
      .replace(/\.csv$/i, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 116) || "tgp-money";
  return `${stem}.csv`;
}

function writeExport(csv: string, filename: string): File {
  try {
    const dir = new Directory(Paths.cache, CSV_EXPORT_DIR);
    if (dir.exists) dir.delete();
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, filename);
    file.create({ overwrite: true });
    file.write(csv.startsWith(BOM) ? csv : BOM + csv);
    return file;
  } catch {
    throw new CsvFileError("write");
  }
}

/**
 * Hand the CSV to the share sheet as a .csv file. Resolves when the sheet
 * closes (sharing or dismissing are both fine), with how it was shared.
 */
export async function shareCsvFile(
  csv: string,
  filename: string,
): Promise<CsvShareOutcome> {
  const name = safeCsvFilename(filename);
  let canShareFiles = false;
  try {
    canShareFiles = await Sharing.isAvailableAsync();
  } catch {
    canShareFiles = false;
  }
  if (!canShareFiles) {
    try {
      await Share.share({ title: name, message: csv });
    } catch {
      throw new CsvFileError("share");
    }
    return "text";
  }
  const file = writeExport(csv, name);
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: CSV_MIME,
      UTI: CSV_UTI,
      dialogTitle: name,
    });
  } catch {
    throw new CsvFileError("share");
  }
  return "file";
}
