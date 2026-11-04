/**
 * 1TO1-FU-M (#185-S1 op 1, LS-1TO1R3 C1): a coach who cannot take a new client says so, never
 * that code entry is paused. Every answer the server gives for that refused join (backend main
 * 02a904a6: 404 PACKAGE_NOT_FOUND in `error`, or in `code` on the checkout envelope; after
 * 1TO1-FU-BE: `coach_not_accepting` or `coach_not_accepting_clients`, at any refusal status)
 * reads as coach_not_accepting and shows the existing not-accepting words. A 404 that means the
 * coachless switch is off (`coachless_disabled`, or a bare 404 from an older server) still reads
 * as paused, and getCoachlessHome keeps its rule (any 404 is the switch off).
 */
const mockGet = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: jest.fn() },
}));

import { coachlessFailureOf, failureFromCheck, getCoachlessHome } from '../coachlessApi';
import { refusalLine } from '../../components/coachless/coachlessCopy';

const NOT_ACCEPTING =
  'This coach is not taking new clients right now. Enter another coach code, or check back in a few days.';
const PAUSED = 'Coach code entry is paused right now. Check Home again in a little while.';

const refusal = (status: number, data?: Record<string, unknown>) => ({ response: { status, data } });

const REFUSED_JOIN: Array<[string, number, Record<string, unknown>]> = [
  ['today: 404 PACKAGE_NOT_FOUND in error', 404, { statusCode: 404, error: 'PACKAGE_NOT_FOUND', message: 'Package not available', request_id: 'r-1' }],
  ['today: 404 PACKAGE_NOT_FOUND in code', 404, { statusCode: 404, code: 'PACKAGE_NOT_FOUND', request_id: 'r-1' }],
  ['coachless code coach_not_accepting (409)', 409, { code: 'coach_not_accepting' }],
  ['coachless code coach_not_accepting (403)', 403, { code: 'coach_not_accepting' }],
  ['coachless code coach_not_accepting (404)', 404, { code: 'coach_not_accepting' }],
  ['attach code coach_not_accepting_clients (409)', 409, { code: 'coach_not_accepting_clients' }],
  ['attach code coach_not_accepting_clients (403)', 403, { code: 'coach_not_accepting_clients' }],
  ['attach code coach_not_accepting_clients (404)', 404, { code: 'coach_not_accepting_clients' }],
  ['attach code coach_not_accepting_clients (422)', 422, { code: 'coach_not_accepting_clients' }],
];

describe('a refused join reads as not accepting', () => {
  it.each(REFUSED_JOIN)('%s', (_name, status, data) => {
    const failure = coachlessFailureOf(refusal(status, data));
    expect(failure.code).toBe('coach_not_accepting');
    expect(failure.status).toBe(status);
    expect(refusalLine(failure)).toBe(NOT_ACCEPTING);
  });

  it.each(['coach_not_accepting', 'coach_not_accepting_clients'])('a check answer %s reads as not accepting', (code) => {
    expect(refusalLine(failureFromCheck(code))).toBe(NOT_ACCEPTING);
  });
});

describe('the coachless switch off still reads as paused', () => {
  it.each<[string, Record<string, unknown> | undefined]>([
    ['404 coachless_disabled', { statusCode: 404, code: 'coachless_disabled', request_id: 'r-2' }],
    ['bare 404 (older server, no route)', { statusCode: 404, message: 'Cannot POST /coachless/coach-code/redeem', error: 'Not Found' }],
    ['404 with no body', undefined],
  ])('%s', (_name, data) => {
    const failure = coachlessFailureOf(refusal(404, data));
    expect(failure.code).toBe('coachless_disabled');
    expect(refusalLine(failure)).toBe(PAUSED);
  });

  it('getCoachlessHome keeps its rule: any 404 is the switch off', async () => {
    mockGet.mockRejectedValueOnce(refusal(404, { error: 'PACKAGE_NOT_FOUND' }));
    await expect(getCoachlessHome()).resolves.toEqual({ enabled: false });
    mockGet.mockRejectedValueOnce(refusal(404, { code: 'coachless_disabled' }));
    await expect(getCoachlessHome()).resolves.toEqual({ enabled: false });
  });
});

describe('other answers keep their lines', () => {
  it.each<[number, Record<string, unknown> | undefined, string]>([
    [500, { code: 'redemption_failed', request_id: 'r-3' }, 'redemption_failed'],
    [409, { code: 'already_attached' }, 'already_attached'],
    [404, { code: 'code_invalid' }, 'code_invalid'],
    [400, { error: 'PACKAGE_NOT_FOUND' }, 'bad_format'],
    [429, undefined, 'rate_limited'],
    [503, undefined, 'unexpected'],
  ])('%i %j -> %s', (status, data, code) => {
    expect(coachlessFailureOf(refusal(status, data)).code).toBe(code);
  });

  it('an unknown check code still reads as code_invalid', () => {
    expect(failureFromCheck('something_new').code).toBe('code_invalid');
  });
});
