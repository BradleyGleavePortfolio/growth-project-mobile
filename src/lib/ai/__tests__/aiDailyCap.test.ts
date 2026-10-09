/**
 * Daily AI cap (M-ROMANCAP): which backend answers mean "today's AI limit is
 * reached", when it resets, and the pop-up copy. Roman send route mapping is
 * checked against the real romanApi.sendMessage with a mocked fetch.
 */
import {
  AI_DAILY_CAP_TITLE,
  aiDailyCapBody,
  aiDailyCapFromHttp,
  aiDailyCapFromStreamCode,
  aiDailyCapOf,
  aiDailyCapResetPhrase,
  nextUtcMidnight,
} from '../aiDailyCap';
import { RomanApiError, sendMessage } from '../../../api/romanApi';

jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));

const NOW = new Date('2026-10-05T18:30:00.000Z');

describe('aiDailyCapFromHttp', () => {
  it('429 ROMAN_RATE_LIMIT resets when Retry-After says', () => {
    const cap = aiDailyCapFromHttp(429, { code: 'ROMAN_RATE_LIMIT' }, 3600, NOW);
    expect(cap?.resetsAt.toISOString()).toBe('2026-10-05T19:30:00.000Z');
  });

  it('503 ROMAN_CAPACITY_REACHED without a wait resets at the next UTC midnight', () => {
    const cap = aiDailyCapFromHttp(503, { code: 'ROMAN_CAPACITY_REACHED', message: 'x' }, undefined, NOW);
    expect(cap?.resetsAt.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('429 AI_DAILY_QUOTA_EXCEEDED (legacy error slot) resets at the next UTC midnight', () => {
    const cap = aiDailyCapFromHttp(429, { error: 'AI_DAILY_QUOTA_EXCEEDED', message: 'x' }, 60, NOW);
    expect(cap?.resetsAt.toISOString()).toBe('2026-10-06T00:00:00.000Z');
  });

  it('an uncoded 429 (burst throttle) and other 503s are not the daily cap', () => {
    expect(aiDailyCapFromHttp(429, { error: 'Too Many Requests', retryAfter: 60 }, 60, NOW)).toBeNull();
    expect(aiDailyCapFromHttp(429, null, 60, NOW)).toBeNull();
    expect(aiDailyCapFromHttp(503, { code: 'ai_egress_blocked' }, undefined, NOW)).toBeNull();
    expect(aiDailyCapFromHttp(503, { code: 'ROMAN_UNAVAILABLE' }, undefined, NOW)).toBeNull();
    expect(aiDailyCapFromHttp(500, { code: 'ROMAN_CAPACITY_REACHED' }, undefined, NOW)).toBeNull();
  });

  it('axios-shaped errors and the in-stream frame code', () => {
    const err = { response: { status: 429, data: { code: 'ROMAN_RATE_LIMIT' }, headers: { 'retry-after': '120' } } };
    expect(aiDailyCapOf(err, NOW)?.resetsAt.toISOString()).toBe('2026-10-05T18:32:00.000Z');
    expect(aiDailyCapOf(new Error('x'), NOW)).toBeNull();
    expect(aiDailyCapFromStreamCode('ROMAN_CAPACITY_REACHED', NOW)?.resetsAt).toEqual(nextUtcMidnight(NOW));
    expect(aiDailyCapFromStreamCode('ROMAN_UNAVAILABLE', NOW)).toBeNull();
  });
});

describe('pop-up copy', () => {
  const FIRST_PERSON = /\b(i|i'm|me|my|we|we're|us|our)\b/i;
  it('title is the owner words verbatim', () => {
    expect(AI_DAILY_CAP_TITLE).toBe("You've used your maximum AI allotment today.");
  });

  it('body names the local reset time and a working next step, quietly', () => {
    const local = new Date(2026, 9, 5, 9, 0);
    const later = new Date(2026, 9, 5, 17, 0);
    const time = later.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    expect(aiDailyCapResetPhrase(later, local)).toBe(`today at ${time}`);
    expect(aiDailyCapResetPhrase(new Date(2026, 9, 6, 17, 0), local)).toBe(`tomorrow at ${time}`);
    for (const audience of ['client', 'coach'] as const) {
      const body = aiDailyCapBody({ resetsAt: later }, audience, local);
      expect(body).toContain(`resets today at ${time}`);
      expect(body).not.toMatch(FIRST_PERSON);
      expect(body).not.toContain('!');
      expect(body).not.toMatch(/unavailable|went wrong/i);
    }
    expect(aiDailyCapBody({ resetsAt: later }, 'client', local)).toContain('Your coach is in Messages');
    expect(aiDailyCapBody({ resetsAt: later }, 'coach', local)).not.toContain('Your coach');
  });

  it('a coachless client is never pointed to a coach; coached and coach copy unchanged (REFUSAL-COACHLESS-134)', () => {
    const local = new Date(2026, 9, 5, 9, 0);
    const cap = { resetsAt: new Date(2026, 9, 5, 17, 0) };
    const coachless = aiDailyCapBody(cap, 'client', local, true);
    expect(coachless).not.toMatch(/coach/i);
    expect(coachless).toContain('Logging and the rest of the app work as usual.');
    expect(coachless).not.toMatch(FIRST_PERSON);
    expect(aiDailyCapBody(cap, 'client', local, false)).toContain(
      'Your coach is in Messages any time, and your plan and logs work as usual.',
    );
    expect(aiDailyCapBody(cap, 'coach', local, true)).toBe(aiDailyCapBody(cap, 'coach', local, false));
  });
});

describe('romanApi.sendMessage maps the daily cap', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  function mockFetchOnce(init: { ok?: boolean; status?: number; text?: string; headers?: Record<string, string> }) {
    const headers = init.headers ?? {};
    const response: Pick<Response, 'ok' | 'status' | 'headers' | 'text'> = {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } as Headers,
      text: async () => init.text ?? '',
    };
    global.fetch = jest.fn(async () => response as Response);
  }
  async function failureOf(p: Promise<unknown>): Promise<RomanApiError> {
    try {
      await p;
    } catch (err) {
      return err as RomanApiError;
    }
    throw new Error('expected a rejection');
  }

  it('429 ROMAN_RATE_LIMIT -> dailyCap (not stored), reset from Retry-After', async () => {
    mockFetchOnce({
      ok: false,
      status: 429,
      text: JSON.stringify({ statusCode: 429, code: 'ROMAN_RATE_LIMIT', message: 'x' }),
      headers: { 'retry-after': '7200' },
    });
    const before = Date.now();
    const err = await failureOf(sendMessage('s1', 'hi'));
    expect(err).toMatchObject({ kind: 'dailyCap', turnStored: false });
    const ms = err.dailyCap!.resetsAt.getTime() - before;
    expect(ms).toBeGreaterThanOrEqual(7200_000);
    expect(ms).toBeLessThan(7260_000);
  });

  it('503 ROMAN_CAPACITY_REACHED -> dailyCap, never generic', async () => {
    mockFetchOnce({ ok: false, status: 503, text: JSON.stringify({ statusCode: 503, code: 'ROMAN_CAPACITY_REACHED', message: 'x' }) });
    const err = await failureOf(sendMessage('s1', 'hi'));
    expect(err).toMatchObject({ kind: 'dailyCap', turnStored: false });
  });

  it('in-stream ROMAN_CAPACITY_REACHED -> dailyCap with the turn stored', async () => {
    mockFetchOnce({ text: 'event: error\ndata: {"code":"ROMAN_CAPACITY_REACHED","message":"x"}\n\n' });
    const err = await failureOf(sendMessage('s1', 'hi'));
    expect(err).toMatchObject({ kind: 'dailyCap', turnStored: true });
  });

  it('an uncoded 429 stays the short wait (rateLimited)', async () => {
    mockFetchOnce({ ok: false, status: 429, headers: { 'retry-after': '5' } });
    const err = await failureOf(sendMessage('s1', 'hi'));
    expect(err).toMatchObject({ kind: 'rateLimited', retryAfterSeconds: 5 });
  });
});
