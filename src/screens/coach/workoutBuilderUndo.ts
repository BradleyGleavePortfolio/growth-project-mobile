/**
 * S-MWB-2 / S-MWB-3 — builder undo / redo (session history over the autosave
 * revisions).
 *
 * Every confirmed autosave writes one plan revision, so the state before a
 * save is `head_revision_index - 1`. The screen keeps two session stacks of
 * revision indexes: Undo moves the plan back to the newest entry of the undo
 * stack (the backend writes that state as a NEW head, cause `undo`) and puts
 * the head it left on the redo stack; Redo does the same in reverse (“undo to
 * the later index”). A new edit after an undo clears the redo stack, as it
 * does in other editors.
 *
 * S-MWB-3 (B-328-5 / B-328-6): every request names the head it was made
 * against (`expected_head_index`), so the backend never restores twice. A
 * failure is either DEFINITE (the server refused: nothing changed) or its
 * outcome is UNKNOWN (no response, a timeout, a 5xx, an unreadable reply: the
 * undo may have landed). Only a definite refusal may say “nothing was undone”.
 * An unknown outcome keeps the editor paused and is resolved by asking again
 * with the same fence: a 200 means it applies now, a 409 `undo_head_moved`
 * means the head already moved and the screen adopts server truth.
 *
 * Copy rules: say what happened and the next step; unknown failures carry a
 * reference, the support path and a Sentry event. Never a bare
 * “Something went wrong”, and no first person.
 */
import { WorkoutAutosaveApiError } from "../../api/workoutAutosaveApi";
import { captureError } from "../../services/sentry";
import { extractRequestId } from "../../utils/correlation";
import { randomUuid } from "../../utils/idempotency";

export type HistoryDirection = "undo" | "redo";

export interface HistoryFailure {
  message: string;
  /** Short reference to quote to support (unknown failures only). */
  reference: string | null;
  /** The target revision is gone for good: drop that history. */
  dropHistory: boolean;
}

function shortRef(full: string): string {
  return (
    full
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase() || "UNKNOWN"
  );
}

function label(direction: HistoryDirection): string {
  return direction === "undo" ? "Undo" : "Redo";
}

/**
 * True when the request may have committed even though no success reached
 * the app: no response (offline, timeout, dropped connection), a 5xx, an
 * aborted request, a 200 whose body could not be read, or a non-HTTP error.
 * False for a definite refusal (401, 403, 404/410, other 4xx, a local
 * validation failure that was never sent) and for a parsed 409.
 */
export function isUnknownHistoryOutcome(err: unknown): boolean {
  if (!(err instanceof WorkoutAutosaveApiError)) return true;
  switch (err.kind) {
    case "network":
    case "server":
    case "aborted":
      return true;
    case "contract":
      // 400 = failed local validation, never sent. Anything else (200) = the
      // server answered but the reply did not match the contract.
      return err.status !== 400;
    case "unknown":
      return !(err.status >= 400 && err.status < 500);
    case "conflict":
      // A 409 is a definite answer. A fenced undo's parsed `undo_head_moved`
      // is handled by the caller; an unparsed 409 is still a refusal, EXCEPT
      // an `undo_head_moved` that lacks its head or lock token (B-356-1): the
      // head moved, maybe because this very undo landed, so it is unknown.
      return !err.headMoved && namesUndoHeadMoved(err.cause);
    default:
      return false;
  }
}

/** True when an axios-shaped error's 409 body names `undo_head_moved`. */
function namesUndoHeadMoved(cause: unknown): boolean {
  if (!cause || typeof cause !== "object") return false;
  const data = (cause as { response?: { data?: unknown } }).response?.data;
  if (!data || typeof data !== "object") return false;
  const d = data as { code?: unknown; error?: unknown };
  return d.code === "undo_head_moved" || d.error === "undo_head_moved";
}

