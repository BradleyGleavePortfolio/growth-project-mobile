/**
 * Clinic C11: expo-updates / EAS Update config gate in
 * scripts/validate-app-config.js. Runs the validator as a child process on
 * mutated copies of app.json / eas.json / package.json (same strategy as
 * validateAppConfig.test.js).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-app-config.js');

function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgp-validate-updates-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'well-known'), { recursive: true });
  fs.copyFileSync(VALIDATOR, path.join(dir, 'scripts', 'validate-app-config.js'));
  // The validator resolves eas.json `extends` through scripts/eas-profile.js.
  fs.copyFileSync(path.join(REPO_ROOT, 'scripts', 'eas-profile.js'), path.join(dir, 'scripts', 'eas-profile.js'));
  for (const f of ['app.json', '.env.example', 'eas.json', 'package.json', 'fingerprint.config.js']) {
    fs.copyFileSync(path.join(REPO_ROOT, f), path.join(dir, f));
  }
  for (const f of ['assetlinks.json', 'apple-app-site-association']) {
    fs.copyFileSync(path.join(REPO_ROOT, 'docs', 'well-known', f), path.join(dir, 'docs', 'well-known', f));
  }
  return dir;
}

function run(dir) {
  const res = spawnSync('node', [path.join(dir, 'scripts', 'validate-app-config.js'), '--json'], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: res.status, parsed: JSON.parse(res.stdout) };
}

function mutate(dir, file, fn) {
  const p = path.join(dir, file);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  fn(j);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}

function withWorkspace(fn) {
  const dir = makeWorkspace();
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('validate-app-config — EAS Update gate', () => {
  it('the repo config passes, with fingerprint runtime and channels per profile', () => {
    const app = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'app.json'), 'utf8')).expo;
    const eas = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'eas.json'), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies['expo-updates']).toMatch(/^~56\./);
    expect(app.runtimeVersion).toEqual({ policy: 'fingerprint' });
    expect(app.updates).toEqual({
      enabled: true,
      url: `https://u.expo.dev/${app.extra.eas.projectId}`,
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    });
    expect(eas.build.production.channel).toBe('production');
    expect(eas.build.preview.channel).toBe('preview');
    expect(eas.build.clinic.channel).toBe('clinic');
    expect(eas.build.clinic.environment).toBe('production');
    expect(app.ios.buildNumber).toBe('7');
    expect(app.android.versionCode).toBe(5);
    withWorkspace((dir) => {
      const r = run(dir);
      expect(r.status).toBe(0);
      expect(r.parsed.errors).toEqual([]);
    });
  });

  it('fails when runtimeVersion is missing', () => {
    withWorkspace((dir) => {
      mutate(dir, 'app.json', (j) => delete j.expo.runtimeVersion);
      const r = run(dir);
      expect(r.status).not.toBe(0);
      expect(r.parsed.errors.some((e) => /runtimeVersion is required/.test(e))).toBe(true);
    });
  });

  it('fails when the updates URL is not this project', () => {
    withWorkspace((dir) => {
      mutate(dir, 'app.json', (j) => {
        j.expo.updates.url = 'https://u.expo.dev/00000000-0000-0000-0000-000000000000';
      });
      const r = run(dir);
      expect(r.parsed.errors.some((e) => /expo\.updates\.url must be https:\/\/u\.expo\.dev\//.test(e))).toBe(true);
    });
  });

  it('fails when launch would block on the network', () => {
    withWorkspace((dir) => {
      mutate(dir, 'app.json', (j) => {
        j.expo.updates.fallbackToCacheTimeout = 30000;
      });
      const r = run(dir);
      expect(r.parsed.errors.some((e) => /fallbackToCacheTimeout must be 0/.test(e))).toBe(true);
    });
  });

  it('fails when a store/preview build profile has the wrong channel', () => {
    withWorkspace((dir) => {
      mutate(dir, 'eas.json', (j) => {
        j.build.production.channel = 'preview';
      });
      const r = run(dir);
      expect(r.parsed.errors.some((e) => /build\.production\.channel must be "production"/.test(e))).toBe(true);
    });
  });

  it('fails when expo-updates is installed but expo.updates is absent', () => {
    withWorkspace((dir) => {
      mutate(dir, 'app.json', (j) => delete j.expo.updates);
      const r = run(dir);
      expect(r.parsed.errors.some((e) => /expo\.updates is required/.test(e))).toBe(true);
    });
  });

  describe('audit #305 C1 / A1 pinned invariants', () => {
    const cases = [
      ['runtimeVersion appVersion', 'app.json', (j) => { j.expo.runtimeVersion = { policy: 'appVersion' }; }, /runtimeVersion must be \{ "policy": "fingerprint" \}/],
      ['runtimeVersion fixed string', 'app.json', (j) => { j.expo.runtimeVersion = '1.0.0'; }, /runtimeVersion must be \{ "policy": "fingerprint" \}/],
      ['runtimeVersion sdkVersion', 'app.json', (j) => { j.expo.runtimeVersion = { policy: 'sdkVersion' }; }, /runtimeVersion must be/],
      ['iOS runtime override', 'app.json', (j) => { j.expo.ios.runtimeVersion = '1.0.0'; }, /expo\.ios\.runtimeVersion override/],
      ['Android runtime override', 'app.json', (j) => { j.expo.android.runtimeVersion = { policy: 'appVersion' }; }, /expo\.android\.runtimeVersion override/],
      ['anti-bricking disabled', 'app.json', (j) => { j.expo.updates.disableAntiBrickingMeasures = true; }, /disableAntiBrickingMeasures/],
      ['embedded update disabled', 'app.json', (j) => { j.expo.updates.useEmbeddedUpdate = false; }, /useEmbeddedUpdate/],
      ['production hide flag false', 'eas.json', (j) => { j.build.production.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES = 'false'; }, /build\.production\.env\.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES must be "true"/],
      ['preview hide flag missing', 'eas.json', (j) => { delete j.build.preview.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES; }, /build\.preview\.env\.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES must be "true"/],
      ['production environment → preview', 'eas.json', (j) => { j.build.production.environment = 'preview'; }, /build\.production\.environment must be "production"/],
      ['preview environment missing', 'eas.json', (j) => { delete j.build.preview.environment; }, /build\.preview\.environment must be "preview"/],
      ['production profile deleted', 'eas.json', (j) => { delete j.build.production; }, /build\.production is required/],
      // S-RELEASE-MOB: the clinic binary has its own channel (built with clinic-only flags).
      ['clinic profile deleted', 'eas.json', (j) => { delete j.build.clinic; }, /build\.clinic is required/],
      ['clinic inherits the production channel', 'eas.json', (j) => { delete j.build.clinic.channel; }, /build\.clinic\.channel must be "clinic"/],
      ['clinic shares the production channel', 'eas.json', (j) => { j.build.clinic.channel = 'production'; }, /channel "production" is used by production, clinic/],
      ['clinic on the preview environment', 'eas.json', (j) => { j.build.clinic.environment = 'preview'; }, /build\.clinic\.environment must be "production"/],
      ['clinic overrides the hide flag', 'eas.json', (j) => { j.build.clinic.env.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES = 'false'; }, /build\.clinic\.env\.EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES must be "true"/],
      ['clinic extends a missing profile', 'eas.json', (j) => { j.build.clinic.extends = 'store'; }, /build\.clinic cannot be resolved/],
      ['a dev profile joins a store channel', 'eas.json', (j) => { j.build.development.channel = 'clinic'; }, /channel "clinic" is used by development, clinic/],
      // Audit #305 C4: the accepted launch behaviour is enforced, not just "valid".
      ['updates disabled', 'app.json', (j) => { j.expo.updates.enabled = false; }, /expo\.updates\.enabled must be true/],
      ['update check only on Wi-Fi', 'app.json', (j) => { j.expo.updates.checkAutomatically = 'WIFI_ONLY'; }, /checkAutomatically must be "ON_LOAD"/],
      ['update check never', 'app.json', (j) => { j.expo.updates.checkAutomatically = 'NEVER'; }, /checkAutomatically must be "ON_LOAD"/],
      ['update check unknown value', 'app.json', (j) => { j.expo.updates.checkAutomatically = 'ALWAYS'; }, /valid values: ON_LOAD/],
    ];
    it.each(cases)('rejects %s', (_name, file, fn, re) => {
      withWorkspace((dir) => {
        mutate(dir, file, fn);
        const r = run(dir);
        expect(r.status).not.toBe(0);
        expect(r.parsed.errors.some((e) => re.test(e))).toBe(true);
      });
    });
  });

  describe('re-audit #305 A1: purchase gate is a fingerprint input', () => {
    it.each([
      ['fingerprint.config.js deleted', (dir) => fs.rmSync(path.join(dir, 'fingerprint.config.js'))],
      ['gate file dropped from extraSources', (dir) => fs.writeFileSync(path.join(dir, 'fingerprint.config.js'), 'module.exports = { extraSources: [] };')],
      ['config throws', (dir) => fs.writeFileSync(path.join(dir, 'fingerprint.config.js'), 'throw new Error("x");')],
    ])('rejects %s', (_name, fn) => {
      withWorkspace((dir) => {
        fn(dir);
        const r = run(dir);
        expect(r.status).not.toBe(0);
        expect(r.parsed.errors.some((e) => /fingerprint\.config\.js/.test(e))).toBe(true);
      });
    });
  });

  describe('S-RELEASE-3: runtime code never drives expo-updates (no update mid-session or mid-onboarding)', () => {
    it.each([
      ['src/services/updates.ts', "import * as Updates from 'expo-updates';\nexport const go = () => Updates.reloadAsync();\n"],
      ['src/screens/onboarding/Step.tsx', "const { fetchUpdateAsync } = require('expo-updates');\n"],
      ['App.tsx', "import 'expo-updates';\n"],
      ['src/lazy.ts', "export const load = () => import('expo-updates');\n"],
    ])('rejects %s importing expo-updates', (rel, code) => {
      withWorkspace((dir) => {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), code);
        const r = run(dir);
        expect(r.status).not.toBe(0);
        expect(r.parsed.errors.some((e) => e.startsWith(`${rel}: imports expo-updates`))).toBe(true);
      });
    });

    it('allows tests, mocks and look-alike names', () => {
      withWorkspace((dir) => {
        fs.mkdirSync(path.join(dir, 'src', '__tests__'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'src', '__tests__', 'u.test.ts'), "jest.mock('expo-updates');\n");
        fs.writeFileSync(path.join(dir, 'src', 'ok.ts'), "// expo-updates applies on cold start\nimport x from 'expo-updates-interface';\nexport default x;\n");
        const r = run(dir);
        expect(r.parsed.errors.filter((e) => /imports expo-updates/.test(e))).toEqual([]);
      });
    });

    it('the repository runtime code passes', () => {
      const res = spawnSync('node', [VALIDATOR, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' });
      expect(JSON.parse(res.stdout).errors.filter((e) => /imports expo-updates/.test(e))).toEqual([]);
    });
  });
});
