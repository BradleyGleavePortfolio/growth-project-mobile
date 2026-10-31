import { dayForNewLog } from '../logDay';

// FOOD-1-M R2 (operator ruling, the owner's S1): the shared day rule every food and water save calls.
describe('FOOD-1-M R2 dayForNewLog', () => {
  it('a day put on screen as today goes to the new today once the calendar has moved past midnight', () => {
    expect(dayForNewLog({ selectedDate: '2026-10-29', selectedOn: '2026-10-29' }, '2026-10-30')).toBe('2026-10-30');
  });

  it('before midnight the day on screen is kept', () => {
    expect(dayForNewLog({ selectedDate: '2026-10-29', selectedOn: '2026-10-29' }, '2026-10-29')).toBe('2026-10-29');
  });

  it('a day the member chose stays chosen after midnight, past or future', () => {
    expect(dayForNewLog({ selectedDate: '2026-10-27', selectedOn: '2026-10-29' }, '2026-10-30')).toBe('2026-10-27');
    expect(dayForNewLog({ selectedDate: '2026-10-31', selectedOn: '2026-10-29' }, '2026-10-30')).toBe('2026-10-31');
  });

  it('a clock that goes back never moves the day backwards', () => {
    expect(dayForNewLog({ selectedDate: '2026-10-30', selectedOn: '2026-10-30' }, '2026-10-29')).toBe('2026-10-30');
  });

  it('a day with no record of when it was put on screen is kept as shown', () => {
    expect(dayForNewLog({ selectedDate: '2026-10-29' }, '2026-10-30')).toBe('2026-10-29');
  });

  it('a save with no day on screen (a plan button that always logs today) goes to today', () => {
    expect(dayForNewLog(undefined, '2026-10-30')).toBe('2026-10-30');
  });
});
