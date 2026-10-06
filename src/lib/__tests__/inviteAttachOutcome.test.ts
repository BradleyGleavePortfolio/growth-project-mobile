import {
  DEFAULT_INVITE_ATTACH_MESSAGE,
  inviteAttachErrorMessage,
  inviteAttachFailed,
  readInviteAttachOutcome,
} from '../inviteAttachOutcome';

describe('readInviteAttachOutcome', () => {
  it('reports an explicit failure with its reason', () => {
    expect(readInviteAttachOutcome({ invite_attached: false, invite_attach_error: 'coach_inactive' })).toEqual({
      attached: false,
      reason: 'coach_inactive',
    });
    expect(inviteAttachFailed({ invite_attached: false })).toBe(true);
  });

  it('accepts an object-shaped error', () => {
    expect(readInviteAttachOutcome({ invite_attached: false, invite_attach_error: { code: 'expired' } }).reason).toBe('expired');
  });

  it('treats older backends (fields absent) as unknown, not a failure', () => {
    expect(readInviteAttachOutcome({ requires_verification: true })).toEqual({ attached: null, reason: null });
    expect(inviteAttachFailed({})).toBe(false);
    expect(inviteAttachFailed(undefined)).toBe(false);
  });

  it('success is not a failure', () => {
    expect(inviteAttachFailed({ invite_attached: true })).toBe(false);
  });
});

describe('inviteAttachErrorMessage', () => {
  it('maps known reasons to fixed friendly copy', () => {
    expect(inviteAttachErrorMessage('expired')).toMatch(/expired/);
    expect(inviteAttachErrorMessage('max_uses_reached')).toMatch(/used up/);
    expect(inviteAttachErrorMessage('coach_inactive')).toMatch(/not accepting new clients/);
    expect(inviteAttachErrorMessage('already_has_coach')).toMatch(/different coach/);
    expect(inviteAttachErrorMessage('invalid_code')).toMatch(/was not found/);
  });

  it('names each existing-code refusal from the backend (code_revoked / code_expired / code_exhausted)', () => {
    expect(inviteAttachErrorMessage('code_revoked')).toMatch(/turned off by your coach/);
    expect(inviteAttachErrorMessage('code_revoked')).not.toMatch(/expired/);
    expect(inviteAttachErrorMessage('code_expired')).toMatch(/has expired/);
    expect(inviteAttachErrorMessage('code_exhausted')).toMatch(/used up/);
    expect(inviteAttachErrorMessage('coach_not_accepting_clients')).toMatch(/not accepting new clients/);
    expect(inviteAttachErrorMessage('already_attached_to_different_coach')).toMatch(/different coach/);
  });

  it('never echoes an unknown raw server string', () => {
    const raw = 'PrismaClientKnownRequestError at /app/src/x.ts:42';
    expect(inviteAttachErrorMessage(raw)).toBe(DEFAULT_INVITE_ATTACH_MESSAGE);
    expect(inviteAttachErrorMessage(null)).toBe(DEFAULT_INVITE_ATTACH_MESSAGE);
  });
});
