/**
 * S-MWB-4 (OR-112-18): what the builder says when the server refuses a save
 * for access (HTTP 403 on PATCH /workout-plans/:id/autosave).
 *
 * The backend applies the Programs library's owner and visibility rules to
 * autosave: a library program is edited only by the coach who made it, a
 * client's copy only by the head coach or a sub-coach who holds that client,
 * and a standalone workout only by its own coach. Each refusal carries a
 * stable machine code; this maps every one to copy that says what happened
 * and the next step (no first person, no exclamation marks).
 */
import type { AutosaveRefusal } from "../../hooks/useAutosave";

export const AUTOSAVE_REFUSAL_COPY = {
  program_read_only:
    "This program belongs to another coach on your team, so these changes are not saved. Duplicate it in Programs to make your own copy.",
  client_not_assigned:
    "This client is not assigned to you, so these changes are not saved. Ask your head coach to assign the client to you.",
  plan_not_yours:
    "This workout belongs to your head coach, so these changes are not saved. Build your own in Programs, or ask your head coach to share a program with the team.",
  plan_access_denied:
    "This workout is not shared with you, so these changes are not saved. Ask the coach who made it to share it with your team.",
} as const;

export type AutosaveRefusalCode = keyof typeof AUTOSAVE_REFUSAL_COPY;

function isKnownCode(code: string | null): code is AutosaveRefusalCode {
  return code !== null && Object.prototype.hasOwnProperty.call(AUTOSAVE_REFUSAL_COPY, code);
}

/**
 * Copy for a refused save. A 403 without a known code (an older backend, or
 * a foreign tenant) is still a definite access refusal, so it gets the
 * not-shared copy rather than an "offline, will sync" promise.
 */
export function describeAutosaveRefusal(refusal: AutosaveRefusal): string {
  return isKnownCode(refusal.code)
    ? AUTOSAVE_REFUSAL_COPY[refusal.code]
    : AUTOSAVE_REFUSAL_COPY.plan_access_denied;
}
