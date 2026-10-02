jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
import { captureError } from '../../services/sentry';
import { SUPPORT_EMAIL } from '../../config/support';
import {
  COACH_CODE_MESSAGES,
  SCHEDULING_CODE_MESSAGES,
  bookingOutcomeUncertain,
  calendarErrorMessage,
  shouldRefreshSlots,
} from '../schedulingErrors';

beforeEach(() => jest.clearAllMocks());

it.each([
  [401, /Log in again/], [402, /Membership/], [403, /assigned coach/],
  [404, /no longer available/], [400, /form fields/], [422, /form fields/],
  [409, /schedule changed/], [429, /Wait a minute/],
])('maps HTTP %s to a specific scheduling recovery action', (status, expected) => {
  expect(calendarErrorMessage({ response: { status } }, 'book')).toMatch(expected);
});

it.each([
  ['SLOT_TAKEN', /pick another/], ['SLOT_UNAVAILABLE', /pick another/],
  ['SESSION_IN_PAST', /later time/], ['COACH_NOT_ASSIGNED', /invite code/],
])('maps machine code %s before status copy', (code, expected) => {
  expect(calendarErrorMessage({ response: { status: 400, data: { code } } }, 'book')).toMatch(expected);
});

it('never says a timeout proves nothing was booked', () => {
  const err = { code: 'ETIMEDOUT' };
  expect(calendarErrorMessage(err, 'confirm booking')).toMatch(/check Calendar before sending another booking/);
  expect(bookingOutcomeUncertain(err)).toBe(true);
  expect(bookingOutcomeUncertain({ response: { status: 503 } })).toBe(true);
  expect(bookingOutcomeUncertain({ response: { status: 409 } })).toBe(false);
});

it('unknown failures carry a short server reference and redact raw diagnostic content', () => {
  const err = {
    response: { status: 500, data: { request_id: 'req-123456789012345', private: 'not diagnostic' } },
    config: { headers: { Authorization: 'secret' } },
  };
  expect(calendarErrorMessage(err, 'book')).toMatch(/reference req-12345678/);
  expect(calendarErrorMessage(err, 'book')).toMatch(/We could not book/);
  const [, metadata] = jest.mocked(captureError).mock.calls[0];
  expect(metadata).toEqual({ area: 'calendar', audience: 'client', status: 500, code: null, request_id: 'req-12345678' });
  expect(JSON.stringify(metadata)).not.toMatch(/secret|not diagnostic|Authorization/);
});

// S-SCHED-2: every backend scheduling code has its own next-step copy.
const BACKEND_CODES = [
  'SESSION_TYPE_REQUIRED', 'SESSION_TYPE_UNAVAILABLE', 'DURATION_MISMATCH', 'SESSION_IN_PAST',
  'BEYOND_BOOKING_HORIZON', 'INVALID_TIME', 'SLOT_UNAVAILABLE', 'SLOT_TAKEN', 'CALENDAR_BUSY',
  'PENDING_REQUEST_LIMIT', 'WELCOME_ALREADY_BOOKED', 'SESSION_STATE_CHANGED', 'SESSION_NOT_ACTIVE',
  'SESSION_STARTED', 'COACH_NOT_BOOKABLE', 'COACH_NOT_FOUND', 'SESSION_NOT_FOUND',
  'NOT_SESSION_PARTICIPANT', 'INVALID_MEETING_LINK',
  // S-SCHED-3 (backend #634 fix round)
  'SESSION_MOVED', 'INVALID_LIST_QUERY',
];

it.each(BACKEND_CODES)('backend code %s has plain, specific copy', (code) => {
  const msg = calendarErrorMessage({ response: { status: 409, data: { code, error: code, message: 'server text' } } }, 'book');
  expect(msg).toBe(SCHEDULING_CODE_MESSAGES[code]);
  expect(msg).not.toMatch(/!|Something went wrong|server text/);
  // A complete sentence that names the next step, not a bare status.
  expect(msg).toMatch(/\.$/);
  expect(msg.length).toBeGreaterThan(30);
});

it('reads the code from `error` when only that is present', () => {
  expect(calendarErrorMessage({ response: { status: 409, data: { error: 'SLOT_TAKEN' } } }, 'book')).toMatch(/Someone just booked/);
});

