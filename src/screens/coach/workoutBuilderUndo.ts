/**
 * S-MWB-2 — builder undo / redo (session history over the autosave revisions).
 *
 * Every confirmed autosave writes one plan revision, so the state before a
 * save is `head_revision_index - 1`. The screen keeps two session stacks of
 * revision indexes: Undo moves the plan back to the newest entry of the undo
 * stack (the backend writes that state as a NEW head, cause `undo`) and puts
 * the head it left on the redo stack; Redo does the same in reverse ("undo to
 * the later index"). A new edit after an undo clears the redo stack, as it
 * does in other editors.
 *
 * Copy rules: say what happened and the next step; unknown failures carry a
 * reference, the support path and a Sentry event. Never a bare
 * "Something went wrong".
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
        message: `Your session has ended, so nothing was ${verb}. Sign in again, then use ${direction === "undo" ? "Undo" : "Redo"}.`,
        reference: null,
        dropHistory: false,
      };
    case "network":
      return {
        message: `The app could not reach the server, so nothing was ${verb}. Check your connection, then tap ${direction === "undo" ? "Undo" : "Redo"} again.`,
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
        message: `Nothing was ${verb} because of a problem on our side. Your workout is unchanged. If it happens again, contact support (Settings, Help) and quote reference ${reference}.`,
        reference,
        dropHistory: false,
      };
    }
  }
}

/** Copy for the case where a save is still on its way when Undo is tapped. */
export const HISTORY_WAIT_FOR_SAVE =
  "Your last change is still saving. Undo again once the status shows Saved.";

/** The undo landed but the refreshed workout did not load. */
export const HISTORY_REFRESH_FAILED =
  "The change was undone, but the updated workout did not load. Tap the status above to refresh it before editing.";
