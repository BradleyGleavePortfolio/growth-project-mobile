jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
import { captureError } from '../../services/sentry';
import { bookingOutcomeUncertain, calendarErrorMessage } from '../schedulingErrors';

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
  expect(metadata).toEqual({ area: 'calendar', status: 500, code: null, request_id: 'req-12345678' });
  expect(JSON.stringify(metadata)).not.toMatch(/secret|not diagnostic|Authorization/);
});
