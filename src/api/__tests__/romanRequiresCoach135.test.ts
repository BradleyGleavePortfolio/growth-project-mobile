/**
 * The server's 403 { error: 'ROMAN_REQUIRES_COACH', action: 'JOIN_COACH' } for
 * a client with no coach maps to kind `requiresCoach` on open (axios) and on
 * send (fetch), and useRomanChat turns it into the `requiresCoach` phase (the
 * screen's "Join a coach" state). Other 403s keep their old mapping.
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import api from '../../services/api';
import { openOrResumeSession, RomanApiError, sendMessage } from '../romanApi';
import { useRomanChat } from '../../screens/roman/useRomanChat';
import { romanRequiresCoachFromHttp } from '../../lib/ai/romanRequiresCoach';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));
jest.mock('../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
jest.mock('../../services/accountBinding', () => ({ captureAccountBinding: jest.fn(async () => null) }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const BODY = { error: 'ROMAN_REQUIRES_COACH', action: 'JOIN_COACH' };
const axios403 = (data: unknown) =>
  Object.assign(new Error('Request failed with status code 403'), {
    isAxiosError: true,
    response: { status: 403, data, headers: {} },
    config: { headers: {} },
  });

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

it('reads the code from `error` or `code`, only on a 403', () => {
  expect(romanRequiresCoachFromHttp(403, BODY)).toBe(true);
  expect(romanRequiresCoachFromHttp(403, { code: 'ROMAN_REQUIRES_COACH' })).toBe(true);
  expect(romanRequiresCoachFromHttp(402, BODY)).toBe(false);
  expect(romanRequiresCoachFromHttp(403, { error: 'Forbidden' })).toBe(false);
});

it('open: 403 ROMAN_REQUIRES_COACH -> requiresCoach; another 403 does not', async () => {
  (api.post as jest.Mock).mockRejectedValueOnce(axios403(BODY));
  await expect(openOrResumeSession('client')).rejects.toMatchObject({ kind: 'requiresCoach' });
  (api.post as jest.Mock).mockRejectedValueOnce(axios403({ statusCode: 403, error: 'Forbidden' }));
  await expect(openOrResumeSession('client')).rejects.toMatchObject({ kind: 'generic' });
});

it('send: 403 ROMAN_REQUIRES_COACH -> requiresCoach, turn not stored', async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 403,
    headers: { get: () => null },
    text: async () => JSON.stringify(BODY),
  })) as unknown as typeof fetch;
  const sent = sendMessage('11111111-1111-4111-8111-111111111111', 'hi');
  await expect(sent).rejects.toBeInstanceOf(RomanApiError);
  await expect(sent).rejects.toMatchObject({ kind: 'requiresCoach', turnStored: false });
});

it('useRomanChat: the open answer puts the room in the requiresCoach phase', async () => {
  (api.post as jest.Mock).mockRejectedValueOnce(axios403(BODY));
  const { result } = await renderHook(() => useRomanChat('client'));
  await waitFor(() => expect(result.current.phase).toBe('requiresCoach'));
});
