/**
 * Error copy for account deletion, data export and help links (owner rule
 * 13:34: no vague errors). Every failure says what happened and gives a next
 * step that works. Known statuses and codes get specific copy. Anything else
 * shows a short reference, gives the support address and is reported to
 * Sentry. The status code and the machine `code` are read; the server's
 * message text is used only to recognise the auth guard's own 401s.
 */
import { SUPPORT_EMAIL } from "../../config/support";
import { captureError } from "../../services/sentry";

export const DELETION_SUPPORT_EMAIL = SUPPORT_EMAIL;

export type DeletionAction =
  "check" | "confirm" | "schedule" | "cancel" | "export";

const WHAT: Record<DeletionAction, string> = {
  check: "check your account deletion status",
  confirm: "confirm it is you",
  schedule: "schedule your account deletion",
  cancel: "cancel the deletion",
  export: "start your data export",
};

interface ResponseShape {
  status?: number;
  data?: unknown;
  headers?: unknown;
}

function field(obj: unknown, key: string): unknown {
  return typeof obj === "object" && obj !== null
    ? Reflect.get(obj, key)
    : undefined;
}

function responseOf(err: unknown): ResponseShape | null {
  const r = field(err, "response");
  if (typeof r !== "object" || r === null) return null;
  const status = field(r, "status");
  return {
    status: typeof status === "number" ? status : undefined,
    data: field(r, "data"),
    headers: field(r, "headers"),
  };
}

export function errorStatusOf(err: unknown): number | undefined {
  return responseOf(err)?.status;
}

export function errorCodeOf(err: unknown): string | undefined {
  const code = field(responseOf(err)?.data, "code");
  return typeof code === "string" ? code : undefined;
}

/** First 8 characters of the server request id (body or response header). */
export function errorReference(err: unknown): string | null {
  const res = responseOf(err);
  const fromBody = field(res?.data, "request_id");
  const fromHeader = field(res?.headers, "x-request-id");
  const fromRequest = field(
    field(field(err, "config"), "headers"),
    "X-Request-Id",
  );
  const id = [fromBody, fromHeader, fromRequest].find(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return id ? id.replace(/-/g, "").slice(0, 8) : null;
}

const GUARD_401 =
  /invalid or expired token|no authentication token|token missing subject|user not found/i;

/**
 * A 401 from the backend auth guard (the session itself ended), as opposed to
 * a 401 for a rejected password or provider proof (C-313-6).
 */
export function isSessionEnded401(err: unknown): boolean {
  const res = responseOf(err);
  if (res?.status !== 401) return false;
  if (errorCodeOf(err) === "USER_NOT_FOUND") return true;
  const message = field(res.data, "message");
  return typeof message === "string" && GUARD_401.test(message);
}

export const RECENT_AUTH_EXPIRED_COPY =
  "The check that it is you has expired. Confirm it is you again, then send the request.";

export const SESSION_ENDED_COPY =
  "Your sign-in on this phone has ended. Sign out, sign in again, then come back here.";

export function deletionErrorCopy(
  err: unknown,
  action: DeletionAction,
  where: string,
): string {
  const res = responseOf(err);
  if (!res || res.status === undefined) {
    return `We could not reach the server to ${WHAT[action]}. Check your connection, then try again.`;
  }
  if (res.status === 429)
    return "Too many attempts in a short time. Wait a minute, then try again.";
  if (isSessionEnded401(err)) return SESSION_ENDED_COPY;
  // POST /me/delete-account: the recent-auth proof was missing, expired or
  // already used (RecentAuthGuard 401, or 403 RECENT_AUTH_TOKEN_ALREADY_USED).
  if (
    action === "schedule" &&
    (res.status === 401 ||
      field(res.data, "error") === "RECENT_AUTH_TOKEN_ALREADY_USED")
  ) {
    return RECENT_AUTH_EXPIRED_COPY;
  }
  if (res.status === 409 && action === "cancel") {
    return "Your deletion is already being finished, so it can no longer be cancelled.";
  }
  const reference = errorReference(err);
  captureError(err, {
    where,
    status: res.status,
    code: errorCodeOf(err),
    reference,
  });
  const ref = reference ? ` Reference: ${reference}.` : "";
  return `We could not ${WHAT[action]} because of a problem on our side.${ref} Try again in a few minutes, or write to ${DELETION_SUPPORT_EMAIL}${reference ? " and mention the reference" : ""}.`;
}

export const HELP_UNAVAILABLE_COPY = `The help centre did not open on this phone. Write to ${DELETION_SUPPORT_EMAIL} and we will help.`;
