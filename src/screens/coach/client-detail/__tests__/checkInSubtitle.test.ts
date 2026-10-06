/**
 * AUDIT-06-125 U2: the coach client Timeline read `mood_rating` (not a CheckIn
 * field), so every check-in said "Mood: undefined/5".
 */
jest.mock('../../../../services/api', () => ({ coachApi: {} }));

import { checkInSubtitle } from '../useClientDetailData';

describe('checkInSubtitle', () => {
  it('shows the client note when there is one', () => {
    expect(checkInSubtitle({ notes: 'Knee sore', mood: 2 })).toBe('Knee sore');
  });

  it('shows the real scores from a server check-in row', () => {
    expect(checkInSubtitle({ notes: null, mood: 4, energy: 3, sleep_hours: 7.5 })).toBe(
      'Mood 4/5 · Energy 3/5 · Sleep 7.5 h',
    );
  });

  it('never prints undefined', () => {
    expect(checkInSubtitle({})).toBe('Check-in submitted');
  });
});
