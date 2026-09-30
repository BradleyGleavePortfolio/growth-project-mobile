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
  for (const f of ['app.json', '.env.example', 'eas.json', 'package.json']) {
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
    expect(app.ios.buildNumber).toBe('6');
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
});
