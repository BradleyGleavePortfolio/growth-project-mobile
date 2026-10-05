import api from "./api";
import { newRequestId } from "../utils/correlation";

export const DATA_EXPORT_STATUSES = [
  "PENDING",
  "RUNNING",
  "READY",
  "EXPIRED",
  "FAILED",
] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

export interface DataExportRecord {
  id: string;
  status: DataExportStatus;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  file_size_bytes: number | null;
  /**
   * True only when the backend holds the finished file in its private
   * storage and can stream it now. A READY record with this false has no
   * file to give (an older export, or one whose file was removed), so the
   * UI offers a new export instead of a download.
   */
  download_available?: boolean;
  /**
   * Short-lived (5-minute) download token kept for older app builds. This
   * build asks for a fresh link at the moment of the tap instead
   * (createDownloadLink), so a link never goes stale on screen.
   */
  download_token?: string | null;
  /**
   * When a new export can be requested: while one is being built, or within
   * 24 hours of a downloadable one. Null when a request is allowed now.
   */
  next_request_at?: string | null;
}

export interface DataExportDownloadLink {
  /** Path under the API base URL, e.g. /v1/me/data-export/download?token=... */
  download_path: string;
  token: string;
  expires_at: string;
  file_name: string;
  file_size_bytes: number | null;
}

/** Stable backend error codes for the data export endpoints. */
export type DataExportErrorCode =
  | "DATA_EXPORT_NOT_FOUND"
  | "DATA_EXPORT_IN_PROGRESS"
  | "EXPORT_ALREADY_IN_PROGRESS"
  | "DATA_EXPORT_RATE_LIMITED"
  | "DATA_EXPORT_NOT_READY"
  | "DATA_EXPORT_EXPIRED"
  | "DATA_EXPORT_FILE_MISSING"
  | "DATA_EXPORT_STORAGE_UNAVAILABLE"
  | "DATA_EXPORT_LINK_INVALID"
  | "DATA_EXPORT_LINK_EXPIRED"
  | typeof DATA_EXPORT_BAD_RESPONSE;

/**
 * Local code for a 2xx answer this build cannot use (missing or wrongly typed
 * fields, an unknown status, a link to anywhere but the download route).
 */
export const DATA_EXPORT_BAD_RESPONSE = "DATA_EXPORT_BAD_RESPONSE";

/** The only route a download link may open, relative to the API base URL. */
export const DOWNLOAD_ROUTE = "/v1/me/data-export/download?token=";

/**
 * A successful HTTP answer with a body the screen must not act on. Carries a
 * support reference (the request's X-Request-Id when known, else a fresh
 * local one) and never the body itself, which may hold a download token.
 */
export class DataExportResponseError extends Error {
  readonly code = DATA_EXPORT_BAD_RESPONSE;
  readonly reference: string;
  readonly endpoint: string;
  readonly problem: string;
  constructor(endpoint: string, problem: string, reference: string | null) {
    super(`data export: unusable response from ${endpoint} (${problem})`);
    this.name = "DataExportResponseError";
    this.endpoint = endpoint;
    this.problem = problem;
    this.reference = reference ?? newRequestId();
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && Number.isFinite(new Date(v).getTime());
}

function optionalDate(v: unknown): v is string | null | undefined {
  return v === undefined || v === null || isIsoDate(v);
}

function sentRequestId(headers: unknown): string | null {
  if (!isObject(headers)) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "x-request-id" && isNonEmptyString(value))
      return value;
  }
  return null;
}

/** Status / request receipt: every field the screen reads, with its exact type. */
export function parseDataExportRecord(
  body: unknown,
  endpoint: string,
  reference: string | null = null,
): DataExportRecord {
  const bad = (problem: string) =>
    new DataExportResponseError(endpoint, problem, reference);
  if (!isObject(body)) throw bad("body is not an object");
  if (!isNonEmptyString(body.id)) throw bad("id missing");
  if (!(DATA_EXPORT_STATUSES as readonly unknown[]).includes(body.status)) {
    throw bad("unknown status");
  }
  if (!isIsoDate(body.created_at)) throw bad("created_at missing");
  if (!optionalDate(body.completed_at)) throw bad("completed_at invalid");
  if (!optionalDate(body.expires_at)) throw bad("expires_at invalid");
  if (!optionalDate(body.next_request_at)) throw bad("next_request_at invalid");
  const size = body.file_size_bytes;
  if (!(
    size === undefined ||
    size === null ||
    (typeof size === "number" && Number.isFinite(size) && size >= 0)
  )) {
    throw bad("file_size_bytes invalid");
  }
  const available = body.download_available;
  if (!(available === undefined || typeof available === "boolean")) {
    throw bad("download_available is not a boolean");
  }
  const token = body.download_token;
  if (!(token === undefined || token === null || isNonEmptyString(token))) {
    throw bad("download_token invalid");
  }
  return {
    id: body.id,
    status: body.status as DataExportStatus,
    created_at: body.created_at,
    completed_at: (body.completed_at as string | null | undefined) ?? null,
    expires_at: (body.expires_at as string | null | undefined) ?? null,
    file_size_bytes: (size as number | null | undefined) ?? null,
    download_available: available === true,
    download_token: (token as string | null | undefined) ?? null,
    next_request_at:
      (body.next_request_at as string | null | undefined) ?? null,
  };
}

