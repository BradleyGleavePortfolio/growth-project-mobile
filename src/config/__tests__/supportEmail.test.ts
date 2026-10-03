/**
 * S-SCHED-4 B-325-3: the support destination is the owner-ruled address
 * (2026-10-01 14:19 PDT, "Support email: Bradleyapple1031@gmail.com"; one
 * SUPPORT_EMAIL everywhere). Pinned to the ruling's literal, not to the
 * constant, so a wrong constant fails here.
 */
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
import * as fs from 'fs';
import * as path from 'path';
import { SUPPORT_EMAIL, supportMailto } from '../../constants/support';
import { SUPPORT_EMAIL as CONSULTATION_SUPPORT_EMAIL } from '../../lib/consultation/copy';
import { calendarErrorMessage } from '../../calendar/schedulingErrors';
import { DELETION_SUPPORT_EMAIL, HELP_UNAVAILABLE_COPY } from '../../screens/settings/deletionErrors';

const RULED = 'Bradleyapple1031@gmail.com';

describe('support address (owner ruling)', () => {
  it('is the ruled address and the mailto targets it', () => {
    expect(SUPPORT_EMAIL).toBe(RULED);
    expect(supportMailto()).toBe(`mailto:${RULED}`);
    expect(supportMailto('Calendar help')).toBe(`mailto:${RULED}?subject=Calendar%20help`);
  });

  it('consultation, Calendar and deletion recovery copy all name the ruled address', () => {
    expect(CONSULTATION_SUPPORT_EMAIL).toBe(RULED);
    expect(DELETION_SUPPORT_EMAIL).toBe(RULED);
    expect(HELP_UNAVAILABLE_COPY).toContain(RULED);
    expect(calendarErrorMessage({ response: { status: 500 } }, 'load upcoming sessions')).toContain(RULED);
    expect(calendarErrorMessage({ response: { status: 500 } }, 'save time off', 'coach')).toContain(RULED);
  });

  it('the scheduling, calendar and deletion sources declare no other address', () => {
    const root = path.resolve(__dirname, '../..');
    const files = [
      'constants/support.ts',
      'lib/consultation/copy.ts',
      'calendar/schedulingErrors.ts',
      'calendar/phoneCalendar.ts',
      'screens/settings/deletionErrors.ts',
      'screens/client/calendar/CalendarHomeScreen.tsx',
      'screens/client/calendar/CalendarBookScreen.tsx',
      'screens/client/calendar/CalendarSessionScreen.tsx',
      'screens/coach/CoachBookingInboxScreen.tsx',
    ];
    for (const rel of files) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const addresses = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
      expect({ rel, others: addresses.filter((a) => a !== RULED) }).toEqual({ rel, others: [] });
    }
  });
});
