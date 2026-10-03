/**
 * S-RELEASE-MOB: pre-build release-env check per build profile
 * (scripts/check-expected-env.js --release-env --profile <name>, and the
 * EAS `eas-build-pre-install` hook `--eas-hook`). Values are never printed.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = require('../check-expected-env');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'scripts', 'check-expected-env.js');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'expected-env.json'), 'utf8'));
const EAS = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Assembled at runtime so no key-shaped literal sits in the source.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
// A 32-byte HS256-sized signature, base64url (43 characters).
const SIG = Buffer.from('0123456789abcdef0123456789abcdef').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const HEADER = b64url({ alg: 'HS256', typ: 'JWT' });
const jwt = (role, extra = {}) => [HEADER, b64url({ iss: 'supabase', role, ...extra }), SIG].join('.');
const PK_BODY = '51AbCdEfGhIjKlMnOpQrStUvWx0123';
const PK_LIVE = ['pk', 'live', PK_BODY].join('_');
const PK_TEST = ['pk', 'test', PK_BODY].join('_');
const SB_PUBLISHABLE = ['sb', 'publishable', 'AbCdEfGhIjKlMnOpQrStUv', 'a1B2c3D4'].join('_');
const DSN = 'https://0123456789abcdef0123456789abcdef@o123.ingest.us.sentry.io/4507';

const GOOD = {
  EXPO_PUBLIC_API_URL: 'https://api.trygrowthproject.com/api',
  EXPO_PUBLIC_SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt('anon'),
  EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE,
  EXPO_PUBLIC_SENTRY_DSN: DSN,
};

function cli(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
}

describe('release profiles in config/expected-env.json', () => {
  it('clinic and production are store profiles that require Sentry and live Stripe; preview allows test Stripe', () => {
    const rp = MANIFEST.releaseProfiles;
    expect(rp.clinic).toMatchObject({ require: ['EXPO_PUBLIC_SENTRY_DSN'], stripe: 'live' });
    expect(rp.production).toMatchObject({ require: ['EXPO_PUBLIC_SENTRY_DSN'], stripe: 'live' });
    expect(rp.preview).toMatchObject({ require: [], stripe: 'any' });
    expect(rp.development).toBeUndefined();
  });

  it('every release profile exists in eas.json and every extra name is declared', () => {
    for (const [name, spec] of Object.entries(MANIFEST.releaseProfiles)) {
      if (name.startsWith('$')) continue;
      expect(EAS.build[name]).toBeDefined();
      for (const n of spec.require) expect(MANIFEST.vars[n]).toBeDefined();
    }
  });

  it('EAS runs the check before npm install on every build (development skips inside the script)', () => {
    expect(PKG.scripts['eas-build-pre-install']).toBe('node scripts/check-expected-env.js --eas-hook');
    expect(PKG.scripts['check:release-env']).toBe('node scripts/check-expected-env.js --release-env');
  });

  it('the clinic profile checks exactly these values (the list the operator provisions)', () => {
    const names = guard.checkedNames(MANIFEST.vars, MANIFEST.releaseProfiles.clinic);
    expect(names).toEqual([
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_SENTRY_DSN',
      'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      'EXPO_PUBLIC_SUPABASE_ANON_KEY',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]);
    const r = cli(['--list', '--profile', 'clinic'], {});
    expect(r.status).toBe(0);
    for (const n of [...names, 'EXPO_PUBLIC_FF_CLIENT_TUTORIAL', 'EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES', 'TGP_ANDROID_HEALTH_CONNECT']) {
      expect(r.stdout).toContain(`  ${n}`);
    }
  });
});

describe('valueProblem', () => {
  it.each([
    ['EXPO_PUBLIC_SUPABASE_URL', 'your_supabase_project_url_here', /placeholder/],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'your_supabase_anon_key_here', /placeholder/],
    ['EXPO_PUBLIC_API_URL', 'http://localhost:3000/api', /^must be an https URL$/],
    ['EXPO_PUBLIC_API_URL', 'https://localhost:3000/api', /local, private or example host/],
    ['EXPO_PUBLIC_API_URL', 'https://10.0.2.2:3000/api', /local, private or example host/],
    ['EXPO_PUBLIC_API_URL', 'https://api.example.com', /example host/],
    ['EXPO_PUBLIC_API_URL', 'https://a.invalid', /example host/],
    ['EXPO_PUBLIC_API_URL', 'REPLACE_WITH_API_URL', /placeholder/],
    ['EXPO_PUBLIC_API_URL', '${API_URL}', /placeholder/],
    ['EXPO_PUBLIC_API_URL', 'not a url', /not a URL/],
    ['EXPO_PUBLIC_SENTRY_DSN', '<your dsn>', /placeholder/],
    ['EXPO_PUBLIC_SENTRY_DSN', 'https://sentry.io/', /not a Sentry DSN/],
    ['EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', '*****', /placeholder/],
    ['EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', ['sk', 'live', 'x'].join('_'), /pk_live_ or pk_test_/],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', jwt('service_role'), /SERVICE ROLE/],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', jwt('authenticated'), /role is not "anon"/],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', ['sb', 'secret', 'abc'].join('_'), /SECRET key/],
    ['EXPO_PUBLIC_SUPABASE_ANON_KEY', 'abc.def', /expected a JWT/],
    ['EXPO_PUBLIC_API_URL', '   ', /unset or empty/],
  ])('%s = %j is rejected', (name, value, re) => {
    expect(guard.valueProblem(name, value, { stripe: 'any' })).toMatch(re);
  });

  it('real-looking values pass; Stripe test keys only fail on a live profile', () => {
    for (const [n, v] of Object.entries(GOOD)) expect(guard.valueProblem(n, v, { stripe: 'live' })).toBeUndefined();
    expect(guard.valueProblem('EXPO_PUBLIC_SUPABASE_ANON_KEY', SB_PUBLISHABLE, {})).toBeUndefined();
    expect(guard.valueProblem('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', PK_TEST, { stripe: 'any' })).toBeUndefined();
    expect(guard.valueProblem('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', PK_TEST, { stripe: 'live' })).toMatch(/TEST key on a store profile/);
  });
});

describe('B-333-2: incomplete or malformed credentials fail the release gate', () => {
  const NOW = Date.UTC(2026, 9, 2);
  const bad = (name, value, spec = { stripe: 'any' }) => guard.valueProblem(name, value, spec, NOW);
  const STRIPE = 'EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY';
  const ANON = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

  it.each([
    ['bare pk_live_', ['pk', 'live', ''].join('_')],
    ['bare pk_test_', ['pk', 'test', ''].join('_')],
    ['23-character body', ['pk', 'live', 'A'.repeat(11) + 'b'.repeat(12)].join('_')],
    ['one repeated character', ['pk', 'live', 'x'.repeat(40)].join('_')],
    ['a character Stripe never uses', ['pk', 'live', PK_BODY + '-'].join('_')],
    ['an underscore in the body', ['pk', 'live', PK_BODY, 'extra'].join('_')],
    ['longer than Stripe allows', ['pk', 'live', 'Ab1'.repeat(83)].join('_')],
  ])('Stripe: %s is not a complete publishable key', (_label, value) => {
    expect(bad(STRIPE, value, { stripe: 'any' })).toMatch(/not a complete Stripe publishable key/);
    // On a live profile a test-mode prefix is named first (the fix is a live key, not a longer test key).
    const live = value.startsWith(['pk', 'test', ''].join('_')) ? /TEST key on a store profile/ : /not a complete Stripe publishable key/;
    expect(bad(STRIPE, value, { stripe: 'live' })).toMatch(live);
  });

  it('Stripe: real-looking 24-character (older) and 99-character (current) keys pass', () => {
    expect(bad(STRIPE, ['pk', 'live', 'TYooMQauvdEDq54NiTphI7jx'].join('_'), { stripe: 'live' })).toBeUndefined();
    expect(bad(STRIPE, ['pk', 'live', '51' + 'AbCdEfGh01'.repeat(9) + 'Xyz1234'].join('_'), { stripe: 'live' })).toBeUndefined();
    expect(bad(STRIPE, PK_TEST, { stripe: 'any' })).toBeUndefined();
  });

  it.each([
    ['empty header and signature', `.${b64url({ role: 'anon' })}.`, /three JWT parts must be non-empty base64url/],
    ['empty signature', `${HEADER}.${b64url({ role: 'anon' })}.`, /three JWT parts must be non-empty base64url/],
    ['empty header', `.${b64url({ role: 'anon' })}.${SIG}`, /three JWT parts must be non-empty base64url/],
    ['a non-base64url character', `${HEADER}.${b64url({ role: 'anon' })}.${SIG}+`, /three JWT parts must be non-empty base64url/],
    ['an impossible base64url length', `${HEADER}.${b64url({ role: 'anon' })}.${SIG}ab`, /three JWT parts must be non-empty base64url/],
    ['a header that is not JSON', `${Buffer.from('not json').toString('base64url')}.${b64url({ role: 'anon' })}.${SIG}`, /header does not decode/],
    ['an unsigned (alg none) header', `${b64url({ alg: 'none' })}.${b64url({ role: 'anon' })}.${SIG}`, /header does not decode/],
    ['a header without alg', `${b64url({ typ: 'JWT' })}.${b64url({ role: 'anon' })}.${SIG}`, /header does not decode/],
    ['a payload that is not a JSON object', `${HEADER}.${b64url([1, 2])}.${SIG}`, /payload does not decode/],
    ['a short signature', `${HEADER}.${b64url({ role: 'anon' })}.c2lnbmF0dXJl`, /signature is too short/],
    ['an expired token', jwt('anon', { exp: Math.floor(NOW / 1000) - 60 }), /expired Supabase anon key/],
  ])('Supabase JWT: %s is rejected', (_label, value, re) => {
    expect(bad(ANON, value)).toMatch(re);
  });

  it.each([
    ['bare sb_publishable_', ['sb', 'publishable', ''].join('_')],
    ['a short body', ['sb', 'publishable', 'abc_DEF-1'].join('_')],
    ['one repeated character', ['sb', 'publishable', 'x'.repeat(31)].join('_')],
    ['a character Supabase never uses', ['sb', 'publishable', 'AbCdEfGhIjKlMnOpQrStUv.a1B2c3D4'].join('_')],
  ])('Supabase publishable: %s is rejected', (_label, value) => {
    expect(bad(ANON, value)).toMatch(/not a complete Supabase publishable key/);
  });

  it('Supabase: a full anon JWT with a future exp, and a hosted-format publishable key, pass', () => {
    expect(bad(ANON, jwt('anon', { ref: 'abcdefghijkl', iat: 1700000000, exp: 2015000000 }))).toBeUndefined();
    expect(bad(ANON, SB_PUBLISHABLE)).toBeUndefined();
  });

  it('a service-role payload is still named SERVICE ROLE when the rest of the token is malformed, without its text', () => {
    const payload = b64url({ role: 'service_role', private: 'audit-only-canary' });
    for (const token of [`a.${payload}.c`, `.${payload}.`, `${HEADER}.${payload}.${SIG}`]) {
      const problem = bad(ANON, token);
      expect(problem).toContain('SERVICE ROLE');
      expect(problem).not.toContain(token);
      expect(problem).not.toContain('audit-only-canary');
    }
  });
});

describe('B-333-3: failure text never reflects any part of a value', () => {
  const CANARY = 'auditsyntheticprivatecanary';
  const MALFORMED = {
    EXPO_PUBLIC_API_URL: [`${CANARY}:opaque`, `ftp://${CANARY}.com/x`, `https://${CANARY}.internal/x`, `${CANARY} not a url`],
    EXPO_PUBLIC_SUPABASE_URL: [`http://${CANARY}.supabase.co`, `https://${CANARY}`],
    EXPO_PUBLIC_SUPABASE_ANON_KEY: [
      `${CANARY}.${CANARY}.${CANARY}`,
      `${HEADER}.${b64url({ role: CANARY })}.${SIG}`,
      `${b64url({ alg: 'none', note: CANARY })}.${b64url({ role: 'anon' })}.${SIG}`,
      ['sb', 'publishable', CANARY + '!'].join('_'),
      ['sb', 'secret', CANARY].join('_'),
    ],
    EXPO_PUBLIC_SENTRY_DSN: [`https://${CANARY}@sentry.io/`, `http://k@${CANARY}.ingest.sentry.io/1`],
    EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: [['pk', 'live', CANARY + '!'].join('_'), ['sk', 'live', CANARY].join('_'), ['pk', 'test', CANARY + 'abc'].join('_')],
  };

  it.each(Object.entries(MALFORMED).flatMap(([name, values]) => values.map((v) => [name, v])))(
    '%s = %j fails with fixed text',
    (name, value) => {
      const problem = guard.valueProblem(name, value, { stripe: 'live' });
      expect(problem).toEqual(expect.any(String));
      expect(problem.toLowerCase()).not.toContain(CANARY);
    },
  );

  it('a non-https scheme gets the fixed message (no scheme echoed)', () => {
    expect(guard.valueProblem('EXPO_PUBLIC_API_URL', `${CANARY}:opaque`, {})).toBe('must be an https URL');
  });

  it('CLI: malformed URL, key, DSN and Stripe values plus an overridden profile flag fail the build and print no value text', () => {
    const env = {
      EXPO_PUBLIC_API_URL: MALFORMED.EXPO_PUBLIC_API_URL[0],
      EXPO_PUBLIC_SUPABASE_URL: MALFORMED.EXPO_PUBLIC_SUPABASE_URL[0],
      EXPO_PUBLIC_SUPABASE_ANON_KEY: MALFORMED.EXPO_PUBLIC_SUPABASE_ANON_KEY[1],
      EXPO_PUBLIC_SENTRY_DSN: MALFORMED.EXPO_PUBLIC_SENTRY_DSN[0],
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: MALFORMED.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY[0],
      EXPO_PUBLIC_FF_CLIENT_TUTORIAL: CANARY,
    };
    for (const args of [['--release-env', '--profile', 'clinic'], ['--eas-hook']]) {
      const r = cli(args, { ...env, EAS_BUILD_PROFILE: 'clinic' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('6 problem(s)');
      for (const n of Object.keys(env)) expect(r.stderr).toContain(n);
      const out = (r.stdout + r.stderr).toLowerCase();
      expect(out).not.toContain(CANARY);
      for (const v of Object.values(env)) expect(out).not.toContain(v.toLowerCase());
    }
  });
});

describe('C-333-1: every non-public host form fails', () => {
  it.each([
    'https://172.16.0.1/api',
    'https://172.31.255.254/api',
    'https://169.254.169.254/api',
    'https://100.64.0.1/api',
    'https://0.0.0.0/api',
    'https://2130706433/api',
    'https://0x7f000001/api',
    'https://[::1]/api',
    'https://[::]/api',
    'https://[fd12:3456::1]/api',
    'https://[fc00::1]/api',
    'https://[fe80::1]/api',
    'https://[::ffff:127.0.0.1]/api',
    'https://api.internal/api',
    'https://router.lan/api',
    'https://nas.home.arpa/api',
    'https://intranet/api',
    'https://localhost./api',
  ])('%s is rejected', (url) => {
    expect(guard.valueProblem('EXPO_PUBLIC_API_URL', url, {})).toBe('points at a local, private or example host');
  });

  it.each(['https://172.32.0.1/api', 'https://100.128.0.1/api', 'https://[2606:4700::1111]/api', 'https://api.trygrowthproject.com/api'])(
    '%s (public) passes',
    (url) => {
      expect(guard.valueProblem('EXPO_PUBLIC_API_URL', url, {})).toBeUndefined();
    },
  );
});

describe('checkReleaseEnv with a release profile', () => {
  it('clinic passes with real values (eas.json profile values fill what the shell lacks)', () => {
    expect(guard.checkReleaseEnv(ROOT, GOOD, { profile: 'clinic' }).errors).toEqual([]);
  });

  it('clinic fails on a missing Sentry DSN, a placeholder Supabase URL, a test Stripe key and an overridden clinic flag', () => {
    const env = {
      ...GOOD,
      EXPO_PUBLIC_SENTRY_DSN: '',
      EXPO_PUBLIC_SUPABASE_URL: 'your_supabase_project_url_here',
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST,
      EXPO_PUBLIC_FF_CLIENT_TUTORIAL: 'false',
    };
    const { errors } = guard.checkReleaseEnv(ROOT, env, { profile: 'clinic' });
    expect(errors).toHaveLength(4);
    expect(errors.join('\n')).toMatch(/EXPO_PUBLIC_SENTRY_DSN is unset or empty for release profile "clinic"/);
    expect(errors.join('\n')).toMatch(/EXPO_PUBLIC_SUPABASE_URL is a placeholder/);
    expect(errors.join('\n')).toMatch(/EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY is a Stripe TEST key/);
    expect(errors.join('\n')).toMatch(/EXPO_PUBLIC_FF_CLIENT_TUTORIAL is "true" in eas\.json build\.clinic\.env/);
  });

  it('preview accepts a Stripe test key and does not require Sentry', () => {
    const env = { ...GOOD, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_TEST, EXPO_PUBLIC_SENTRY_DSN: '' };
    expect(guard.checkReleaseEnv(ROOT, env, { profile: 'preview' }).errors).toEqual([]);
  });

  it('CLI: fails the build with fixes and never prints a value', () => {
    const service = jwt('service_role');
    const r = cli(['--release-env', '--profile', 'clinic'], { ...GOOD, EXPO_PUBLIC_SUPABASE_ANON_KEY: service });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('EXPO_PUBLIC_SUPABASE_ANON_KEY is the Supabase SERVICE ROLE key');
    expect(r.stderr).toContain('1 problem(s)');
    expect(r.stdout + r.stderr).not.toContain(service);
  });
});

describe('--eas-hook (eas-build-pre-install)', () => {
  it('clinic on EAS: real values pass, missing values fail the build', () => {
    expect(cli(['--eas-hook'], { ...GOOD, EAS_BUILD_PROFILE: 'clinic' }).status).toBe(0);
    const r = cli(['--eas-hook'], { EAS_BUILD_PROFILE: 'clinic' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('5 problem(s)');
  });

  it('development builds are skipped; a missing profile name fails closed', () => {
    const dev = cli(['--eas-hook'], { EAS_BUILD_PROFILE: 'development' });
    expect(dev.status).toBe(0);
    expect(dev.stdout).toContain('not a release profile; release-env check skipped');
    const none = cli(['--eas-hook'], {});
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('EAS_BUILD_PROFILE is unset');
  });
});
