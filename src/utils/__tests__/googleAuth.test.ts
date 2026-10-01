/**
 * signInWithGoogle, the real utility (#306 fix round 2, Sol B1 / Opus C1).
 *
 * Reproduces the audit probe: with `intendedRole: 'coach'`, any backend
 * failure after the Google session (5xx, network, committed-but-response-
 * lost) used to return `success:true` with a basic Supabase user and
 * `is_new_user:true`, keep the provider token, and write that user to the
 * cache. CreateAccount then said "created as a client account". A coach
 * request must instead fail truthfully: no claim either way, no provisional
 * session, no cached user, and a retry that is safe.
 */
const mockStore = new Map<string, string>();
const mockGoogleAuth = jest.fn();
const mockAttach = jest.fn();

jest.mock('expo-auth-session', () => ({ makeRedirectUri: () => 'tgp://auth/callback' }));
jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  openAuthSessionAsync: jest.fn(async () => ({
    type: 'success',
    url: 'tgp://auth/callback#access_token=tok-1&refresh_token=ref-1',
  })),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      setSession: async () => ({
        data: { user: { id: 'supa-1', email: 'pat@example.com', user_metadata: { full_name: 'Pat' } } },
        error: null,
      }),
    },
  }),
}));
jest.mock('../../services/secureStorage', () => ({
  secureStorage: {
    setItem: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    removeItem: jest.fn(async (k: string) => void mockStore.delete(k)),
  },
}));
jest.mock('../../config/env', () => ({ env: { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'anon' } }));
jest.mock('../../services/api', () => ({
  authApi: {
    googleAuth: (...a: unknown[]) => mockGoogleAuth(...a),
    attachInviteCode: (...a: unknown[]) => mockAttach(...a),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInWithGoogle } from '../googleAuth';
import { CoachSignupUnavailableError } from '../../lib/intendedRole';

const http500 = Object.assign(new Error('Request failed with status code 500'), {
  response: { status: 500, data: { message: 'Internal server error' } },
});
const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
// The server committed the row, then the response was lost (timeout).
const responseLost = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });

describe('signInWithGoogle: coach request with no server answer', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore.clear();
    await AsyncStorage.clear();
  });

  it.each([
    ['backend 500', http500],
    ['network failure', networkError],
    ['committed but response lost', responseLost],
  ])('%s: truthful failure, no session, no cached user', async (_label, err) => {
    mockGoogleAuth.mockRejectedValue(err);
    const result = await signInWithGoogle({ intendedRole: 'coach' });
    expect(result.success).toBe(false);
    expect(result.error_code).toBe('coach_signup_unconfirmed');
    // #306 r4: the Google identity scopes the unconfirmed-attempt marker.
    expect(result.provider_email).toBe('pat@example.com');
    expect(result.user).toBeUndefined();
    expect(result.is_new_user).toBeUndefined();
    expect(result.access_token).toBeUndefined();
    expect(mockStore.has('supabase_token')).toBe(false);
    expect(mockStore.has('supabase_refresh_token')).toBe(false);
    expect(await AsyncStorage.getItem('user_data')).toBeNull();
    expect(mockGoogleAuth).toHaveBeenCalledWith('tok-1', undefined, 'coach');
  });

  it('a retry after a lost response returns the server answer (the account the server committed)', async () => {
    mockGoogleAuth.mockRejectedValueOnce(responseLost);
    expect((await signInWithGoogle({ intendedRole: 'coach' })).success).toBe(false);
    mockGoogleAuth.mockResolvedValueOnce({ data: { user: { id: 'c1', role: 'coach' }, is_new_user: false } });
    const retry = await signInWithGoogle({ intendedRole: 'coach' });
    expect(retry).toMatchObject({ success: true, server_confirmed: true, is_new_user: false, user: { role: 'coach' } });
  });

  it('the pre-handler refusal keeps its own code (no account was created)', async () => {
    mockGoogleAuth.mockRejectedValue(new CoachSignupUnavailableError());
    const result = await signInWithGoogle({ intendedRole: 'coach' });
    expect(result).toMatchObject({ success: false, error_code: 'coach_signup_unavailable' });
    expect(mockStore.has('supabase_token')).toBe(false);
  });

  it('a server answer is marked server_confirmed', async () => {
    mockGoogleAuth.mockResolvedValue({ data: { user: { id: 'c1', role: 'coach' }, is_new_user: true } });
    const result = await signInWithGoogle({ intendedRole: 'coach' });
    expect(result).toMatchObject({ success: true, server_confirmed: true, is_new_user: true });
    expect(mockStore.get('supabase_token')).toBe('tok-1');
  });

  it('without a coach request the legacy fallback is unchanged but flagged server_confirmed:false', async () => {
    mockGoogleAuth.mockRejectedValue(http500);
    const result = await signInWithGoogle();
    expect(result).toMatchObject({ success: true, is_new_user: true, server_confirmed: false });
    expect(result.user).toEqual({ id: 'supa-1', email: 'pat@example.com', name: 'Pat' });
  });
});

