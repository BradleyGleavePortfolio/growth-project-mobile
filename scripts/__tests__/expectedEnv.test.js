/**
 * EXPO_PUBLIC_* env manifest guard: every name the app reads is declared in
 * config/expected-env.json (kind + default + reason), nothing declared is
 * unread, and every EXPO_PUBLIC_* that eas.json sets is declared.
 */
const { spawnSync } = require('child_process');
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
    expect(fcm).toMatchObject({
      kind: 'eas-credential',
      firebaseProject: 'project-2c2ffa46-a1eb-4f5c-b68',
    });
    for (const c of m.easSideCredentials) expect(Object.keys(m.vars)).not.toContain(c.name);
  });

  it.each([
    ['literal member', 'const a = process.env.EXPO_PUBLIC_A;', ['EXPO_PUBLIC_A']],
    ['bracket literal', "const a = process.env['EXPO_PUBLIC_B'];", ['EXPO_PUBLIC_B']],
    [
      'flag helper literal key',
      'x: readFlag(\'EXPO_PUBLIC_FF_C\', false), y: envBool("EXPO_PUBLIC_FF_D", isDev)',
      ['EXPO_PUBLIC_FF_C', 'EXPO_PUBLIC_FF_D'],
    ],
    ['dynamic prefix helper is ignored', "const P = 'EXPO_PUBLIC_FF_'; const v = process.env[P + k];", []],
    ['line comment is ignored', '// process.env.EXPO_PUBLIC_IN_COMMENT\nconst u = "https://x.y/z";', []],
    ['block comment is ignored', '/* process.env.EXPO_PUBLIC_IN_BLOCK */ const z = 1;', []],
    [
      'a URL in a string does not swallow the rest of the line',
      "const u = 'https://x.y'; const k = process.env.EXPO_PUBLIC_AFTER_URL;",
      ['EXPO_PUBLIC_AFTER_URL'],
    ],
  ])('findReads: %s', (_label, code, names) => {
    expect(guard.findReads(code)).toEqual(names);
  });

  it('fails on an unregistered read, a stale manifest entry, an eas.json-only name, and a bad entry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expected-env-'));
    fs.mkdirSync(path.join(root, 'src', '__tests__'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(
      path.join(root, 'src', 'a.ts'),
      'export const a = process.env.EXPO_PUBLIC_READ_ONLY;\nexport const b = process.env.EXPO_PUBLIC_OK;',
    );
    fs.writeFileSync(path.join(root, 'src', '__tests__', 'a.test.ts'), 'process.env.EXPO_PUBLIC_TEST_ONLY;');
    fs.writeFileSync(path.join(root, 'App.tsx'), 'process.env.EXPO_PUBLIC_BAD_KIND;');
    fs.writeFileSync(
      path.join(root, 'eas.json'),
      JSON.stringify({
        build: {
          production: { env: { EXPO_PUBLIC_EAS_ONLY: 'true', OTHER: '1' } },
        },
      }),
    );
    fs.writeFileSync(
      path.join(root, 'config', 'expected-env.json'),
      JSON.stringify({
        vars: {
          EXPO_PUBLIC_OK: { kind: 'optional', default: 'x', reason: 'ok' },
          EXPO_PUBLIC_STALE: {
            kind: 'flag',
            default: 'off',
            reason: 'never read',
          },
          EXPO_PUBLIC_BAD_KIND: { kind: 'maybe', default: '', reason: 'r' },
        },
      }),
    );
    const { errors } = guard.check(root);
    expect(errors).toEqual([
      'EXPO_PUBLIC_READ_ONLY is read by src/a.ts but is not declared in config/expected-env.json. Fix: add it under "vars" with kind (required|optional|flag), default and reason, or remove the read.',
      'EXPO_PUBLIC_BAD_KIND: kind "maybe" is not one of required|optional|flag. Fix: set its kind in config/expected-env.json.',
      'EXPO_PUBLIC_BAD_KIND: default is empty. Fix: record in config/expected-env.json what the app does when EXPO_PUBLIC_BAD_KIND is unset.',
      'EXPO_PUBLIC_STALE is declared in config/expected-env.json but nothing reads it. Fix: remove the entry, or restore the read as a literal process.env.EXPO_PUBLIC_STALE.',
      'EXPO_PUBLIC_EAS_ONLY is set in eas.json but not declared in config/expected-env.json. Fix: declare it, or remove it from eas.json if nothing reads it.',
    ]);
  });
});

