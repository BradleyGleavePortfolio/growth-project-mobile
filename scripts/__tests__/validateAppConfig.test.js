/**
 * Behavioural test for scripts/validate-app-config.js.
 *
 * Spawns the validator as a child process against the real app.json and a
 * matrix of mutated copies in a tmp dir. The test does not import the
 * validator module — it asserts on stdout/stderr + exit code, which is the
 * actual contract a CI step or release script depends on.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const VALIDATOR = path.join(REPO_ROOT, 'scripts', 'validate-app-config.js');

function runJson(args, env = {}) {
  const res = spawnSync('node', [VALIDATOR, '--json', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (_e) {
    // fall through; tests will assert on the raw streams
  }
  return { ...res, parsed };
}

describe('validate-app-config (default mode, repo as-is)', () => {
  let result;
  beforeAll(() => {
    result = runJson([]);
  });

  it('exits zero', () => {
    expect(result.status).toBe(0);
  });

  it('produces no errors against the checked-in repo', () => {
    expect(result.parsed).toBeTruthy();
    expect(result.parsed.errors).toEqual([]);
  });

  it('warns about REPLACE_WITH_* placeholders in the well-known templates', () => {
    const placeholderWarn = result.parsed.warnings.find((w) =>
      w.includes('REPLACE_WITH_'),
    );
    expect(placeholderWarn).toBeDefined();
  });

  it('warns about null storeListings entries in default mode', () => {
    const w = result.parsed.warnings.filter((m) =>
      m.includes('storeListings'),
    );
    expect(w.length).toBe(2);
    expect(w.some((m) => m.includes('playStoreUrl'))).toBe(true);
    expect(w.some((m) => m.includes('appStoreUrl'))).toBe(true);
  });
});

describe('validate-app-config --release (repo as-is)', () => {
  let result;
  beforeAll(() => {
    result = runJson(['--release']);
  });

  it('exits non-zero while placeholders / null store URLs remain', () => {
    expect(result.status).not.toBe(0);
  });

  it('promotes remaining REPLACE_WITH_* placeholders to errors', () => {
    // The AASA Team ID placeholder is filled in the checked-in repo; only the
    // Play app-signing SHA256 fingerprint in assetlinks.json is still a
    // placeholder (it is only available after Google Play signs the AAB).
    expect(result.parsed.errors.some((e) =>
      /assetlinks\.json:.*REPLACE_WITH_/.test(e),
    )).toBe(true);
    expect(result.parsed.errors.some((e) =>
      /apple-app-site-association:.*REPLACE_WITH_/.test(e),
    )).toBe(false);
  });

  it('promotes both null storeListings entries to errors', () => {
    expect(result.parsed.errors.some((e) =>
      /storeListings\.playStoreUrl/.test(e),
    )).toBe(true);
    expect(result.parsed.errors.some((e) =>
      /storeListings\.appStoreUrl/.test(e),
    )).toBe(true);
  });
});

/**
 * For the mutation tests we run the validator with a swapped working copy.
 * Strategy: copy the whole repo's relevant files into a tmp directory and
 * point the validator at that copy.
 */
function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgp-validate-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'well-known'), { recursive: true });
  fs.copyFileSync(VALIDATOR, path.join(dir, 'scripts', 'validate-app-config.js'));
  fs.copyFileSync(
    path.join(REPO_ROOT, 'app.json'),
    path.join(dir, 'app.json'),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, '.env.example'),
    path.join(dir, '.env.example'),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, 'docs', 'well-known', 'assetlinks.json'),
    path.join(dir, 'docs', 'well-known', 'assetlinks.json'),
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, 'docs', 'well-known', 'apple-app-site-association'),
    path.join(dir, 'docs', 'well-known', 'apple-app-site-association'),
  );
  return dir;
}

function runIn(dir, args) {
  const res = spawnSync(
    'node',
    [path.join(dir, 'scripts', 'validate-app-config.js'), '--json', ...args],
    { cwd: dir, encoding: 'utf8' },
  );
  let parsed = null;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (_e) {
    // ignore
  }
  return { ...res, parsed };
}

