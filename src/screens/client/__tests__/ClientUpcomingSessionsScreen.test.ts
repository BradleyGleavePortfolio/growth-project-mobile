/**
 * ClientUpcomingSessionsScreen — Lane 4 unit coverage for the
 * P3-3 server-authoritative cancellable rule (R16).
 *
 * The hunt finding was: a device-clock-only lockout lets a user with a
 * backdated clock cancel inside the 4h window. The fix is to prefer
 * `session.cancellable` (when the backend provides it) over the local
 * `isWithinLockout` heuristic, with the heuristic kept as a defensive
 * fallback for backends that have not yet shipped the field.
 */

import {
  isSessionLocked,
  isWithinLockout,
} from '../ClientUpcomingSessionsScreen';

describe('ClientUpcomingSessionsScreen — lockout resolution', () => {
  const FOUR_HOURS = 4 * 60 * 60 * 1000;
  const now = new Date('2026-05-21T12:00:00Z');
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const inTenHours = new Date(now.getTime() + 10 * 60 * 60 * 1000).toISOString();

  it('isWithinLockout: < 4h away → locked', () => {
    expect(isWithinLockout(now, inOneHour)).toBe(true);
  });

  it('isWithinLockout: > 4h away → unlocked', () => {
    expect(isWithinLockout(now, inTenHours)).toBe(false);
  });

  it('isSessionLocked prefers server cancellable=false over device clock', () => {
    // Server says NOT cancellable. Device clock says >4h away (would
    // otherwise be unlocked). Server wins — locked.
    expect(
      isSessionLocked({ start_at: inTenHours, cancellable: false }, now),
    ).toBe(true);
  });

  it('isSessionLocked prefers server cancellable=true over device clock', () => {
    // Server says cancellable. Device clock says <4h away (would
    // otherwise be locked). Server wins — unlocked.
    expect(
      isSessionLocked({ start_at: inOneHour, cancellable: true }, now),
    ).toBe(false);
  });

  it('isSessionLocked falls back to device-clock when cancellable is absent (rollout window)', () => {
    expect(isSessionLocked({ start_at: inOneHour }, now)).toBe(true);
    expect(isSessionLocked({ start_at: inTenHours }, now)).toBe(false);
  });

  it('isSessionLocked: a backdated device clock cannot bypass the server flag', () => {
    // The user has set their device clock to "yesterday" (now-24h). On a
    // pure device-clock check the session looks ~16h away and would be
    // unlocked. Server says NOT cancellable → must stay locked.
    const backdatedNow = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sessionFourHoursFromRealNow = new Date(
      now.getTime() + FOUR_HOURS - 60 * 1000,
    ).toISOString();
    expect(
      isSessionLocked(
        { start_at: sessionFourHoursFromRealNow, cancellable: false },
        backdatedNow,
      ),
    ).toBe(true);
  });
});
