/**
 * S-SCHED-4 follow-up: the Concierge Phase 1 ClientBookingRequest route had
 * no entry point (nothing navigated to it) and is superseded by the Calendar
 * tab's booking flow, so it is gone: no route, no param, no screen file.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '../..');

it('the client navigator no longer registers ClientBookingRequest, and the screen file is removed', () => {
  const nav = fs.readFileSync(path.join(SRC, 'navigation/ClientNavigator.tsx'), 'utf8');
  expect(nav).not.toMatch(/name="ClientBookingRequest"/);
  expect(nav).not.toMatch(/ClientBookingRequest:\s/);
  expect(nav).not.toMatch(/import ClientBookingRequestScreen/);
  expect(fs.existsSync(path.join(SRC, 'screens/client/ClientBookingRequestScreen.tsx'))).toBe(false);
  // Calendar booking stays registered.
  expect(nav).toMatch(/name="CalendarBook"/);
});
