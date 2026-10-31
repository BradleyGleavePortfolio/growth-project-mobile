/**
 * @jest-environment ./src/__tests__/helpers/lo917Tokyo.cjs
 *
 * LO-917 B1, Tokyo half: a package workout bought Tuesday 08:00 JST is stored
 * as Monday 23:00 UTC; it is Tuesday's workout, not yesterday's.
 */
import { assignmentDay } from '../utils/workout/workoutDay';

it('LO-917 B1: a package workout bought Tuesday 08:00 Tokyo counts on Tuesday', () => {
  expect(new Date('2026-10-26T23:00:00.000Z').getTimezoneOffset()).toBe(-540);
  expect(assignmentDay({ scheduled_for: '2026-10-27T00:00:00.000Z' })).toBe('2026-10-27');
  expect(assignmentDay({ scheduled_for: '2026-10-27T12:00:00.000Z' })).toBe('2026-10-27');
  expect(assignmentDay({ scheduled_for: '2026-10-26T23:00:00.000Z' })).toBe('2026-10-27');
});
