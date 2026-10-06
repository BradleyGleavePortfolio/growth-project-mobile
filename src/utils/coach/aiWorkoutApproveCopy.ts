/**
 * AUDIT-14-125 — truthful copy after a coach approves an AI workout program.
 *
 * POST /coach/ai/drafts/:id/approve on the production backend saves each
 * program day as a workout plan in the coach's library and assigns nothing
 * to the client. The screen used to say "Workout program assigned to <name>",
 * so the coach believed the client had a program they never received.
 *
 * A backend that also assigns the days returns `assigned_count` (number of
 * workouts scheduled for the client); only then does the copy say
 * "assigned". Any other response reads as saved to the library.
 */
export interface AiWorkoutApproveCopy {
  title: string;
  body: string;
}

export function aiWorkoutApproveCopy(
  clientName: string,
  result: { assigned_count?: unknown } | null | undefined,
): AiWorkoutApproveCopy {
  const raw = result?.assigned_count;
  const assigned = typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0;
  if (assigned > 0) {
    return {
      title: 'Assigned',
      body: `${assigned} ${assigned === 1 ? 'workout' : 'workouts'} assigned to ${clientName}.`,
    };
  }
  return {
    title: 'Saved to library',
    body: `The program is saved to your workout library. ${clientName} does not see it until it is assigned.`,
  };
}
