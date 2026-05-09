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
const RELEASE_BLOCKER_MD = path.join(REPO_ROOT, 'RELEASE_BLOCKER.md');

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

  it('warns about the null playStoreUrl entry in default mode', () => {
    // appStoreUrl is now populated with the live App Store listing; only
    // playStoreUrl remains null pending the Play Store submission.
    const w = result.parsed.warnings.filter((m) =>
      m.includes('storeListings'),
    );
    expect(w.length).toBe(1);
    expect(w.some((m) => m.includes('playStoreUrl'))).toBe(true);
    expect(w.some((m) => m.includes('appStoreUrl'))).toBe(false);
  });
});

describe('validate-app-config --release (repo as-is — placeholder and null store URLs are pending, not broken)', () => {
  let result;
  beforeAll(() => {
    result = runJson(['--release']);
  });

  afterAll(() => {
    // Clean up any RELEASE_BLOCKER.md written during this test run.
    if (fs.existsSync(RELEASE_BLOCKER_MD)) {
      fs.unlinkSync(RELEASE_BLOCKER_MD);
    }
  });

  it('exits zero — pending items (placeholder, null store URLs) are blockers, not hard errors', () => {
    // The validator must never produce a false-positive green for genuinely
    // broken values, but it must not block CI for things that are expected
    // to be incomplete at this stage (SHA256 not yet in Play Console,
    // store listings not yet published). Those go into RELEASE_BLOCKER.md.
    expect(result.status).toBe(0);
  });

  it('has no hard errors', () => {
    expect(result.parsed).toBeTruthy();
    expect(result.parsed.errors).toEqual([]);
  });

  it('puts the REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT placeholder into releaseBlockers', () => {
    expect(result.parsed.releaseBlockers.some((b) =>
      /assetlinks\.json/.test(b) && /REPLACE_WITH_/.test(b),
    )).toBe(true);
  });

  it('puts the remaining null playStoreUrl entry into releaseBlockers', () => {
    // appStoreUrl is live (real App Store URL) so it should NOT be a blocker;
    // only playStoreUrl remains pending until the Play Store listing is up.
    expect(result.parsed.releaseBlockers.some((b) =>
      /storeListings.*playStoreUrl/.test(b),
    )).toBe(true);
    expect(result.parsed.releaseBlockers.some((b) =>
      /storeListings.*appStoreUrl/.test(b),
    )).toBe(false);
  });

  it('writes RELEASE_BLOCKER.md to repo root', () => {
    expect(fs.existsSync(RELEASE_BLOCKER_MD)).toBe(true);
    const content = fs.readFileSync(RELEASE_BLOCKER_MD, 'utf8');
    expect(content).toContain('RELEASE BLOCKER');
  });

  it('RELEASE_BLOCKER.md contains the exact keytool command Bradley must run', () => {
    const content = fs.readFileSync(RELEASE_BLOCKER_MD, 'utf8');
    expect(content).toContain('keytool -list -v -keystore');
  });

  it('RELEASE_BLOCKER.md contains Play Console navigation path', () => {
    const content = fs.readFileSync(RELEASE_BLOCKER_MD, 'utf8');
    expect(content).toContain('App integrity');
  });
});

