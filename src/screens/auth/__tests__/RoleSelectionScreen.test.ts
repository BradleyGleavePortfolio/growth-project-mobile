// Source-level guards for the RoleSelection invite path.
//
// History: audit H-4 made a 4xx attach failure surface to the user. The
// clinic audit of #303 (A2) then showed that the old "attach, then
// selectRole(code)" sequence redeemed a code twice. It also showed that
// selectRole(code) cannot resolve permanent CoachProfile codes. The
// contract is now: attach is the single redemption, finalize with
// selectRole('student', undefined), and every attach failure is surfaced
// (no fallthrough to a second redemption). Behavioural coverage lives in
// RoleSelectionRetry.test.tsx and roleSelectionContract.test.tsx.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'auth', 'RoleSelectionScreen.tsx'),
  'utf8',
);

describe('RoleSelectionScreen invite-code path', () => {
  it('never passes a code to selectRole (single redemption via attach)', () => {
    expect(SRC).not.toMatch(/selectRole\('student', trimmed/);
    expect(SRC).toMatch(/authApi\.selectRole\('student', undefined\)/);
    expect(SRC).toMatch(/await authApi\.attachInviteCode\(trimmed, sharingVersion\)/);
  });

  it('does not log raw error objects', () => {
    expect(SRC).not.toMatch(/console\.warn\([^)]*,\s*err\)/);
    expect(SRC).toMatch(/function logRedacted/);
  });

  it('still funnels final errors through the existing Alert + setError', () => {
    expect(SRC).toMatch(/Alert\.alert\('Sign-up unavailable'/);
    expect(SRC).toMatch(/setError\(msg\)/);
  });
});
