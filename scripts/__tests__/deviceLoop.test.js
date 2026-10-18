/**
 * DEVICE-LOOP (agent 152): the eas.json "testing" profile, its version hook
 * (scripts/eas-testing-version.js) and the workflow that drives them
 * (.github/workflows/device-loop.yml, docs/DEVICE_LOOP.md).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveProfile, channelProfiles } = require('../eas-profile');
const { EAS_CLI } = require('../eas-update-guard');
const hook = require('../eas-testing-version');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const eas = JSON.parse(read('eas.json'));
const app = JSON.parse(read('app.json')).expo;
const TESTING_IOS = { EAS_BUILD_PROFILE: 'testing', EAS_BUILD_PLATFORM: 'ios' };

describe('eas.json testing profile', () => {
  it('is the production build on its own channel, with the production submit app', () => {
    expect(eas.build.testing.extends).toBe('production');
    const testing = resolveProfile(eas, 'testing');
    expect(testing).toMatchObject({ channel: 'testing', distribution: 'store', environment: 'production' });
    expect({ ...testing, channel: 'production' }).toEqual(resolveProfile(eas, 'production'));
    expect(channelProfiles(eas).testing).toEqual(['testing']);
    expect(eas.submit.testing).toEqual({ extends: 'production' });
  });

  it('gets the production release-value checks before every build', () => {
    const { releaseProfiles } = JSON.parse(read('config/expected-env.json'));
    const { reason: _t, ...testing } = releaseProfiles.testing;
    const { reason: _p, ...production } = releaseProfiles.production;
    expect(testing).toEqual(production);
  });
});

describe('scripts/eas-testing-version.js (EAS post-install hook)', () => {
  const roots = [];
  afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

  function project(...apps) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tgp-testing-version-'));
    roots.push(root);
    for (const dir of ['Pods', ...apps]) {
      fs.mkdirSync(path.join(root, 'ios', dir), { recursive: true });
      fs.writeFileSync(path.join(root, 'ios', dir, 'Info.plist'), '<plist/>');
    }
    return root;
  }

  it('is the package.json post-install hook', () => {
    expect(JSON.parse(read('package.json')).scripts['eas-build-post-install']).toBe('node scripts/eas-testing-version.js');
  });

  it.each([
    [{ EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'ios' }],
    [{ EAS_BUILD_PROFILE: 'testing', EAS_BUILD_PLATFORM: 'android' }],
    [{ EAS_BUILD_PLATFORM: 'ios' }],
    [{}],
  ])('leaves every other build untouched (%p)', (env) => {
    const run = jest.fn();
    expect(hook.main({ env, root: path.join(os.tmpdir(), 'tgp-no-such-project'), run, log: () => {} })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('moves a testing iOS build to version 99.0.0 with a minutes-since-1970 build number', () => {
    const root = project('TheGrowthProject');
    const run = jest.fn();
    const out = hook.main({ env: TESTING_IOS, root, now: new Date('2026-10-16T15:30:59Z'), run, log: () => {} });
    const plist = path.join(root, 'ios', 'TheGrowthProject', 'Info.plist');
    expect(out).toEqual({ plist, version: '99.0.0', build: '29869410' });
    expect(run).toHaveBeenCalledWith('/usr/libexec/PlistBuddy', [
      '-c',
      'Set :CFBundleShortVersionString 99.0.0',
      '-c',
      'Set :CFBundleVersion 29869410',
      plist,
    ]);
  });

  it('fails the testing build when it cannot tell which Info.plist is the app', () => {
    for (const root of [project(), project('One', 'Two')]) {
      expect(() => hook.main({ env: TESTING_IOS, root, run: jest.fn(), log: () => {} })).toThrow(/exactly one ios\/<app>\/Info\.plist/);
    }
  });

  it('build numbers are whole numbers that rise every minute, on a version production never uses', () => {
    const a = hook.testingBuildNumber(new Date('2026-10-16T15:30:59Z'));
    const b = hook.testingBuildNumber(new Date('2026-10-16T15:31:00Z'));
    expect(a).toMatch(/^\d+$/);
    expect(Number(b)).toBe(Number(a) + 1);
    expect(hook.TESTING_VERSION).not.toBe(app.version);
  });
});

describe('.github/workflows/device-loop.yml', () => {
  const yml = read('.github/workflows/device-loop.yml');

  it('runs on main, daily and by hand, never on a pull request', () => {
    expect(yml).toMatch(/\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n/);
    expect(yml).toMatch(/\n {2}workflow_dispatch:\n/);
    expect(yml).not.toMatch(/pull_request/);
  });

  it('pins every action to a commit and reads only the EXPO_TOKEN secret', () => {
    const uses = yml.match(/uses: \S+/g);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
    expect(yml.match(/secrets\.\w+/g).every((s) => s === 'secrets.EXPO_TOKEN')).toBe(true);
  });

  it('builds the testing profile with auto-submit, and publishes only through the update guard', () => {
    expect(yml).toContain('eas build --profile testing --platform ios --non-interactive --auto-submit --no-wait');
    expect(yml).toContain('npm run update:publish -- --channel testing --environment production');
    expect(yml).not.toMatch(/eas update/);
  });

  it('runs the loop job only from main, with the same pinned eas-cli as the update guard', () => {
    expect(yml).toContain("if: needs.token.outputs.present == 'true' && github.ref == 'refs/heads/main'");
    expect(yml.match(/eas-version: (\S+)/)[1]).toBe(EAS_CLI.replace(/^eas-cli@/, ''));
  });

  describe('the Decide step (run against a stub eas)', () => {
    const lines = yml.split('\n');
    const from = lines.findIndex((l) => l.includes('- name: Decide')) + 3;
    const end = lines.findIndex((l, i) => i >= from && l.trim() && !l.startsWith(' '.repeat(10)));
    const script = lines.slice(from, end).map((l) => l.slice(10)).join('\n');
    const STUB = '#!/bin/bash\ncase "$1" in\n  fingerprint:generate) echo \'{"hash":"fp1"}\' ;;\n  build:list) if [[ " $* " == *" --runtime-version fp1 "* ]]; then echo "$MINE"; else echo "$RECENT"; fi ;;\n  *) exit 9 ;;\nesac\n';
    const now = new Date().toISOString();
    const b = (status, n = 1) => Array.from({ length: n }, () => ({ status, createdAt: now }));
    (process.platform === 'linux' ? it.each : it.skip.each)([
      ['a build with this fingerprint finished', 'push', 'update', b('FINISHED'), b('FINISHED'), /Device loop: update::/],
      ['another testing build is running', 'push', 'none', [], b('IN_PROGRESS'), /Device loop: waiting::/],
      ['the build with this fingerprint failed', 'push', 'none', b('ERRORED'), b('ERRORED'), /Device loop: build failed::/],
      ['the build with this fingerprint was canceled', 'push', 'none', b('CANCELED'), b('CANCELED'), /Device loop: build failed::/],
      ['the build with this fingerprint failed', 'schedule', 'build', b('ERRORED'), b('ERRORED'), /Device loop: build::.*\(2 of 10/],
      ['the build with this fingerprint was canceled', 'workflow_dispatch', 'build', b('CANCELED'), b('CANCELED'), /Device loop: build::/],
      ['10 testing builds started in 31 days', 'schedule', 'none', [], b('FINISHED', 10), /Device loop: build limit::/],
      ['no testing build has this fingerprint', 'push', 'build', [], [], /Device loop: build::.*\(1 of 10/],
    ])('%s: a %s run decides %s', (_label, event, action, mine, recent, notice) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgp-decide-'));
      try {
        fs.writeFileSync(path.join(dir, 'eas'), STUB, { mode: 0o755 });
        const out = path.join(dir, 'out');
        const env = { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, GITHUB_EVENT_NAME: event, MAX_TESTING_BUILDS: '10', MINE: JSON.stringify(mine), RECENT: JSON.stringify(recent) };
        const res = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
        expect(res.status).toBe(0);
        expect(fs.readFileSync(out, 'utf8')).toBe(`action=${action}\n`);
        expect(res.stdout).toMatch(notice);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