describe('validate-app-config --release with all placeholders filled in', () => {
  let dir;

  beforeAll(() => {
    dir = makeWorkspace();
    // Fill both placeholders and store URLs so the validator has nothing pending.
    const al = path.join(dir, 'docs', 'well-known', 'assetlinks.json');
    fs.writeFileSync(
      al,
      fs.readFileSync(al, 'utf8').replace(
        /REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT/g,
        'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78',
      ),
    );
    const aasa = path.join(dir, 'docs', 'well-known', 'apple-app-site-association');
    fs.writeFileSync(
      aasa,
      fs.readFileSync(aasa, 'utf8').replace(/REPLACE_WITH_APPLE_TEAM_ID/g, 'ABCDE12345'),
    );
    const appJsonPath = path.join(dir, 'app.json');
    const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    app.expo.extra.storeListings = {
      playStoreUrl: 'https://play.google.com/store/apps/details?id=com.growthproject.app',
      appStoreUrl: 'https://apps.apple.com/us/app/the-growth-project/id1234567890',
    };
    fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exits zero when everything is filled in', () => {
    const res = runIn(dir, ['--release']);
    expect(res.status).toBe(0);
  });

  it('has no errors and no releaseBlockers when everything is filled in', () => {
    const res = runIn(dir, ['--release']);
    expect(res.parsed.errors).toEqual([]);
    expect(res.parsed.releaseBlockers).toEqual([]);
  });

  it('does NOT write RELEASE_BLOCKER.md when there are no pending items', () => {
    const blockerPath = path.join(dir, 'RELEASE_BLOCKER.md');
    runIn(dir, ['--release']);
    expect(fs.existsSync(blockerPath)).toBe(false);
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

  it('--release treats null store URLs as pending blockers, not hard errors', () => {
    // Null = "not yet published" — expected pre-launch. Must not fail CI.
    const dir = makeWorkspace();
    try {
      // Fill placeholders so those don't interfere with this assertion.
      const al = path.join(dir, 'docs', 'well-known', 'assetlinks.json');
      fs.writeFileSync(
        al,
        fs.readFileSync(al, 'utf8').replace(
          /REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT/g,
          'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78',
        ),
      );
      const aasa = path.join(dir, 'docs', 'well-known', 'apple-app-site-association');
      fs.writeFileSync(
        aasa,
        fs.readFileSync(aasa, 'utf8').replace(/REPLACE_WITH_APPLE_TEAM_ID/g, 'ABCDE12345'),
      );

      const res = runIn(dir, ['--release']);
      expect(res.status).toBe(0);
      expect(res.parsed.errors).toEqual([]);
      expect(res.parsed.releaseBlockers.some((b) =>
        /playStoreUrl/.test(b),
      )).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--release accepts both real Play and App Store URLs together with no blockers', () => {
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

      // Also fill the placeholders so --release has nothing pending.
      const al = path.join(dir, 'docs', 'well-known', 'assetlinks.json');
      fs.writeFileSync(
        al,
        fs.readFileSync(al, 'utf8').replace(
          /REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT/g,
          'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78',
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
      expect(res.parsed.releaseBlockers).toEqual([]);
      expect(res.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validate-app-config — RELEASE_BLOCKER.md content', () => {
  it('includes the keytool command with the correct arguments for the SHA256 fingerprint', () => {
    const dir = makeWorkspace();
    try {
      const res = runIn(dir, ['--release']);
      // Placeholder still present → should have written RELEASE_BLOCKER.md.
      const blockerPath = path.join(dir, 'RELEASE_BLOCKER.md');
      expect(fs.existsSync(blockerPath)).toBe(true);
      const content = fs.readFileSync(blockerPath, 'utf8');
      expect(content).toContain('keytool -list -v -keystore');
      expect(content).toContain('App integrity');
      expect(content).toContain('SHA-256 fingerprint');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is removed (cleaned up) when --release runs with everything filled in', () => {
    const dir = makeWorkspace();
    try {
      // Write a stale RELEASE_BLOCKER.md first.
      const blockerPath = path.join(dir, 'RELEASE_BLOCKER.md');
      fs.writeFileSync(blockerPath, 'stale content');

      // Fill everything.
      const al = path.join(dir, 'docs', 'well-known', 'assetlinks.json');
      fs.writeFileSync(
        al,
        fs.readFileSync(al, 'utf8').replace(
          /REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT/g,
          'AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78:90:AB:CD:EF:12:34:56:78',
        ),
      );
      const aasa = path.join(dir, 'docs', 'well-known', 'apple-app-site-association');
      fs.writeFileSync(
        aasa,
        fs.readFileSync(aasa, 'utf8').replace(/REPLACE_WITH_APPLE_TEAM_ID/g, 'ABCDE12345'),
      );
      const appJsonPath = path.join(dir, 'app.json');
      const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
      app.expo.extra.storeListings = {
        playStoreUrl: 'https://play.google.com/store/apps/details?id=com.growthproject.app',
        appStoreUrl: 'https://apps.apple.com/us/app/the-growth-project/id1234567890',
      };
      fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2));

      runIn(dir, ['--release']);
      expect(fs.existsSync(blockerPath)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