describe('signInWithGoogle: invite code outcome (#306 r5, Sol B-306-3)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore.clear();
    await AsyncStorage.clear();
  });

  it('server invite_attached:false wins over an existing coach_id (already paired to coach A)', async () => {
    mockGoogleAuth.mockResolvedValue({
      data: { user: { id: 'u1', role: 'student', coach_id: 'coach-A' }, is_new_user: false, invite_attached: false },
    });
    const result = await signInWithGoogle({ inviteCode: 'GP-COACHB' });
    expect(result).toMatchObject({ success: true, invite_attached: false, invite_code: 'GP-COACHB' });
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('server invite_attached:true is reported as attached', async () => {
    mockGoogleAuth.mockResolvedValue({
      data: { user: { id: 'u1', role: 'student', coach_id: 'coach-B' }, is_new_user: true, invite_attached: true },
    });
    const result = await signInWithGoogle({ inviteCode: 'GP-COACHB' });
    expect(result).toMatchObject({ success: true, invite_attached: true });
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('a server reason travels with invite_attached:false', async () => {
    mockGoogleAuth.mockResolvedValue({
      data: { user: { id: 'u1', role: 'student' }, is_new_user: true, invite_attached: false, invite_attach_error: 'expired' },
    });
    const result = await signInWithGoogle({ inviteCode: 'GP-OLD01' });
    expect(result).toMatchObject({ invite_attached: false, invite_attach_error: 'expired' });
  });

  it('legacy backend (field absent) with an existing coach: not attached, and never re-parented via the attach call', async () => {
    mockGoogleAuth.mockResolvedValue({ data: { user: { id: 'u1', role: 'student', coach_id: 'coach-A' }, is_new_user: false } });
    const result = await signInWithGoogle({ inviteCode: 'GP-COACHB' });
    expect(result).toMatchObject({ success: true, invite_attached: false });
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('legacy backend (field absent) without a coach: the attach endpoint decides', async () => {
    mockGoogleAuth.mockResolvedValue({ data: { user: { id: 'u1', role: 'student' }, is_new_user: true } });
    mockAttach.mockResolvedValue({ data: { coach_id: 'coach-B' } });
    const result = await signInWithGoogle({ inviteCode: 'GP-COACHB' });
    expect(mockAttach).toHaveBeenCalledWith('GP-COACHB');
    expect(result).toMatchObject({ invite_attached: true, user: { coach_id: 'coach-B' } });
  });

  it('the coach refusal returns the Google email so the screen can check an earlier attempt', async () => {
    mockGoogleAuth.mockRejectedValue(new CoachSignupUnavailableError());
    const result = await signInWithGoogle({ intendedRole: 'coach' });
    expect(result).toMatchObject({ error_code: 'coach_signup_unavailable', provider_email: 'pat@example.com' });
  });
});

describe('signInWithGoogle: failure detail and provider subject (#306 r6)', () => {
  const REF = 'feedface-0000-4000-8000-000000000000';
  const http500WithRef = Object.assign(new Error('Request failed with status code 500'), {
    response: { status: 500, data: { message: 'Internal server error', request_id: REF } },
    config: { headers: { Authorization: 'Bearer private-test-token' }, data: '{"password":"PrivateTestPassword"}' },
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockStore.clear();
    await AsyncStorage.clear();
  });

  it('an unconfirmed coach result carries the sanitised detail (status, reference) and the Supabase subject', async () => {
    mockGoogleAuth.mockRejectedValue(http500WithRef);
    const result = await signInWithGoogle({ intendedRole: 'coach' });
    expect(result).toMatchObject({
      error_code: 'coach_signup_unconfirmed',
      provider_subject: 'supa-1',
      error_detail: { kind: 'auth_error_detail', status: 500, requestId: REF },
    });
    // Sol B-306-5: nothing from the request config travels with it.
    expect(JSON.stringify(result.error_detail)).not.toMatch(/private-test-token|PrivateTestPassword/);
  });

  it('the coach refusal also carries the subject, so the screen matches this Google account only', async () => {
    mockGoogleAuth.mockRejectedValue(new CoachSignupUnavailableError());
    const result = await signInWithGoogle({ intendedRole: 'coach' });
    expect(result).toMatchObject({ error_code: 'coach_signup_unavailable', provider_subject: 'supa-1' });
  });

  it('a server answer returns the subject for the Login reconciliation', async () => {
    mockGoogleAuth.mockResolvedValue({ data: { user: { id: 'u1', role: 'student' }, is_new_user: false } });
    const result = await signInWithGoogle();
    expect(result).toMatchObject({ success: true, server_confirmed: true, provider_subject: 'supa-1' });
  });
});
