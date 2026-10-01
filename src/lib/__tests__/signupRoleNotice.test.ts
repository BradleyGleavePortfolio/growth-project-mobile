import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SIGNUP_ROLE_NOTICE_KEY,
  clearSignupRoleNotice,
  isSignupRoleNoticeKind,
  readSignupRoleNotice,
  setSignupRoleNotice,
  signupRoleNoticeMessage,
  signupRoleNoticeNeedsSupport,
} from '../signupRoleNotice';

describe('signupRoleNotice (C13)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips a notice kind through AsyncStorage and clears it', async () => {
    expect(await readSignupRoleNotice()).toBeNull();
    await setSignupRoleNotice('coach_request_not_applied');
    expect(await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY)).toBe('coach_request_not_applied');
    expect(await readSignupRoleNotice()).toBe('coach_request_not_applied');
    await clearSignupRoleNotice();
    expect(await readSignupRoleNotice()).toBeNull();
  });

  it('ignores garbage in storage', async () => {
    await AsyncStorage.setItem(SIGNUP_ROLE_NOTICE_KEY, 'something_else');
    expect(await readSignupRoleNotice()).toBeNull();
    expect(isSignupRoleNoticeKind('existing_account')).toBe(true);
    expect(isSignupRoleNoticeKind(42)).toBe(false);
  });

  it('copy is plain: no exclamation marks, and every kind has a message', () => {
    for (const kind of ['coach_request_not_applied', 'existing_account', 'coach_retry_not_applied', 'new_account_from_sign_in'] as const) {
      const msg = signupRoleNoticeMessage(kind);
      expect(msg.length).toBeGreaterThan(20);
      expect(msg).not.toMatch(/!/);
    }
    expect(signupRoleNoticeMessage('coach_request_not_applied')).toMatch(/client account/);
  });

  it('#306 r3 (Opus C4): the retry notice says coach sign-up was not applied, never that the account already existed, and offers support', () => {
    expect(isSignupRoleNoticeKind('coach_retry_not_applied')).toBe(true);
    const msg = signupRoleNoticeMessage('coach_retry_not_applied');
    expect(msg).toMatch(/Coach sign-up was not applied/);
    expect(msg).not.toMatch(/already had an account/);
    expect(signupRoleNoticeNeedsSupport('coach_retry_not_applied')).toBe(true);
  });
});
