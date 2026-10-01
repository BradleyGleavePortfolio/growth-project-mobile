import {
  COACH_SIGNUP_UNAVAILABLE,
  CoachSignupUnavailableError,
  intendedRoleForRequest,
  isCoachSignupUnavailable,
  isServerCoach,
  isUnknownIntendedRoleError,
  postWithIntendedRole,
} from '../intendedRole';

const unknownField = { response: { status: 400, data: { message: ['property intended_role should not exist'] } } };

describe('postWithIntendedRole', () => {
  it('sends intended_role when given', async () => {
    const post = jest.fn().mockResolvedValue({ data: 'ok' });
    await postWithIntendedRole(post, { email: 'a' }, 'coach');
    expect(post).toHaveBeenCalledWith({ email: 'a', intended_role: 'coach' });
  });

  it('omits the field when no role is given', async () => {
    const post = jest.fn().mockResolvedValue({ data: 'ok' });
    await postWithIntendedRole(post, { email: 'a' });
    expect(post).toHaveBeenCalledWith({ email: 'a' });
  });

  it("client: retries once WITHOUT the field when the backend rejects it (same outcome either way)", async () => {
    const post = jest.fn().mockRejectedValueOnce(unknownField).mockResolvedValueOnce({ data: 'ok' });
    await expect(postWithIntendedRole(post, { email: 'a' }, 'client')).resolves.toEqual({ data: 'ok' });
    expect(post).toHaveBeenNthCalledWith(2, { email: 'a' });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('coach: NEVER retries without the field; fails with CoachSignupUnavailableError (no account created)', async () => {
    const post = jest.fn().mockRejectedValueOnce(unknownField).mockResolvedValueOnce({ data: 'ok' });
    await expect(postWithIntendedRole(post, { email: 'a' }, 'coach')).rejects.toBeInstanceOf(
      CoachSignupUnavailableError,
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('does not retry other errors (no double signup)', async () => {
    const err = { response: { status: 409, data: { message: 'Email already registered' } } };
    const post = jest.fn().mockRejectedValue(err);
    await expect(postWithIntendedRole(post, { email: 'a' }, 'client')).rejects.toBe(err);
    await expect(postWithIntendedRole(post, { email: 'a' }, 'coach')).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('classifies only the unknown-field 400', () => {
    expect(isUnknownIntendedRoleError(unknownField)).toBe(true);
    expect(isUnknownIntendedRoleError({ response: { status: 400, data: { message: 'email must be an email' } } })).toBe(false);
    expect(isUnknownIntendedRoleError(new Error('x'))).toBe(false);
  });

  // #306 fix round 2 (Sol C3): only the ValidationPipe unknown-field refusal
  // means "rejected before any handler". A business 400 that merely names
  // the field says nothing about whether an account exists.
  it('Sol C3: matches the unknown-field refusal narrowly, not any 400 mentioning intended_role', () => {
    expect(isUnknownIntendedRoleError({ response: { status: 400, data: { message: 'property intended_role should not exist' } } })).toBe(true);
    expect(
      isUnknownIntendedRoleError({ response: { status: 400, data: { message: ['email must be an email', 'property intended_role should not exist'] } } }),
    ).toBe(true);
    expect(isUnknownIntendedRoleError({ response: { status: 400, data: { message: 'intended_role coach cannot be combined with an invite code' } } })).toBe(false);
    expect(isUnknownIntendedRoleError({ response: { status: 400, data: { message: ['intended_role must be one of the following values: client, coach'] } } })).toBe(false);
    expect(isUnknownIntendedRoleError({ response: { status: 500, data: { message: 'property intended_role should not exist' } } })).toBe(false);
  });

  it('Sol C3: a business 400 on a coach request is rethrown as-is (not "no account was created")', async () => {
    const business = { response: { status: 400, data: { message: 'intended_role coach cannot be combined with an invite code' } } };
    const post = jest.fn().mockRejectedValue(business);
    await expect(postWithIntendedRole(post, { email: 'a' }, 'coach')).rejects.toBe(business);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('isCoachSignupUnavailable recognises the error class and the code shape', () => {
    expect(isCoachSignupUnavailable(new CoachSignupUnavailableError())).toBe(true);
    expect(isCoachSignupUnavailable({ code: COACH_SIGNUP_UNAVAILABLE })).toBe(true);
    expect(isCoachSignupUnavailable(new Error('x'))).toBe(false);
    expect(isCoachSignupUnavailable(null)).toBe(false);
  });
});

describe('intendedRoleForRequest (policy gate + invite code rule)', () => {
  it('omits the field when the policy does not advertise role choice', () => {
    expect(intendedRoleForRequest(false, 'coach', false)).toBeUndefined();
    expect(intendedRoleForRequest(false, 'client', false)).toBeUndefined();
  });

  it('omits the field whenever an invite code is present (a code always means client)', () => {
    expect(intendedRoleForRequest(true, 'coach', true)).toBeUndefined();
    expect(intendedRoleForRequest(true, 'client', true)).toBeUndefined();
  });

  it('sends the chosen role only when the policy allows it and there is no code', () => {
    expect(intendedRoleForRequest(true, 'coach', false)).toBe('coach');
    expect(intendedRoleForRequest(true, 'client', false)).toBe('client');
  });
});

describe('isServerCoach', () => {
  it('only a server-confirmed coach routes to the coach app', () => {
    expect(isServerCoach({ role: 'coach' })).toBe(true);
    expect(isServerCoach({ role: 'student' })).toBe(false);
    expect(isServerCoach(null)).toBe(false);
  });
});
