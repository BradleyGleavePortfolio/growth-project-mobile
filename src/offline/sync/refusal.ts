/**
 * WORKOUT-REFUSAL-M (203-P1 Style 2 "Tells you why"): what the server said when it refused a saved workout.
 *
 * Backend b#1256 (CONTRACT 7170540475): on POST /workouts and PUT /workouts/:id two refusals carry a stable
 * `code` and one plain `next_step` sentence beside today's keys: WORKOUT_INVALID (400; `message` is the
 * validation lines) and WORKOUT_NOT_FOUND (404, "Workout not found"). The phone keeps them with the parked
 * row and shows them where the refusal reaches the client. An answer without both keys (an older server, or
 * a refusal the server leaves uncoded) is not kept: today's behaviour (A5 rule 5).
 */
export interface WorkoutRefusal {
  status: number;
  code: string;
  /** The server's own words: `message`, or its first line when it is a list. */
  said: string;
  nextStep: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** The coded refusal in a failed request, or null when the answer has no code and next step. */
export function refusalOf(err: unknown): WorkoutRefusal | null {
  const res = (err as { response?: { status?: unknown; data?: unknown } } | null)?.response;
  const data = res?.data as Record<string, unknown> | null | undefined;
  if (typeof res?.status !== 'number' || !data || typeof data !== 'object') return null;
  const message = Array.isArray(data.message) ? data.message[0] : data.message;
  const refusal = { status: res.status, code: text(data.code), said: text(message), nextStep: text(data.next_step) };
  return refusal.code && refusal.nextStep ? refusal : null;
}

/** A refusal as stored with its row (the `refusal` column), or null. */
export function readRefusal(json: string | null | undefined): WorkoutRefusal | null {
  try {
    const r = JSON.parse(json ?? 'null') as Partial<WorkoutRefusal> | null;
    return r && typeof r.code === 'string' && typeof r.nextStep === 'string' && r.code && r.nextStep
      ? { status: Number(r.status) || 0, code: r.code, said: typeof r.said === 'string' ? r.said : '', nextStep: r.nextStep }
      : null;
  } catch {
    return null;
  }
}

/** WORKOUT_NOT_FOUND: the workout is gone from the server, so a resend cannot work; Remove is offered instead. */
export const canSendAgain = (refusal: WorkoutRefusal) => refusal.code !== 'WORKOUT_NOT_FOUND';

/**
 * The Style 2 card's lines: "The server said:" and the server's words in quotes, then its next step. WORKOUT_INVALID's
 * words are validation lines (a developer's sentence), so a client never reads them: the plain line `invalid` stands in
 * their place, then the next step (OPERATOR RULING 7208809287 item 3). Card, sheet and Finish alert all read these lines.
 */
export function refusalLines(refusal: WorkoutRefusal, copy: { said: string; invalid: string }): string[] {
  if (refusal.code === 'WORKOUT_INVALID') return [copy.invalid, refusal.nextStep];
  return [...(refusal.said ? [`${copy.said}\n“${refusal.said}”`] : []), refusal.nextStep];
}
