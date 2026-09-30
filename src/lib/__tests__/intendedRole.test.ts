import { isServerCoach, isUnknownIntendedRoleError, postWithIntendedRole } from '../intendedRole';

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

  it('retries once WITHOUT the field when the current backend rejects it', async () => {
    const post = jest.fn().mockRejectedValueOnce(unknownField).mockResolvedValueOnce({ data: 'ok' });
    await expect(postWithIntendedRole(post, { email: 'a' }, 'client')).resolves.toEqual({ data: 'ok' });
    expect(post).toHaveBeenNthCalledWith(2, { email: 'a' });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors (no double signup)', async () => {
    const err = { response: { status: 409, data: { message: 'Email already registered' } } };
    const post = jest.fn().mockRejectedValue(err);
    await expect(postWithIntendedRole(post, { email: 'a' }, 'client')).rejects.toBe(err);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('classifies only the unknown-field 400', () => {
    expect(isUnknownIntendedRoleError(unknownField)).toBe(true);
    expect(isUnknownIntendedRoleError({ response: { status: 400, data: { message: 'email must be an email' } } })).toBe(false);
    expect(isUnknownIntendedRoleError(new Error('x'))).toBe(false);
  });

  it('only a server-confirmed coach routes to the coach app', () => {
    expect(isServerCoach({ role: 'coach' })).toBe(true);
    expect(isServerCoach({ role: 'student' })).toBe(false);
    expect(isServerCoach(null)).toBe(false);
  });
});
