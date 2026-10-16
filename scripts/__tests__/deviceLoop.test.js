/**
 * DEVICE-LOOP (agent 152): the eas.json "testing" profile, its version hook
 * (scripts/eas-testing-version.js) and the workflow that drives them
 * (.github/workflows/device-loop.yml, docs/DEVICE_LOOP.md).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveProfile, channelProfiles } = require('../eas-profile');
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
});