/** Copy for a DEFINITE refusal: the server answered and nothing changed. */
export function describeHistoryFailure(
  err: unknown,
  direction: HistoryDirection,
): HistoryFailure {
  const verb = direction === "undo" ? "undone" : "redone";
  const kind = err instanceof WorkoutAutosaveApiError ? err.kind : null;
  switch (kind) {
    case "gone":
      return {
        message: `That earlier version is no longer kept (the builder keeps your last 30 changes), or undo is switched off for your account, so nothing was ${verb}. Your workout is unchanged.`,
        reference: null,
        dropHistory: true,
      };
    case "forbidden":
      return {
        message: `You no longer have access to edit this workout, so nothing was ${verb}. Ask the program owner to share it with you.`,
        reference: null,
        dropHistory: false,
      };
    case "unauthorized":
      return {
        message: `Your session has ended, so nothing was ${verb}. Sign in again, then use ${label(direction)}.`,
        reference: null,
        dropHistory: false,
      };
    case "conflict":
      return {
        message: `Another change to this workout was saving at the same moment, so nothing was ${verb}. Tap ${label(direction)} again.`,
        reference: null,
        dropHistory: false,
      };
    default: {
      const cause =
        err instanceof WorkoutAutosaveApiError ? (err.cause ?? err) : err;
      const full = extractRequestId(cause) ?? randomUuid();
      const reference = shortRef(full);
      captureError(err, {
        area: "workout-builder",
        action: direction,
        kind,
        reference: full,
      });
      return {
        message: `This ${label(direction)} was not accepted, so nothing was ${verb}. Your workout is unchanged. If it happens again, contact support (Settings, Help) and quote reference ${reference}.`,
        reference,
        dropHistory: false,
      };
    }
  }
}

/**
 * Copy for an UNKNOWN outcome. The editor stays paused until the app has
 * confirmed what the server holds (Check again). Network failures name the
 * connection; anything else also carries a reference, the support path and a
 * Sentry event.
 */
export function describeUnconfirmedHistory(
  err: unknown,
  direction: HistoryDirection,
): HistoryFailure {
  const verb = direction === "undo" ? "undone" : "redone";
  const kind = err instanceof WorkoutAutosaveApiError ? err.kind : null;
  if (kind === "network" || kind === "aborted") {
    return {
      message: `The app could not confirm whether the change was ${verb}. Editing is paused so nothing is lost. Check your connection, then tap Check again.`,
      reference: null,
      dropHistory: false,
    };
  }
  if (kind === "unauthorized") {
    return {
      message: `Your session has ended, so the app could not confirm whether the change was ${verb}. Editing is paused so nothing is lost. Sign in again, then open this workout to see the latest saved version.`,
      reference: null,
      dropHistory: false,
    };
  }
  const cause =
    err instanceof WorkoutAutosaveApiError ? (err.cause ?? err) : err;
  const full = extractRequestId(cause) ?? randomUuid();
  const reference = shortRef(full);
  captureError(err, {
    area: "workout-builder",
    action: `${direction}_unconfirmed`,
    kind,
    reference: full,
  });
  return {
    message: `The app could not confirm whether the change was ${verb}. Editing is paused so nothing is lost. Tap Check again. If this keeps happening, contact support (Settings, Help) and quote reference ${reference}.`,
    reference,
    dropHistory: false,
  };
}

/** Copy for the case where a save is still on its way when Undo is tapped. */
export const HISTORY_WAIT_FOR_SAVE =
  "Your last change is still saving. Undo again once the status shows Saved.";

/** The undo landed but the refreshed workout did not load. */
export const HISTORY_REFRESH_FAILED =
  "The change was undone, but the updated workout did not load. Editing is paused so nothing is lost. Check your connection, then tap Check again.";

/** A fenced retry found the head one step ahead: the earlier request landed. */
export const HISTORY_CONFIRMED_UNDO = "Undone. Redo puts the change back.";
export const HISTORY_CONFIRMED_REDO = "Redone.";

/**
 * A fenced request found the head further ahead than its own step (another
 * device or session saved in between). The screen shows the latest saved
 * version and resets the session history, which no longer matches it.
 */
export const HISTORY_EDITED_ELSEWHERE =
  "This workout was changed in another session, so Undo history was reset. You are looking at the latest saved version.";