it('CALENDAR_BUSY is a definite not-booked; slot codes refresh the list', () => {
  const busy = { response: { status: 503, data: { code: 'CALENDAR_BUSY' } } };
  expect(bookingOutcomeUncertain(busy)).toBe(false);
  expect(shouldRefreshSlots({ response: { status: 409, data: { code: 'SLOT_TAKEN' } } })).toBe(true);
  expect(shouldRefreshSlots({ response: { status: 400, data: { code: 'SLOT_UNAVAILABLE' } } })).toBe(true);
  expect(shouldRefreshSlots({ response: { status: 400, data: { code: 'PENDING_REQUEST_LIMIT' } } })).toBe(false);
});

// S-SCHED-3 B-325-2: coach screens get coach-worded copy, never "your coach".
describe('coach audience', () => {
  const COACH_CODES = [
    'SESSION_STARTED', 'SESSION_TYPE_UNAVAILABLE', 'SESSION_STATE_CHANGED', 'NOT_SESSION_PARTICIPANT',
    'COACH_NOT_BOOKABLE', 'SESSION_MOVED', 'INVALID_LIST_QUERY',
  ];
  it.each(COACH_CODES)('%s has coach copy that differs from the client copy', (code) => {
    const err = { response: { status: 409, data: { code } } };
    const coach = calendarErrorMessage(err, 'confirm the request', 'coach');
    expect(coach).toBe(COACH_CODE_MESSAGES[code]);
    expect(coach).not.toBe(calendarErrorMessage(err, 'confirm the request'));
    expect(coach).not.toMatch(/your coach|Message your coach|!/i);
    expect(coach).toMatch(/\.$/);
  });

  it.each([401, 402, 403, 404, 400, 409, 429])('HTTP %s never sends a coach to "your coach" or client Calendar', (status) => {
    const msg = calendarErrorMessage({ response: { status } }, 'save time off', 'coach');
    expect(msg).not.toMatch(/your coach|assigned coach|choose an available time/i);
  });

  it('network and unknown failures name a coach next step and the shared support address', () => {
    expect(calendarErrorMessage(new Error('Network Error'), 'save time off', 'coach')).toMatch(/refresh your schedule/);
    const unknown = calendarErrorMessage({ response: { status: 500, data: { request_id: 'req_abcdefabcdef12' } } }, 'save time off', 'coach');
    expect(unknown).toMatch(/Refresh your schedule and try again/);
    expect(unknown).toContain(SUPPORT_EMAIL);
    expect(unknown).toMatch(/reference req_abcdefab/);
    expect(jest.mocked(captureError).mock.calls[0][1]).toEqual(expect.objectContaining({ audience: 'coach' }));
  });

  it('client copy for the new codes points at Calendar', () => {
    expect(calendarErrorMessage({ response: { status: 409, data: { code: 'SESSION_MOVED' } } }, 'cancel')).toMatch(/new time/);
    expect(calendarErrorMessage({ response: { status: 400, data: { code: 'INVALID_LIST_QUERY' } } }, 'load')).toMatch(/Refresh Calendar/);
  });
});

describe('S-SCHED-4 B-325-2: SESSION_STARTED next step depends on what the coach did', () => {
  const started = { response: { status: 409, data: { code: 'SESSION_STARTED' } } };

  it('Confirm on an expired request: the time passed, tap Decline (the backend approvalTooLate step)', () => {
    const msg = calendarErrorMessage(started, 'confirm the request', 'coach', 'approve');
    expect(msg).toMatch(/requested time has already passed/);
    expect(msg).toMatch(/Tap Decline/);
    expect(msg).not.toMatch(/complete|no-show|message your coach/i);
  });

  it('other coach actions never propose complete / no-show (no such control in the app)', () => {
    for (const intent of [undefined, 'decline', 'cancel', 'save_link'] as const) {
      const msg = calendarErrorMessage(started, 'cancel the session', 'coach', intent);
      expect(msg).not.toMatch(/complete|no-show/i);
      expect(msg).toMatch(/Refresh the inbox/);
    }
  });

  it('an intent never changes client copy', () => {
    expect(calendarErrorMessage(started, 'cancel the session', 'client', 'approve')).toBe(
      SCHEDULING_CODE_MESSAGES.SESSION_STARTED,
    );
  });
});
