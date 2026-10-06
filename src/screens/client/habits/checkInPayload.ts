/**
 * The body for POST /check-ins. The server DTO accepts exactly these keys and
 * rejects any other (ValidationPipe forbidNonWhitelisted), so a stray field
 * fails the whole save with a 400. Keep this list equal to CreateCheckInDto.
 */
export const CHECK_IN_KEYS = ['date', 'mood', 'energy', 'sleep_hours', 'weight_kg', 'notes'] as const;

export function buildCheckInPayload(form: {
  date: string;
  mood: number;
  energy: number;
  sleepHours: number;
  notes: string;
}): { date: string; mood: number; energy: number; sleep_hours: number; notes: string | null } {
  return {
    date: form.date,
    mood: form.mood,
    energy: form.energy,
    sleep_hours: form.sleepHours,
    notes: form.notes || null,
  };
}