/**
 * A download link the app may open: the relative download route with a
 * non-empty token equal to `token`, nothing else in the path, and an expiry
 * still in the future.
 */
export function parseDownloadLink(
  body: unknown,
  reference: string | null = null,
  now: number = Date.now(),
): DataExportDownloadLink {
  const endpoint = "/v1/me/data-export/download-link";
  const bad = (problem: string) =>
    new DataExportResponseError(endpoint, problem, reference);
  if (!isObject(body)) throw bad("body is not an object");
  const { download_path: path, token } = body;
  if (!isNonEmptyString(token)) throw bad("token missing");
  if (typeof path !== "string" || !path.startsWith(DOWNLOAD_ROUTE)) {
    throw bad("download_path is not the download route");
  }
  const encoded = path.slice(DOWNLOAD_ROUTE.length);
  if (!/^[A-Za-z0-9._~%-]+$/.test(encoded))
    throw bad("download_path has extra parts");
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw bad("download_path token is not decodable");
  }
  if (decoded !== token) throw bad("download_path token does not match");
  if (
    !isIsoDate(body.expires_at) ||
    new Date(body.expires_at).getTime() <= now
  ) {
    throw bad("expires_at missing or past");
  }
  const size = body.file_size_bytes;
  return {
    download_path: path,
    token,
    expires_at: body.expires_at,
    file_name: isNonEmptyString(body.file_name)
      ? body.file_name
      : "tgp-data-export.json",
    file_size_bytes:
      typeof size === "number" && Number.isFinite(size) && size >= 0
        ? size
        : null,
  };
}

/** The legacy status-token fallback, built only from a validated non-empty token. */
export function legacyDownloadPath(token: string): string {
  return `${DOWNLOAD_ROUTE}${encodeURIComponent(token)}`;
}

/** The machine `code` from an API error envelope, or null. */
export function dataExportErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;
  const data = (response as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

export const dataExportApi = {
  /**
   * POST /v1/me/data-export/request
   * Enqueue a new export. Returns immediately; poll /status for completion.
   * 409 DATA_EXPORT_IN_PROGRESS / DATA_EXPORT_RATE_LIMITED, 503
   * DATA_EXPORT_STORAGE_UNAVAILABLE. A 2xx body without a usable id, status
   * and created_at throws DataExportResponseError.
   */
  async requestExport(): Promise<DataExportRecord> {
    const res = await api.post<unknown>("/v1/me/data-export/request");
    return parseDataExportRecord(
      res.data,
      "/v1/me/data-export/request",
      sentRequestId(res.config?.headers),
    );
  },

  /**
   * GET /v1/me/data-export/status
   * The most recent export, or null when there is none (404, or a 2xx with
   * an empty body). Any other 2xx body must be a complete status record.
   */
  async getStatus(): Promise<DataExportRecord | null> {
    try {
      const res = await api.get<unknown>("/v1/me/data-export/status");
      if (res.data === null || res.data === undefined || res.data === "")
        return null;
      return parseDataExportRecord(
        res.data,
        "/v1/me/data-export/status",
        sentRequestId(res.config?.headers),
      );
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        "response" in err &&
        typeof (err as { response?: { status?: number } }).response?.status ===
          "number" &&
        (err as { response: { status: number } }).response.status === 404
      ) {
        return null;
      }
      throw err;
    }
  },

  /**
   * POST /v1/me/data-export/download-link
   * A fresh 5-minute link to the caller's latest export, minted for the
   * signed-in user only. 404 DATA_EXPORT_NOT_FOUND, 409
   * DATA_EXPORT_NOT_READY, 410 DATA_EXPORT_EXPIRED / DATA_EXPORT_FILE_MISSING.
   * A 2xx body that is not a usable download link throws
   * DataExportResponseError (never opened).
   */
  async createDownloadLink(): Promise<DataExportDownloadLink> {
    const res = await api.post<unknown>("/v1/me/data-export/download-link");
    return parseDownloadLink(res.data, sentRequestId(res.config?.headers));
  },
};

export default dataExportApi;