/**
 * B-319-1 (Sol, fix round): the old scanner deleted comment-shaped text with
 * regular expressions before matching, without knowing what was a string, so
 * a real read could vanish and text inside a string could become a ghost
 * read. The scan is now syntax-aware; these fixtures pin both directions.
 */
describe('check-expected-env is syntax-aware (B-319-1)', () => {
  const CLI = path.resolve(__dirname, '..', 'check-expected-env.js');

  it.each([
    [
      'a // inside a string does not hide a real read after it',
      'const note = "coach // note"; const key = process.env.EXPO_PUBLIC_AUDIT_UNKNOWN;',
      ['EXPO_PUBLIC_AUDIT_UNKNOWN'],
    ],
    [
      'a "/*" ... "*/" string pair does not hide a real read between them',
      'const a = "/*"; const key = process.env.EXPO_PUBLIC_AUDIT_UNKNOWN; const b = "*/";',
      ['EXPO_PUBLIC_AUDIT_UNKNOWN'],
    ],
    [
      'comment-shaped template text does not hide a real read after it',
      'const t = `see // and /* here`; const k = process.env.EXPO_PUBLIC_AFTER_TEMPLATE;',
      ['EXPO_PUBLIC_AFTER_TEMPLATE'],
    ],
    [
      'JSX text with // does not hide a real read after it',
      'const el = <Text>a // b</Text>; const k = process.env.EXPO_PUBLIC_AFTER_JSX;',
      ['EXPO_PUBLIC_AFTER_JSX'],
    ],
    [
      'a regex literal with // does not hide a real read after it',
      'const re = / \\/\\/ /; const k = process.env.EXPO_PUBLIC_AFTER_REGEX;',
      ['EXPO_PUBLIC_AFTER_REGEX'],
    ],
    [
      'a real read inside a template substitution counts',
      'const u = `${process.env.EXPO_PUBLIC_IN_TEMPLATE_EXPR}/v1 // not a comment`;',
      ['EXPO_PUBLIC_IN_TEMPLATE_EXPR'],
    ],
    [
      'fake read text in strings is not a read (no ghost keys)',
      [
        'const s = "process.env.EXPO_PUBLIC_AUDIT_GHOST";',
        "const t = 'process.env[\\'EXPO_PUBLIC_GHOST_BRACKET\\']';",
        'const u = `process.env.EXPO_PUBLIC_GHOST_TEMPLATE`;',
        'const v = \'readFlag("EXPO_PUBLIC_FF_GHOST", false)\';',
      ].join('\n'),
      [],
    ],
    [
      'reads inside real comments are still ignored (line, block, JSDoc, trailing)',
      [
        '// process.env.EXPO_PUBLIC_IN_LINE_COMMENT',
        '/* process.env.EXPO_PUBLIC_IN_BLOCK_COMMENT */',
        '/** readFlag("EXPO_PUBLIC_FF_IN_JSDOC") */',
        'const ok = process.env.EXPO_PUBLIC_REAL; // process.env.EXPO_PUBLIC_TRAILING_COMMENT',
      ].join('\n'),
      ['EXPO_PUBLIC_REAL'],
    ],
    [
      'optional chaining, destructuring and a no-substitution template key are reads',
      [
        'const a = process.env?.EXPO_PUBLIC_OPTIONAL;',
        'const { EXPO_PUBLIC_D1, EXPO_PUBLIC_D2: d2, ["EXPO_PUBLIC_D3"]: d3 } = process.env;',
        'const t = process.env[`EXPO_PUBLIC_TEMPLATE_KEY`];',
        "const f = flags.readFlag('EXPO_PUBLIC_FF_METHOD', false);",
      ].join('\n'),
      [
        'EXPO_PUBLIC_D1',
        'EXPO_PUBLIC_D2',
        'EXPO_PUBLIC_D3',
        'EXPO_PUBLIC_FF_METHOD',
        'EXPO_PUBLIC_OPTIONAL',
        'EXPO_PUBLIC_TEMPLATE_KEY',
      ],
    ],
  ])('findReads: %s', (_label, code, names) => {
    expect(guard.findReads(code, 'fixture.tsx')).toEqual(names);
  });

  function miniRepo(files, vars = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expected-env-b319-'));
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config', 'expected-env.json'), JSON.stringify({ vars }));
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    return root;
  }
  const runCli = (root) =>
    spawnSync(process.execPath, [CLI, '--root', root], {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '..', '..'),
    });

  it('CLI: an undeclared real read after a comment-shaped string fails, naming the key and the fix', () => {
    const root = miniRepo({
      'src/note.ts': 'const note = "coach // note"; export const key = process.env.EXPO_PUBLIC_AUDIT_UNKNOWN;\n',
    });
    expect(guard.check(root).errors).toEqual([
      'EXPO_PUBLIC_AUDIT_UNKNOWN is read by src/note.ts but is not declared in config/expected-env.json. Fix: add it under "vars" with kind (required|optional|flag), default and reason, or remove the read.',
    ]);
    const r = runCli(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('[expected-env] EXPO_PUBLIC_AUDIT_UNKNOWN is read by src/note.ts');
    expect(r.stderr).toContain('1 problem(s); each line above says how to fix it.');
  });

  it('CLI: harmless text in a string does not create a ghost key', () => {
    const root = miniRepo({
      'src/ghost.ts': 'export const s = "process.env.EXPO_PUBLIC_AUDIT_GHOST";\n',
    });
    const { errors, reads } = guard.check(root);
    expect(errors).toEqual([]);
    expect([...reads.keys()]).toEqual([]);
    const r = runCli(root);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK: 0 EXPO_PUBLIC_* names read');
  });

  it('a file that does not parse fails closed with the file, line and fix', () => {
    const root = miniRepo({
      'src/broken.ts': 'export const a = (;\nexport const k = process.env.EXPO_PUBLIC_X;\n',
    });
    const [first] = guard.check(root).errors;
    expect(first).toMatch(
      /^src\/broken\.ts does not parse \(line 1: .+\), so its EXPO_PUBLIC_\* reads cannot be checked\. Fix: correct the syntax error\.$/,
    );
  });

  it('a missing manifest is reported with a fix, not a stack trace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expected-env-nomanifest-'));
    const r = runCli(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('[expected-env] config/expected-env.json is missing');
    expect(r.stderr).toContain('Fix: restore it from main');
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});

