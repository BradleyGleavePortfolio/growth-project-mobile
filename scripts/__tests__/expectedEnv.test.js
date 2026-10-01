/**
 * EXPO_PUBLIC_* env manifest guard: every name the app reads is declared in
 * config/expected-env.json (kind + default + reason), nothing declared is
 * unread, and every EXPO_PUBLIC_* that eas.json sets is declared.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../check-expected-env');

const ROOT = path.resolve(__dirname, '..', '..');

describe('check-expected-env', () => {
  it('the repository is clean against config/expected-env.json', () => {
    const { errors, reads } = guard.check(ROOT);
    expect(errors).toEqual([]);
    // Guard against a scanner that silently finds nothing.
    expect(reads.size).toBeGreaterThan(40);
    for (const n of [
      'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'EXPO_PUBLIC_STRIPE_PK',
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_FF_CLIENT_TUTORIAL',
      'EXPO_PUBLIC_FF_AI_GATEWAY',
      'EXPO_PUBLIC_SCREENSHOT_MODE',
    ]) {
      expect(reads.has(n)).toBe(true);
    }
  });

  it('manifest kinds: the release-blocking names are required; flags are flags', () => {
    const { vars } = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'expected-env.json'), 'utf8'));
    for (const n of [
      'EXPO_PUBLIC_SUPABASE_URL',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    ]) {
      expect([n, vars[n].kind]).toEqual([n, 'required']);
    }
    for (const n of Object.keys(vars).filter((k) => k.startsWith('EXPO_PUBLIC_FF_'))) {
      expect([n, vars[n].kind]).toEqual([n, 'flag']);
    }
  });

  it('records EAS-side credentials separately from env vars (FCM V1 key for Android push)', () => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'expected-env.json'), 'utf8'));
    const fcm = m.easSideCredentials.find((c) => /FCM V1/.test(c.name));
    expect(fcm).toMatchObject({ kind: 'eas-credential', firebaseProject: 'project-2c2ffa46-a1eb-4f5c-b68' });
    for (const c of m.easSideCredentials) expect(Object.keys(m.vars)).not.toContain(c.name);
  });

  it.each([
    ['literal member', 'const a = process.env.EXPO_PUBLIC_A;', ['EXPO_PUBLIC_A']],
    ['bracket literal', "const a = process.env['EXPO_PUBLIC_B'];", ['EXPO_PUBLIC_B']],
    ['flag helper literal key', "x: readFlag('EXPO_PUBLIC_FF_C', false), y: envBool(\"EXPO_PUBLIC_FF_D\", isDev)", ['EXPO_PUBLIC_FF_C', 'EXPO_PUBLIC_FF_D']],
    ['dynamic prefix helper is ignored', "const P = 'EXPO_PUBLIC_FF_'; const v = process.env[P + k];", []],
    ['line comment is ignored', '// process.env.EXPO_PUBLIC_IN_COMMENT\nconst u = "https://x.y/z";', []],
    ['block comment is ignored', '/* process.env.EXPO_PUBLIC_IN_BLOCK */ const z = 1;', []],
    ['a URL in a string does not swallow the rest of the line', "const u = 'https://x.y'; const k = process.env.EXPO_PUBLIC_AFTER_URL;", ['EXPO_PUBLIC_AFTER_URL']],
  ])('findReads: %s', (_label, code, names) => {
    expect(guard.findReads(code)).toEqual(names);
  });

  it('fails on an unregistered read, a stale manifest entry, an eas.json-only name, and a bad entry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expected-env-'));
    fs.mkdirSync(path.join(root, 'src', '__tests__'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = process.env.EXPO_PUBLIC_READ_ONLY;\nexport const b = process.env.EXPO_PUBLIC_OK;');
    fs.writeFileSync(path.join(root, 'src', '__tests__', 'a.test.ts'), 'process.env.EXPO_PUBLIC_TEST_ONLY;');
    fs.writeFileSync(path.join(root, 'App.tsx'), 'process.env.EXPO_PUBLIC_BAD_KIND;');
    fs.writeFileSync(
      path.join(root, 'eas.json'),
      JSON.stringify({ build: { production: { env: { EXPO_PUBLIC_EAS_ONLY: 'true', OTHER: '1' } } } }),
    );
    fs.writeFileSync(
      path.join(root, 'config', 'expected-env.json'),
      JSON.stringify({
        vars: {
          EXPO_PUBLIC_OK: { kind: 'optional', default: 'x', reason: 'ok' },
          EXPO_PUBLIC_STALE: { kind: 'flag', default: 'off', reason: 'never read' },
          EXPO_PUBLIC_BAD_KIND: { kind: 'maybe', default: '', reason: 'r' },
        },
      }),
    );
    const { errors } = guard.check(root);
    expect(errors).toEqual([
      'read but not in config/expected-env.json: EXPO_PUBLIC_READ_ONLY <- src/a.ts',
      'EXPO_PUBLIC_BAD_KIND: kind must be required|optional|flag',
      'EXPO_PUBLIC_BAD_KIND: default is empty',
      'in config/expected-env.json but never read: EXPO_PUBLIC_STALE',
      'set in eas.json but not in config/expected-env.json: EXPO_PUBLIC_EAS_ONLY',
    ]);
  });
});
