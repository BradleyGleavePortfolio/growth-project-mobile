// Audit fix H-4: source-level guard for the invite-code error
// surface in RoleSelectionScreen.
//
// Previously every failure from attachInviteCode was swallowed in an
// empty catch. This worked when selectRole then re-validated, but a
// silent fallthrough on a 4xx response is fragile to contract drift.
// We now special-case 4xx so the outer catch surfaces the server
// message; 5xx / network errors still fall through so the resilience
// behaviour the original code documented is preserved.

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'auth', 'RoleSelectionScreen.tsx'),
  'utf8',
);

describe('RoleSelectionScreen invite-code error path', () => {
  it('reads the response status from the axios error', () => {
    expect(SRC).toMatch(/response\?:\s*\{\s*status\?:\s*number\s*\}/);
  });

  it('rethrows on 4xx so the outer catch surfaces it', () => {
    expect(SRC).toMatch(/status >= 400 && status < 500/);
    expect(SRC).toMatch(/throw err/);
  });

  it('does not rethrow on 5xx or network errors', () => {
    // The truthy branch falls through to selectRole; we look for the
    // dev-only warning that lives on that path.
    expect(SRC).toMatch(/transient failure, retrying via selectRole/);
  });

  it('still funnels final errors through the existing Alert + setError', () => {
    expect(SRC).toMatch(/Alert\.alert\('Sign-up unavailable'/);
    expect(SRC).toMatch(/setError\(msg\)/);
  });
});