/**
 * Opus C-319-1 / C-319-2 (folded into the same fix round): a secret-shaped
 * EXPO_PUBLIC_* name fails the guard wherever it appears, and the opt-in
 * --release-env mode checks a build environment without printing values.
 */
describe('check-expected-env secret-shaped names and release env (Opus C-319-1 / C-319-2)', () => {
  const CLI = path.resolve(__dirname, '..', 'check-expected-env.js');
  const entry = { kind: 'optional', default: 'unset', reason: 'r' };
  function repo(files, vars, eas) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'expected-env-c319-'));
    fs.mkdirSync(path.join(root, 'config'));
    fs.writeFileSync(path.join(root, 'config', 'expected-env.json'), JSON.stringify({ vars }));
    if (eas) fs.writeFileSync(path.join(root, 'eas.json'), JSON.stringify(eas));
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    return root;
  }

  it.each([
    ['EXPO_PUBLIC_COACH_SIGNUP_SECRET', 'SECRET'],
    ['EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE'],
    ['EXPO_PUBLIC_DB_PASSWORD', 'PASSWORD'],
    ['EXPO_PUBLIC_SIGNING_PRIVATE_KEY', 'PRIVATE_KEY'],
    ['EXPO_PUBLIC_STRIPE_WEBHOOK_SECRET', 'WEBHOOK'],
    ['EXPO_PUBLIC_STRIPE_SK', 'SK'],
    ['EXPO_PUBLIC_FF_PRIVATE_COMMUNITY_HUB', undefined],
    ['EXPO_PUBLIC_SECRETARY_MODE', undefined],
    ['EXPO_PUBLIC_SKIP_INTRO', undefined],
  ])('secretShape(%s) = %s', (name, shape) => {
    expect(guard.secretShape(name)).toBe(shape);
  });

  it('a declared and read secret-shaped name fails (the Opus probe that exited 0)', () => {
    const root = repo(
      { 'src/s.ts': 'export const s = process.env.EXPO_PUBLIC_COACH_SIGNUP_SECRET;\n' },
      { EXPO_PUBLIC_COACH_SIGNUP_SECRET: entry },
    );
    expect(guard.check(root).errors).toEqual([
      'EXPO_PUBLIC_COACH_SIGNUP_SECRET looks like a secret (name contains SECRET) and is read by src/s.ts, declared in config/expected-env.json, but every EXPO_PUBLIC_* value is compiled into the app bundle and readable by anyone who downloads the app. Fix: keep the value server-side and reach it through the API, then delete the name from config/expected-env.json, eas.json and every EAS environment (eas env:list, eas env:delete).',
    ]);
    const r = spawnSync(process.execPath, [CLI, '--root', root], { encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('EXPO_PUBLIC_COACH_SIGNUP_SECRET looks like a secret');
  });

  it('a secret-shaped name set only in eas.json fails twice: undeclared, and secret-shaped', () => {
    const root = repo({}, {}, { build: { production: { env: { EXPO_PUBLIC_API_SECRET: 'x' } } } });
    const { errors } = guard.check(root);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^EXPO_PUBLIC_API_SECRET is set in eas\.json but not declared/);
    expect(errors[1]).toMatch(
      /^EXPO_PUBLIC_API_SECRET looks like a secret \(name contains SECRET\) and is set in eas\.json,/,
    );
  });

  describe('--release-env', () => {
    const vars = {
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: { kind: 'required', default: 'unset', reason: 'r' },
      EXPO_PUBLIC_API_URL: { kind: 'required', default: 'unset', reason: 'r' },
      EXPO_PUBLIC_FF_X: { kind: 'flag', default: 'off', reason: 'r' },
    };
    const files = {
      'src/a.ts':
        'export const a = [process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY, process.env.EXPO_PUBLIC_API_URL, process.env.EXPO_PUBLIC_FF_X];\n',
    };
    // Assembled at runtime so no Stripe-shaped literal sits in the source.
    const live = ['pk', 'live', 'abc123'].join('_');
    const secretKey = ['sk', 'live', 'leakme'].join('_');

    it('passes when every required name is set and the Stripe key is publishable', () => {
      const root = repo(files, vars);
      expect(
        guard.checkReleaseEnv(root, {
          EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: live,
          EXPO_PUBLIC_API_URL: 'https://a.invalid',
        }).errors,
      ).toEqual([]);
    });

    it('fails on an empty required name, a non-publishable Stripe key and a secret-shaped name, never printing values', () => {
      const root = repo(files, vars);
      const env = {
        EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: secretKey,
        EXPO_PUBLIC_API_URL: '  ',
        EXPO_PUBLIC_COACH_SIGNUP_SECRET: 'hunter2-value',
        PATH: process.env.PATH,
      };
      const { errors } = guard.checkReleaseEnv(root, env);
      expect(errors).toEqual([
        'EXPO_PUBLIC_API_URL is kind "required" in config/expected-env.json but is unset or empty in this build environment. Fix: set it for this EAS environment (eas env:create --name EXPO_PUBLIC_API_URL --environment <environment>), then rebuild.',
        'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is set but does not start with pk_live_ or pk_test_ (value not printed). Fix: set it to the publishable key from the Stripe dashboard; a secret (sk_) or restricted (rk_) key must never be in an EXPO_PUBLIC_* variable.',
        'EXPO_PUBLIC_COACH_SIGNUP_SECRET looks like a secret (name contains SECRET) and is set in this build environment, but every EXPO_PUBLIC_* value is compiled into the app bundle and readable by anyone who downloads the app. Fix: keep the value server-side and reach it through the API, then delete the name from config/expected-env.json, eas.json and every EAS environment (eas env:list, eas env:delete).',
      ]);
      const r = spawnSync(process.execPath, [CLI, '--root', root, '--release-env'], { encoding: 'utf8', env });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('3 problem(s); each line above says how to fix it.');
      expect(r.stderr + r.stdout).not.toContain(secretKey);
      expect(r.stderr + r.stdout).not.toContain('hunter2-value');
    });

    it('without --release-env the build environment is not consulted', () => {
      const root = repo(files, vars);
      const r = spawnSync(process.execPath, [CLI, '--root', root], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH, EXPO_PUBLIC_COACH_SIGNUP_SECRET: 'x' },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('OK: 3 EXPO_PUBLIC_* names read, all in the manifest.');
    });
  });
});
