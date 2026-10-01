import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  COACH_SIGNUP_UNCONFIRMED_KEY,
  COACH_SIGNUP_UNCONFIRMED_TTL_MS,
  clearUnconfirmedCoachSignup,
  hasUnconfirmedCoachSignup,
  rememberUnconfirmedCoachSignup,
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