describe('validate-app-config — expo-notifications plugin gate', () => {
  it('fails when expo-notifications is not in expo.plugins', () => {
    const dir = makeWorkspace();
    try {
      const appJsonPath = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      app.expo.plugins = (app.expo.plugins || []).filter((p) =>
        (Array.isArray(p) ? p[0] : p) !== 'expo-notifications',
      );
      fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));

      const res = runIn(dir, []);
      expect(res.status).not.toBe(0);
      expect(res.parsed.errors.some((e) =>
        /expo-notifications/.test(e) && /POST_NOTIFICATIONS/.test(e),
      )).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a non-hex color in the plugin config', () => {
    const dir = makeWorkspace();
    try {
      const appJsonPath = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      app.expo.plugins = app.expo.plugins.map((p) => {
        if (Array.isArray(p) && p[0] === 'expo-notifications') {
          return ['expo-notifications', { color: 'forest' }];
        }
        return p;
      });
      fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));

      const res = runIn(dir, []);
      expect(res.status).not.toBe(0);
      expect(res.parsed.errors.some((e) =>
        /expo-notifications.*color/.test(e),
      )).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validate-app-config — store listings', () => {
  it('rejects an obviously fake playStoreUrl', () => {
    const dir = makeWorkspace();
    try {
      const appJsonPath = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      app.expo.extra = app.expo.extra || {};
      app.expo.extra.storeListings = {
        playStoreUrl: 'https://example.com/our-app',
        appStoreUrl: null,
      };
      fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));

      const res = runIn(dir, []);
      expect(res.status).not.toBe(0);
      expect(res.parsed.errors.some((e) =>
        /playStoreUrl/.test(e) && /does not look like a real store URL/.test(e),
      )).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a Play URL whose package id does not match expo.android.package', () => {
    const dir = makeWorkspace();
    try {
      const appJsonPath = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      app.expo.extra = app.expo.extra || {};
      app.expo.extra.storeListings = {
        playStoreUrl:
          'https://play.google.com/store/apps/details?id=com.different.app',
        appStoreUrl: null,
      };
      fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));

      const res = runIn(dir, []);
      expect(res.status).not.toBe(0);
      expect(res.parsed.errors.some((e) =>
        /playStoreUrl/.test(e) && /different package/.test(e),
      )).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a real Play URL with the matching package id (default mode)', () => {
    const dir = makeWorkspace();
    try {
      const appJsonPath = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      app.expo.extra = app.expo.extra || {};
      app.expo.extra.storeListings = {
        playStoreUrl:
          'https://play.google.com/store/apps/details?id=com.growthproject.app',
        appStoreUrl: null,
      };
      fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));

      const res = runIn(dir, []);
      expect(res.parsed.errors).toEqual([]);
      expect(res.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--release accepts both real Play and App Store URLs together', () => {
    const dir = makeWorkspace();
    try {
      const appJsonPath = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      app.expo.extra = app.expo.extra || {};
      app.expo.extra.storeListings = {
        playStoreUrl:
          'https://play.google.com/store/apps/details?id=com.growthproject.app',
        appStoreUrl:
          'https://apps.apple.com/us/app/the-growth-project/id1234567890',
      };
      fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));

      // Also fill the placeholders so --release passes.
      const al = path.join(dir, 'docs', 'well-known', 'assetlinks.json');
      fs.writeFileSync(
        al,
        fs.readFileSync(al, 'utf8').replace(
          /REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT/g,
          '00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
        ),
      );
      const aasa = path.join(
        dir,
        'docs',
        'well-known',
        'apple-app-site-association',
      );
      fs.writeFileSync(
        aasa,
        fs.readFileSync(aasa, 'utf8').replace(/REPLACE_WITH_APPLE_TEAM_ID/g, 'ABCDE12345'),
      );

      const res = runIn(dir, ['--release']);
      expect(res.parsed.errors).toEqual([]);
      expect(res.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
