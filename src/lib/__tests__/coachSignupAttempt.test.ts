import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  COACH_SIGNUP_UNCONFIRMED_KEY,
  COACH_SIGNUP_UNCONFIRMED_TTL_MS,
  clearUnconfirmedCoachSignup,
  hasAnyUnconfirmedCoachSignup,
  hasUnconfirmedCoachSignup,
  reconcileCoachAttempt,
  rememberUnconfirmedCoachSignup,
  resolveUnconfirmedCoachSignup,
} from '../coachSignupAttempt';
import { classifyCoachSignupFailure, CoachSignupUnavailableError } from '../intendedRole';

describe('coachSignupAttempt (#306 r3, Opus C4)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is scoped to the sign-in method', async () => {
    await rememberUnconfirmedCoachSignup('google', undefined, 1000);
    expect(await hasUnconfirmedCoachSignup('google', undefined, 2000)).toBe(true);
    expect(await hasUnconfirmedCoachSignup('apple', undefined, 2000)).toBe(false);
    expect(await hasUnconfirmedCoachSignup('email', 'a@b.c', 2000)).toBe(false);
  });

  it('is scoped to the email for email signups (case and spaces ignored)', async () => {
    await rememberUnconfirmedCoachSignup('email', ' Pat@Example.com ', 1000);
    expect(await hasUnconfirmedCoachSignup('email', 'pat@example.com', 2000)).toBe(true);
    expect(await hasUnconfirmedCoachSignup('email', 'someone@example.com', 2000)).toBe(false);
  });

  it('expires, so a later person on the device does not inherit it', async () => {
    await rememberUnconfirmedCoachSignup('apple', undefined, 1000);
    expect(await hasUnconfirmedCoachSignup('apple', undefined, 1000 + COACH_SIGNUP_UNCONFIRMED_TTL_MS + 1)).toBe(false);
  });

  it('clears, and ignores garbage', async () => {
    await rememberUnconfirmedCoachSignup('apple');
    await clearUnconfirmedCoachSignup();
    expect(await hasUnconfirmedCoachSignup('apple')).toBe(false);
    await AsyncStorage.setItem(COACH_SIGNUP_UNCONFIRMED_KEY, '{not json');
    expect(await hasUnconfirmedCoachSignup('apple')).toBe(false);
  });
});

describe('coachSignupAttempt (#306 r4, Sol B1-R3 / B2-R3)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('keeps one entry per sign-in; a server answer resolves only its own', async () => {
    await rememberUnconfirmedCoachSignup('apple', undefined, 1000);
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com', 1100);
    expect(await hasAnyUnconfirmedCoachSignup(2000)).toBe(true);
    expect(await resolveUnconfirmedCoachSignup('email', 'other@example.com', 2000)).toBe(false);
    expect(await resolveUnconfirmedCoachSignup('email', 'PAT@example.com ', 2000)).toBe(true);
    expect(await hasUnconfirmedCoachSignup('email', 'pat@example.com', 2000)).toBe(false);
    expect(await hasUnconfirmedCoachSignup('apple', undefined, 2000)).toBe(true);
    expect(await resolveUnconfirmedCoachSignup('apple', undefined, 2000)).toBe(true);
    expect(await hasAnyUnconfirmedCoachSignup(2000)).toBe(false);
  });

  it('provider entries are scoped to the provider email when both sides know it', async () => {
    await rememberUnconfirmedCoachSignup('google', 'Pat@Gmail.com', 1000);
    expect(await hasUnconfirmedCoachSignup('google', 'pat@gmail.com', 2000)).toBe(true);
    expect(await hasUnconfirmedCoachSignup('google', 'someone@gmail.com', 2000)).toBe(false);
    // An answer without an email cannot prove it is someone else.
    expect(await hasUnconfirmedCoachSignup('google', undefined, 2000)).toBe(true);
  });

  it('reads a round-3 single-object marker', async () => {
    await AsyncStorage.setItem(COACH_SIGNUP_UNCONFIRMED_KEY, JSON.stringify({ method: 'google', at: 1000 }));
    expect(await hasUnconfirmedCoachSignup('google', undefined, 2000)).toBe(true);
  });

  it('reconcile: a non-coach server answer for the same sign-in needs the notice; the marker stays until acknowledged', async () => {
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com', 1000);
    expect(
      await reconcileCoachAttempt('email', { role: 'student', email: 'pat@example.com' }, {}, 2000),
    ).toBe('coach_retry_not_applied');
    expect(await hasUnconfirmedCoachSignup('email', 'pat@example.com', 2000)).toBe(true);
  });

  it('reconcile: a server coach, or a brand-new account, resolves with no notice', async () => {
    await rememberUnconfirmedCoachSignup('apple', undefined, 1000);
    expect(await reconcileCoachAttempt('apple', { role: 'coach' }, {}, 2000)).toBeNull();
    expect(await hasAnyUnconfirmedCoachSignup(2000)).toBe(false);
    await rememberUnconfirmedCoachSignup('google', undefined, 1000);
    expect(await reconcileCoachAttempt('google', { role: 'student' }, { isNewUser: true }, 2000)).toBeNull();
    expect(await hasAnyUnconfirmedCoachSignup(2000)).toBe(false);
  });

  it('reconcile guards: an unrelated identity, another method, or no server role says nothing', async () => {
    await rememberUnconfirmedCoachSignup('email', 'pat@example.com', 1000);
    expect(await reconcileCoachAttempt('email', { role: 'student', email: 'other@example.com' }, {}, 2000)).toBeNull();
    expect(await reconcileCoachAttempt('apple', { role: 'student' }, {}, 2000)).toBeNull();
    expect(await reconcileCoachAttempt('email', { email: 'pat@example.com' }, {}, 2000)).toBeNull();
    expect(await hasUnconfirmedCoachSignup('email', 'pat@example.com', 2000)).toBe(true);
  });
});

describe('classifyCoachSignupFailure (#306 r3)', () => {
  it('a pre-handler refusal or any 4xx answer is a refusal', () => {
    expect(classifyCoachSignupFailure(new CoachSignupUnavailableError())).toBe('refused');
    expect(classifyCoachSignupFailure({ response: { status: 400 } })).toBe('refused');
    expect(classifyCoachSignupFailure({ response: { status: 409 } })).toBe('refused');
    expect(classifyCoachSignupFailure({ response: { status: 429 } })).toBe('refused');
  });

  it('no answer, a timeout or a 5xx is unconfirmed', () => {
    expect(classifyCoachSignupFailure(new Error('Cannot reach server'))).toBe('unconfirmed');
    expect(classifyCoachSignupFailure({ response: { status: 408 } })).toBe('unconfirmed');
    expect(classifyCoachSignupFailure({ response: { status: 500 } })).toBe('unconfirmed');
    expect(classifyCoachSignupFailure({ response: { status: 503 } })).toBe('unconfirmed');
  });
});
