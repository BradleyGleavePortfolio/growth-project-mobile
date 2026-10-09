/**
 * Server answer for a client with no coach on a Roman route (owner
 * 2026-10-09 00:0x: "lock roman usage away for coachless clients with
 * explanation"): 403 { error: 'ROMAN_REQUIRES_COACH', action: 'JOIN_COACH' }.
 * The app shows the same calm "Join a coach" state as its own coachless check.
 */
export const ROMAN_REQUIRES_COACH_CODE = 'ROMAN_REQUIRES_COACH';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** True for a 403 whose body names ROMAN_REQUIRES_COACH (in `error` or `code`). */
export function romanRequiresCoachFromHttp(status: number | null | undefined, body: unknown): boolean {
  if (status !== 403 || !isRecord(body)) return false;
  return body.error === ROMAN_REQUIRES_COACH_CODE || body.code === ROMAN_REQUIRES_COACH_CODE;
}

/** The same check on an axios-style error (`err.response.{status,data}`). */
export function romanRequiresCoachOf(err: unknown): boolean {
  if (!isRecord(err) || !isRecord(err.response)) return false;
  const status = typeof err.response.status === 'number' ? err.response.status : null;
  return romanRequiresCoachFromHttp(status, err.response.data);
}
