/**
 * S-MWB — specific, recoverable copy for every Programs API failure.
 *
 * Known backend codes map to a sentence that says what happened and what to
 * do next. Anything else is an unknown failure: it gets a short reference (the
 * server request_id when present), a support path, and a Sentry event under
 * the same reference. Never a bare "Something went wrong".
 */
import { captureError } from "../services/sentry";
import { extractRequestId } from "./correlation";
import { randomUuid } from "./idempotency";

export interface ProgramFailure {
  code: string | null;
  status: number | null;
  message: string;
  /** Short reference to quote to support (unknown failures only). */
  reference: string | null;
  /** The screen should offer Contact support. */
  support: boolean;
  /** Reloading the screen's data is the right recovery (stale version, etc.). */
  reload: boolean;
  /**
   * A specific next step the failure box offers: sign in again (the session
   * ended) or wait before retrying (rate limited). Null when Retry / Contact
   * support cover it.
   */
  recovery?: "sign_in" | "wait" | null;
}

/**
 * True when the request may or may not have been applied: no response at
 * all (connection lost, timeout) or a server-side failure. The caller must
 * keep the request key and body so a retry replays instead of duplicating.
 * A 4xx answer is a definite refusal: nothing was applied.
 */
export function isOutcomeUnknown(err: unknown): boolean {
  if (!err || typeof err !== "object") return true;
  const response = (err as { response?: { status?: unknown } }).response;
  if (!response) return true;
  const status = typeof response.status === "number" ? response.status : null;
  return status === null || status >= 500 || status === 408;
}

const KNOWN: Record<string, { message: string; reload?: boolean }> = {
  programs_unavailable: {
    message:
      "Programs are not switched on for your account yet. Your existing templates still work; contact support if you expected to see Programs.",
  },
  program_not_found: {
    message:
      "This program no longer exists or is not shared with you. Go back to the library to pick another.",
    reload: true,
  },
  program_read_only: {
    message:
      "This program belongs to another coach on your team. Duplicate it to make your own editable copy.",
  },
  program_archived: {
    message:
      "This program is archived. Restore it first, then edit or assign it.",
    reload: true,
  },
  program_version_conflict: {
    message:
      "This program changed on another device. We reloaded the latest version; make your change again.",
    reload: true,
  },
  program_days_out_of_range: {
    message:
      "Some workouts sit in the weeks you are removing. Clear those days first, or keep more weeks.",
  },
  program_day_out_of_range: {
    message: "That day is outside this program. Add weeks first.",
  },
  program_day_filled: {
    message:
      "That day already has a workout. Open it to edit, or clear it first.",
    reload: true,
  },
  saved_workout_required: {
    message: "Pick a saved workout to copy into this day.",
  },
  saved_workout_not_found: {
    message:
      "That saved workout was removed or is not yours. Pick another from the list.",
    reload: true,
  },
  copy_day_required: { message: "Pick the day you want to copy." },
  copy_day_empty: {
    message: "The day you picked has no workout to copy. Pick a filled day.",
  },
  program_in_package_needs_a_day: {
    message:
      "A package delivers this program, so it must keep at least one workout. Add another day before clearing this one, or remove the program from the package.",
  },
  program_in_package: {
    message:
      "A live package delivers this program, so it cannot be archived. Remove it from the package first (Packages tab).",
  },
  program_empty: {
    message:
      "Add at least one workout day before assigning this program or adding it to a package.",
  },
  PROGRAM_EMPTY: {
    message:
      "Add at least one workout day before adding this program to a package.",
  },
  PROGRAM_ARCHIVED: {
    message:
      "This program is archived. Restore it before adding it to a package.",
  },
  REGIME_ARCHIVED: {
    message:
      "This regime is archived. Restore it before adding it to a package.",
  },
  invalid_start_date: {
    message: "Enter the start date as YYYY-MM-DD, for example 2026-10-05.",
  },
  program_already_assigned: {
    message:
      'Already running this program. Turn on "Assign again" to give them a second run.',
  },
  program_not_assigned: {
    message: "This client is not on this program any more.",
    reload: true,
  },
  not_your_client: {
    message:
      "Not one of your clients (or outside your team scope), so nothing was assigned.",
  },
  client_not_found: {
    message: "This client account no longer exists, so nothing was assigned.",
  },
  coach_role_required: {
    message:
      "Only coaches can manage programs. Sign in with your coach account.",
  },
  account_not_found: {
    message:
      "Your session no longer matches an account. Sign out and sign in again.",
  },
  idempotency_key_required: {
    message:
      "The app did not send a request key. Update the app; contact support if it keeps happening.",
  },
  IDEMPOTENCY_CONFLICT: {
    message:
      "A previous attempt of this action is still finishing. Wait a few seconds, then reload.",
    reload: true,
  },
  ASSET_ALREADY_IN_PACKAGE: {
    message: "This program is already in that package.",
    reload: true,
  },
  ASSET_NOT_FOUND: {
    message:
      "The package could not find this program. Reload and pick it again; contact support if it persists.",
    reload: true,
  },
  NOT_YOUR_PACKAGE: { message: "That package belongs to another coach." },
  PACKAGE_NOT_FOUND: {
    message: "That package was removed. Reload the package list.",
    reload: true,
  },
};

