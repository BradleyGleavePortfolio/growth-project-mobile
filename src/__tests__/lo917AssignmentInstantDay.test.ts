/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 *
 * LO-917 B1 (agent 189, Opus lens of m#917 @ 7671c9f4): scheduled_for is a
 * timestamp on the server (ClientWorkoutAssignment.scheduled_for DateTime, no
 * @db.Date). Some writers store a calendar day (assignPlan with YYYY-MM-DD ->
 * UTC midnight; program-library startDateToInstant -> 12:00 UTC), but a
 * package purchase stores the moment it fired: WorkoutAssetResolver
 * scheduled_for = new Date(Date.now()), and ProgramDeliveryService
 * startAt = now, each day = startAt + n days. The coach's week view
 * (coach.service clientWeek) buckets those in the client's zone. Reading the
 * UTC date part as the day moves every evening purchase in the US to the
 * next day.
 */
import { assignmentDay } from '../utils/workout/workoutDay';
import { trainDial } from '../components/home/rings/homeRings';

it('LO-917 B1: a package workout bought Monday 18:30 Pacific counts on Monday, as the coach week sees it', () => {
  expect(new Date('2026-10-27T01:30:00.000Z').getTimezoneOffset()).toBe(420);
  // Calendar-day writers keep their day (green at the head already).
  expect(assignmentDay({ scheduled_for: '2026-10-26' })).toBe('2026-10-26');
  expect(assignmentDay({ scheduled_for: '2026-10-26T00:00:00.000Z' })).toBe('2026-10-26');
  expect(assignmentDay({ scheduled_for: '2026-10-26T12:00:00.000Z' })).toBe('2026-10-26');
  // Package purchase, Monday 26 Oct 18:30 PDT = 27 Oct 01:30 UTC.
  expect(assignmentDay({ scheduled_for: '2026-10-27T01:30:00.000Z' })).toBe('2026-10-26');
});

it('LO-917 B1: Home weekly total keeps a package workout bought Sunday evening in that week', () => {
  // Sunday 25 Oct 20:00 PDT; week Mon 19 .. Sun 25. Bought 19:00 PDT Sunday.
  const now = new Date('2026-10-26T03:00:00.000Z');
  const inWeek = trainDial({ now, assignments: [{ scheduled_for: '2026-10-25T00:00:00.000Z', completed_at: null }], history: [], daysPerWeek: 3, loading: false });
  const bought = trainDial({ now, assignments: [{ scheduled_for: '2026-10-26T02:00:00.000Z', completed_at: null }], history: [], daysPerWeek: 3, loading: false });
  expect(bought.value).toBe(inWeek.value);
});
