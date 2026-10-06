/**
 * C-368-3 (Opus, #368 r0; B-PRIVFU2-118 fix round 1): sign-in and sign-up
 * copy uses Apple's current name, "Apple Account", and no first person, on
 * the lines the lens named: the existing-account role notice, the provider
 * "email not verified" message, and the coach sign-up withdrawal notice.
 */
const mockCaptureError = jest.fn();
jest.mock('../../services/sentry', () => ({ captureError: (...a: unknown[]) => mockCaptureError(...a) }));

import * as fs from 'fs';
import * as path from 'path';
import { signupRoleNoticeMessage } from '../signupRoleNotice';
import { describeSignInFailure } from '../../utils/authFailure';

const FIRST_PERSON = /\b(we|our|us)\b/i;

function httpError(status: number, message: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { message } },
  });
}

describe('C-368-3: Apple Account, never Apple ID, and no first person', () => {
  it('existing-account role notice', () => {
    const text = signupRoleNoticeMessage('existing_account');
    expect(text).toBe(
      'This Apple Account or Google account already had an account, so you were signed in to it. The role choice applies only to new accounts.',
    );
    expect(text).not.toMatch(/Apple ID/);
    expect(text).not.toMatch(FIRST_PERSON);
  });

  it('Apple "email not verified" message', () => {
    const text = describeSignInFailure(httpError(401, 'Email not verified'), { provider: 'apple' }).message;
    expect(text).toBe('The email on your Apple Account is not verified. Verify it with Apple, or sign up with email.');
    expect(text).not.toMatch(/Apple ID/);
  });

  it('coach sign-up withdrawal notice after an unconfirmed request', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'auth', 'CreateAccountScreen.tsx'), 'utf8');
    const sentence = source.match(/'You chose to coach clients, but coach sign-up has been switched off, [^']*'/);
    expect(sentence).not.toBeNull();
    const text = sentence?.[0] ?? '';
    expect(text).toMatch(/the app could not confirm what happened to your coach sign-up request/);
    expect(text).toMatch(/Sign in with the same email, Apple Account or Google account first/);
    expect(text).not.toMatch(/Apple ID/);
    expect(text).not.toMatch(FIRST_PERSON);
  });
});