interface ErrorEnvelope {
  status: number | null;
  code: string | null;
  message: string | null;
}

function readEnvelope(err: unknown): ErrorEnvelope {
  if (!err || typeof err !== "object")
    return { status: null, code: null, message: null };
  const response = (err as { response?: { status?: unknown; data?: unknown } })
    .response;
  const status = typeof response?.status === "number" ? response.status : null;
  const data = response?.data;
  let code: string | null = null;
  let message: string | null = null;
  if (data && typeof data === "object") {
    const d = data as { code?: unknown; error?: unknown; message?: unknown };
    if (typeof d.code === "string" && d.code !== "") code = d.code;
    else if (typeof d.error === "string" && /^[A-Za-z_]+$/.test(d.error))
      code = d.error;
    if (typeof d.message === "string") message = d.message;
    else if (Array.isArray(d.message)) {
      // Nest DTO validation sends a list of field messages.
      const parts = d.message.filter(
        (m): m is string => typeof m === "string" && m !== "",
      );
      if (parts.length > 0) message = parts.join("; ");
    }
  }
  return { status, code, message };
}

function shortRef(full: string): string {
  return (
    full
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase() || "UNKNOWN"
  );
}

/**
 * Describe a failed Programs action. `action` is a short verb phrase used in
 * the unknown-failure copy and the Sentry event ("assign the program").
 */
export function describeProgramFailure(
  err: unknown,
  action: string,
): ProgramFailure {
  const env = readEnvelope(err);
  const known = env.code ? KNOWN[env.code] : undefined;
  if (known) {
    return {
      code: env.code,
      status: env.status,
      message: known.message,
      reference: null,
      support:
        env.code === "programs_unavailable" ||
        env.code === "idempotency_key_required",
      reload: known.reload === true,
    };
  }
  if (env.status === 401) {
    return {
      code: env.code,
      status: 401,
      message: `Could not ${action}: your session has ended. Sign in again to carry on; anything already saved is kept.`,
      reference: null,
      support: false,
      reload: false,
      recovery: "sign_in",
    };
  }
  if (env.status === 429) {
    return {
      code: env.code,
      status: 429,
      message: `Could not ${action}: too many requests in a short time. Wait a minute, then retry.`,
      reference: null,
      support: false,
      reload: false,
      recovery: "wait",
    };
  }
  const isNetwork =
    !!err &&
    typeof err === "object" &&
    !(err as { response?: unknown }).response;
  const full = extractRequestId(err) ?? randomUuid();
  const reference = shortRef(full);
  captureError(err, {
    area: "programs",
    action,
    status: env.status,
    code: env.code,
    reference: full,
  });
  if (isNetwork) {
    return {
      code: null,
      status: null,
      message: `Could not ${action}: the app could not reach the server. Check your connection and retry. Reference ${reference}.`,
      reference,
      support: true,
      reload: false,
    };
  }
  if (env.status === 403) {
    return {
      code: env.code,
      status: 403,
      message: `Could not ${action}: your account does not have access to this. If you think it should, contact support and quote reference ${reference}.`,
      reference,
      support: true,
      reload: false,
    };
  }
  if (env.status === 400 && env.message) {
    // A request the server refused as invalid (DTO validation). Show its
    // reason, and keep the reference + support path in case the app sent it.
    return {
      code: env.code,
      status: env.status,
      message: `Could not ${action}: ${env.message.replace(/[.\s]+$/, "")}. If this keeps happening, contact support and quote reference ${reference}.`,
      reference,
      support: true,
      reload: false,
    };
  }
  return {
    code: env.code,
    status: env.status,
    message: `Could not ${action} because of a problem on our side. Retry; if it happens again, contact support and quote reference ${reference}.`,
    reference,
    support: true,
    reload: false,
  };
}

/** Per-client bulk-assign outcome copy (server message wins when present). */
export function bulkResultCopy(
  code: string | undefined,
  serverMessage: string | undefined,
): string {
  if (code && KNOWN[code]) return KNOWN[code].message;
  if (serverMessage) return serverMessage;
  return "Not assigned. Retry this client; contact support if it fails again.";
}
