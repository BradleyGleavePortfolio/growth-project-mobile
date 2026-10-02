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
const jwt = (role) => [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ iss: 'supabase', role }), 'c2lnbmF0dXJl'].join('.');
const PK_LIVE = ['pk', 'live', '51AbCdEf'].join('_');
const PK_TEST = ['pk', 'test', '51AbCdEf'].join('_');
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
    ['EXPO_PUBLIC_API_URL', 'http://localhost:3000/api', /https/],
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
    expect(guard.valueProblem('EXPO_PUBLIC_SUPABASE_ANON_KEY', ['sb', 'publishable', 'abc_DEF-1'].join('_'), {})).toBeUndefined();
    expect(guard.valueProblem('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', PK_TEST, { stripe: 'any' })).toBeUndefined();
    expect(guard.valueProblem('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY', PK_TEST, { stripe: 'live' })).toMatch(/TEST key on a store profile/);
  });
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
