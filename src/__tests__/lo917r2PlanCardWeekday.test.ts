/**
 * @jest-environment ./src/__tests__/helpers/lsWorkoutPacific187.cjs
 *
 * LO-917R2 B1 (control for the render check): the plan card's weekday is a
 * change a client sees. A package workout bought Monday 18:30 Pacific is
 * stored as Tuesday 01:30 UTC; main read the text before "T" (Tuesday), the
 * head reads the local day (Monday).
 */
import { weekdayOf } from '../components/tutorial/PlanExplanationCard';

it('LO-917R2 B1: the plan card says Monday for a package workout bought Monday evening in Pacific', () => {
  expect(new Date('2026-10-27T01:30:00.000Z').getTimezoneOffset()).toBe(420);
  expect(weekdayOf('2026-10-27T01:30:00.000Z')).toBe('Monday');
  // Unchanged for a coach's pick (UTC midnight) and a date-only day.
  expect(weekdayOf('2026-10-27T00:00:00.000Z')).toBe('Tuesday');
  expect(weekdayOf('2026-10-27')).toBe('Tuesday');
});
