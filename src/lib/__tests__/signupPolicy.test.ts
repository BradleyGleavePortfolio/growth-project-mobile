import { normalizeSignupPolicy, STRICT_SIGNUP_POLICY } from '../signupPolicy';

describe('normalizeSignupPolicy', () => {
  it('reads the live backend shape (invite_code_required + providers)', () => {
    const p = normalizeSignupPolicy({
      invite_code_required: false,
      coach_code_required: false,
      providers: ['email', 'apple'],
    });
    expect(p).toEqual({
      inviteCodeRequired: false,
      providers: ['email', 'apple'],
      googleEnabled: false,
      appleEnabled: true,
    });
  });

  it('enables Google only when providers includes google', () => {
    expect(normalizeSignupPolicy({ invite_code_required: true, providers: ['email', 'google'] }).googleEnabled).toBe(true);
    expect(normalizeSignupPolicy({ invite_code_required: true, providers: ['email'] }).googleEnabled).toBe(false);
  });

  it('providers wins over the legacy google flag', () => {
    const p = normalizeSignupPolicy({ providers: ['email'], google_signin_enabled: true, invite_code_required: false });
    expect(p.googleEnabled).toBe(false);
  });

  it('falls back to legacy names when canonical ones are absent', () => {
    expect(normalizeSignupPolicy({ require_invite_code: false, google_signin_enabled: true })).toEqual({
      inviteCodeRequired: false,
      providers: ['email', 'google'],
      googleEnabled: true,
      appleEnabled: false,
    });
  });

  it('uses coach_code_required when invite_code_required is missing', () => {
    expect(normalizeSignupPolicy({ coach_code_required: false, providers: [] }).inviteCodeRequired).toBe(false);
  });

  it('is strict for missing/garbage payloads', () => {
    expect(normalizeSignupPolicy(null)).toEqual(STRICT_SIGNUP_POLICY);
    expect(normalizeSignupPolicy('nope')).toEqual(STRICT_SIGNUP_POLICY);
    const p = normalizeSignupPolicy({ providers: ['GOOGLE ', 42, 'myspace', 'google'] });
    expect(p.inviteCodeRequired).toBe(true);
    expect(p.providers).toEqual(['google']);
  });
});
