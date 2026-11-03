/**
 * 1TO1-FU-M (#185-S1 op 1, LS-1TO1R3 C1): one reading of "this coach cannot take you", shared by every
 * phone surface that reads a refused join (the code sheet and Settings through coachlessFailureOf, day-one
 * pairing, the signup retry, the pending-invite banner).
 *
 * The server says it with the coachless code `coach_not_accepting` (growth-project-backend
 * src/coachless/coachless.errors.ts) or the attach code `coach_not_accepting_clients`
 * (src/invite-codes/invite-codes.service.ts), at any refusal status. Until 1TO1-FU-BE deploys, backend main
 * answers the same refusal with 404 PACKAGE_NOT_FOUND (in `error`, or in `code` on the checkout envelope).
 * Both the status and the body are read, so the phone is right before and after that deploy. A 404 with none
 * of these (the coachless switch off, an older server) is not this refusal.
 */
const NOT_ACCEPTING_CODES: ReadonlySet<string> = new Set(['coach_not_accepting', 'coach_not_accepting_clients']);

function field(obj: unknown, key: string): unknown {
  return obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

/** True when a failed join call (an axios-style error) means the coach is not taking new clients. */
export function isCoachNotAcceptingRefusal(err: unknown): boolean {
  const response = field(err, 'response');
  const status = field(response, 'status');
  const data = field(response, 'data');
  const code = field(data, 'code');
  const reason = field(data, 'reason');
  if ([code, reason].some((v) => typeof v === 'string' && NOT_ACCEPTING_CODES.has(v))) return true;
  return status === 404 && (code === 'PACKAGE_NOT_FOUND' || field(data, 'error') === 'PACKAGE_NOT_FOUND');
}

/** A check answer's code that means the same (the attach spelling folds into the coachless one). */
export function isNotAcceptingCode(code: unknown): boolean {
  return typeof code === 'string' && NOT_ACCEPTING_CODES.has(code);
}
