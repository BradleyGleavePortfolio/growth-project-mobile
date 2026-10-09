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
      roleChoice: false,
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
      roleChoice: false,
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

describe('normalizeSignupPolicy role_choice (C13, backend #597)', () => {
  const base = { invite_code_required: false, providers: ['email', 'apple'] };

  it('is off when the field is absent (current production backend)', () => {
    expect(normalizeSignupPolicy(base).roleChoice).toBe(false);
  });

  it('is on only for a literal true', () => {
    expect(normalizeSignupPolicy({ ...base, role_choice: true }).roleChoice).toBe(true);
    expect(normalizeSignupPolicy({ ...base, role_choice: false }).roleChoice).toBe(false);
    expect(normalizeSignupPolicy({ ...base, role_choice: 'true' }).roleChoice).toBe(false);
    expect(normalizeSignupPolicy({ ...base, role_choice: 1 }).roleChoice).toBe(false);
  });

  it('accepts the exact #597 descriptor', () => {
    const p = normalizeSignupPolicy({
      ...base,
      role_choice: true,
      role_choice_field: 'intended_role',
      role_choice_values: ['client', 'coach'],
    });
    expect(p.roleChoice).toBe(true);
  });

  it('turns off when the server describes a contract this build does not speak', () => {
    expect(
      normalizeSignupPolicy({ ...base, role_choice: true, role_choice_field: 'requested_role' }).roleChoice,
    ).toBe(false);
    expect(
      normalizeSignupPolicy({ ...base, role_choice: true, role_choice_values: ['client'] }).roleChoice,
    ).toBe(false);
    expect(normalizeSignupPolicy({ ...base, role_choice: true, role_choice_values: 'coach' }).roleChoice).toBe(
      false,
    );
  });

  it('strict and unknown fallbacks never ask the role question', () => {
    expect(STRICT_SIGNUP_POLICY.roleChoice).toBe(false);
    expect(normalizeSignupPolicy(null).roleChoice).toBe(false);
  });
});

describe('loadSignupPolicy (shared reader, audit A1)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../signupPolicy') as typeof import('../signupPolicy');
  beforeEach(() => mod.__resetSignupPolicyCacheForTests());

  it('unknown on first failure: code optional, Google and Apple hidden', async () => {
    const r = await mod.loadSignupPolicy(() => Promise.reject(new Error('x')));
    expect(r.source).toBe('unknown');
    expect(r.policy).toEqual(mod.UNKNOWN_SIGNUP_POLICY);
    expect(r.policy.inviteCodeRequired).toBe(false);
    expect(r.policy.googleEnabled).toBe(false);
  });

  it('reuses the last live policy on a later failure', async () => {
    await mod.loadSignupPolicy(() => Promise.resolve({ data: { invite_code_required: true, providers: ['email', 'google'] } }));
    const r = await mod.loadSignupPolicy(() => Promise.reject(new Error('x')));
    expect(r.source).toBe('last_known');
    expect(r.policy.inviteCodeRequired).toBe(true);
    expect(r.policy.googleEnabled).toBe(true);
  });

  describe('ONB-SWEEP U3: the GET gives up at the startup step limit', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('no answer in 8 s is unknown, and a late answer is remembered for the next screen', async () => {
      let answer: (v: { data: unknown }) => void = () => undefined;
      let settled: Awaited<ReturnType<typeof mod.loadSignupPolicy>> | null = null;
      void mod.loadSignupPolicy(() => new Promise((res) => (answer = res))).then((r) => (settled = r));
      await jest.advanceTimersByTimeAsync(7900);
      expect(settled).toBeNull();
      await jest.advanceTimersByTimeAsync(200);
      expect(settled).toEqual({ policy: mod.UNKNOWN_SIGNUP_POLICY, source: 'unknown' });
      answer({ data: { invite_code_required: true, providers: ['email', 'google'], role_choice: true } });
      await jest.advanceTimersByTimeAsync(0);
      expect(mod.getLastKnownSignupPolicy()).toMatchObject({ inviteCodeRequired: true, googleEnabled: true, roleChoice: true });
    });

    it('an answer inside the limit is live', async () => {
      const r = mod.loadSignupPolicy(
        () => new Promise((res) => setTimeout(() => res({ data: { invite_code_required: false, providers: ['email'] } }), 7000)),
      );
      await jest.advanceTimersByTimeAsync(7000);
      await expect(r).resolves.toMatchObject({ source: 'live', policy: { inviteCodeRequired: false } });
    });
  });
});
