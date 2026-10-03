/**
 * S-REACH: the coach consultation read maps every backend outcome to a
 * specific kind (owner rule 2026-10-01 13:34: no generic errors).
 * Contract: backend GET /api/coach/clients/:clientId/consultation (#607).
 */
const mockGet = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (u: string) => mockGet(u) },
}));

import {
  ConsultationLoadError,
  classifyFailure,
  formatConsultationDate,
  isRouteMissing,
  loadClientConsultation,
  screeningSummary,
  type ConsultationView,
} from '../coachConsultationApi';

const CLIENT = '11111111-1111-4111-8111-111111111111';

function httpError(status: number | null, data?: unknown, headers?: Record<string, string>) {
  return Object.assign(new Error(`status ${status}`), {
    isAxiosError: true,
    config: { headers: { 'X-Request-Id': 'outbound-0000-1111' } },
    response: status === null ? undefined : { status, data, headers: headers ?? {} },
  });
}

const VIEW: ConsultationView = {
  version: 'consult-v1',
  revision: 3,
  revision_cause: 'complete',
  submitted_at: '2026-10-01T15:00:00.000Z',
  saved_at: '2026-10-01T15:00:00.000Z',
  chapters: [
    {
      key: 'body',
      title: 'Body basics',
      answers: [{ screen: 'B3', question: 'Your height and weight.', answer_label: '5 ft 6 in (168 cm), 172 lb' }],
    },
  ],
  screening: {
    any_yes: true,
    items: [
      { key: 'P1', question: 'Question one', answer: 'no', note: null },
      { key: 'P2', question: 'Question two', answer: 'yes', note: 'Left knee, 2024' },
      { key: 'P3', question: 'Question three', answer: null, note: null },
    ],
  },
  consent: { version: 'consult-consent-v3', agreed_at: '2026-10-01T14:00:00.000Z' },
};

beforeEach(() => mockGet.mockReset());

describe('loadClientConsultation', () => {
  it('reads the coach route for the client (encoded) and parses the view', async () => {
    mockGet.mockResolvedValueOnce({ data: VIEW });
    const out = await loadClientConsultation(CLIENT);
    expect(mockGet).toHaveBeenCalledWith(`/coach/clients/${CLIENT}/consultation`);
    expect(out).toEqual({ kind: 'ok', view: VIEW });
  });

  it("maps the handler's uniform 404 to none (no answers on file, or no access)", async () => {
    mockGet.mockRejectedValueOnce(httpError(404, { statusCode: 404, message: 'Consultation not found' }));
    await expect(loadClientConsultation(CLIENT)).resolves.toEqual({ kind: 'none' });
  });

  it('treats a router 404 (route missing on this backend) as unexpected, never as "no answers"', async () => {
    mockGet.mockRejectedValueOnce(
      httpError(404, { statusCode: 404, message: 'Cannot GET /api/coach/clients/x/consultation', request_id: 'abcdef1234567890' }),
    );
    const err = await loadClientConsultation(CLIENT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConsultationLoadError);
    expect(err).toMatchObject({ kind: 'unexpected', status: 404, code: 'route_missing', requestId: 'abcdef1234567890' });
  });

  it('rejects a body that breaks the contract as unexpected/contract', async () => {
    mockGet.mockResolvedValueOnce({ data: { version: 'consult-v1' } });
    await expect(loadClientConsultation(CLIENT)).rejects.toMatchObject({ kind: 'unexpected', code: 'contract' });
  });
});

describe('classifyFailure', () => {
  it.each([
    [null, 'offline', 'network'],
    [401, 'session', 'unauthorized'],
    [429, 'busy', 'throttled'],
    [500, 'unexpected', 'http_500'],
    [503, 'unexpected', 'http_503'],
    [403, 'unexpected', 'http_403'],
  ])('status %s -> %s', (status, kind, code) => {
    const out = classifyFailure(httpError(status as number | null, { message: 'x' }));
    expect(out).toBeInstanceOf(ConsultationLoadError);
    expect(out).toMatchObject({ kind, code, status });
  });

  it('keeps the outbound request id as the reference when the server gave none', () => {
    const out = classifyFailure(httpError(500, { message: 'x' }));
    expect(out).toMatchObject({ requestId: 'outbound-0000-1111' });
  });

  it('a non-HTTP failure is unexpected/non_http', () => {
    expect(classifyFailure(new TypeError('boom'))).toMatchObject({ kind: 'unexpected', code: 'non_http' });
  });
});

describe('helpers', () => {
  it('isRouteMissing only matches the Nest router message', () => {
    expect(isRouteMissing({ message: 'Cannot GET /api/x' })).toBe(true);
    expect(isRouteMissing({ message: 'Consultation not found' })).toBe(false);
    expect(isRouteMissing(null)).toBe(false);
  });

  it('screeningSummary counts yes, answered and total', () => {
    expect(screeningSummary(VIEW)).toEqual({ yes: 1, answered: 2, total: 3 });
  });

  it('formatConsultationDate is empty for a missing or bad value', () => {
    expect(formatConsultationDate(null)).toBe('');
    expect(formatConsultationDate('not-a-date')).toBe('');
    expect(formatConsultationDate('2026-10-01T15:00:00.000Z')).toMatch(/2026/);
  });
});
