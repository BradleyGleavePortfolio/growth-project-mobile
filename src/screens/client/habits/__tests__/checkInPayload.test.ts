/**
 * AUDIT-06-125 B2: POST /check-ins rejects any key its DTO does not list
 * (forbidNonWhitelisted). Main sent sleep_quality and stress, so every daily
 * check-in save failed with a 400.
 */
import { buildCheckInPayload, CHECK_IN_KEYS } from '../checkInPayload';

describe('buildCheckInPayload', () => {
  it('sends only keys the server accepts', () => {
    const body = buildCheckInPayload({
      date: '2026-10-06',
      mood: 4,
      energy: 3,
      sleepHours: 7.5,
      notes: 'Slept well',
    });
    const allowed: readonly string[] = CHECK_IN_KEYS;
    for (const key of Object.keys(body)) {
      expect(allowed).toContain(key);
    }
    expect(body).toEqual({
      date: '2026-10-06',
      mood: 4,
      energy: 3,
      sleep_hours: 7.5,
      notes: 'Slept well',
    });
  });

  it('sends null notes when the box is empty', () => {
    const body = buildCheckInPayload({ date: '2026-10-06', mood: 3, energy: 3, sleepHours: 7, notes: '' });
    expect(body.notes).toBeNull();
    expect(Object.keys(body)).not.toContain('sleep_quality');
    expect(Object.keys(body)).not.toContain('stress');
  });
});
