/**
 * FIX-974R2 (LS-974R2 B1): the summary's week ring keeps C2_summary's 176 pt where the page has room for it and is
 * smaller on a shorter screen, so the opening view holds the whole meter and note above Send. `room` is the window
 * height less the top and bottom insets (the harness's 390 by 844 iOS: 844 - 47 - 34; 360 by 800 Android: 800 - 24 - 24).
 */
import { ringSize } from '../WorkoutSummaryC5';

describe('FIX-974R2 ringSize', () => {
  it.each([
    ['iPhone 390 by 844 (drawn)', 844 - 47 - 34, 176],
    ['Android 390 by 844', 844 - 24 - 24, 176],
    ['Android 360 by 800 (drawn)', 800 - 24 - 24, 160],
    ['iPhone mini 375 by 812', 812 - 50 - 34, 144],
    ['iPhone SE 375 by 667', 667 - 20, 144],
    ['a tall screen', 1334, 176],
  ])('%s: room %d draws a %d pt ring', (_name, room, size) => {
    expect(ringSize(room)).toBe(size);
  });

  it('never draws below 144 pt, the size that still holds "2 of 4" inside the ring', () => {
    expect(ringSize(0)).toBe(144);
  });
});
