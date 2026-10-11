import { isHeld, isRetryLater, MAX_RETRY_AFTER_MS, retryAfterMs } from '../retryLater';

const httpError = (status: number, headers: Record<string, unknown> = {}) => ({
  response: { status, headers },
});

describe('isRetryLater', () => {
  it.each([401, 408, 425, 429, 500, 502, 503])('%i is tried again later', (status) => {
    expect(isRetryLater(httpError(status))).toBe(true);
  });

  it.each([400, 403, 404, 409, 422])('%i is a refusal', (status) => {
    expect(isRetryLater(httpError(status))).toBe(false);
  });

  it('no answer from the server is tried again later', () => {
    expect(isRetryLater(new Error('Network Error'))).toBe(true);
    expect(isRetryLater(undefined)).toBe(true);
  });
});

describe('retryAfterMs', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const wait = (value: unknown) => retryAfterMs(httpError(429, { 'retry-after': value }), now);

  it('reads seconds or an HTTP date', () => {
    expect(wait('30')).toBe(30_000);
    expect(wait(30)).toBe(30_000);
    expect(wait('Sat, 10 Oct 2026 12:00:45 GMT')).toBe(45_000);
  });

  it('caps a long wait, ignores a missing, past or unreadable one, and a hold past the cap (clock set back)', () => {
    expect(wait('3600')).toBe(60_000);
    expect(wait('9'.repeat(308))).toBe(MAX_RETRY_AFTER_MS);
    expect(wait('9'.repeat(400))).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs(httpError(429), now)).toBe(0);
    expect(wait('Sat, 10 Oct 2026 11:00:00 GMT')).toBe(0);
    expect(wait('soon')).toBe(0);
    expect(wait('0x10')).toBe(0);
    expect([isHeld(10, 9), isHeld(10, 10), isHeld(MAX_RETRY_AFTER_MS + 10, 9)]).toEqual([true, false, false]);
  });
});
