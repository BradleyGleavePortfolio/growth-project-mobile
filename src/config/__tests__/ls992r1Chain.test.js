/**
 * @jest-environment node
 */
/**
 * LS-992R1 throwaway (ci/171 lane only, never merged): the real prebuild config chain
 * (getPrebuildConfigAsync, then every mod in introspect mode, which writes nothing), for both switch values.
 * It prints the generated AndroidManifest's root attributes, uses-permission and uses-feature lines, and every
 * Info.plist usage line, so the lens can compare base and head.
 */
const path = require('path');

const root = path.resolve(__dirname, '../../..');
const load = (name) => require(name);
const originalSwitch = process.env.TGP_ANDROID_HEALTH_CONNECT;

afterEach(() => {
  if (originalSwitch === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = originalSwitch;
});

const out = (tag, value) => process.stdout.write(`LS992R1|${tag}|${JSON.stringify(value)}\n`);

describe.each([['unset', undefined], ['on', '1']])('the real chain, TGP_ANDROID_HEALTH_CONNECT %s', (label, value) => {
  test('prints the generated Android manifest and Info.plist', async () => {
    jest.resetModules();
    if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
    else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
    const { getPrebuildConfigAsync } = load('@expo/prebuild-config');
    const { compileModsAsync } = load('@expo/config-plugins/build/plugins/mod-compiler');
    const { exp } = await getPrebuildConfigAsync(root, { platforms: ['android', 'ios'] });
    out(`${label}|plugins`, (exp.plugins || []).map((p) => (Array.isArray(p) ? p[0] : p)));
    out(`${label}|static-permissions`, exp.android.permissions || null);
    out(`${label}|static-blocked`, exp.android.blockedPermissions || null);
    const compiled = await compileModsAsync(exp, {
      projectRoot: root,
      platforms: ['android', 'ios'],
      introspect: true,
      assertMissingModProviders: false,
    });
    const mr = compiled._internal.modResults;
    const manifest = mr.android.manifest.manifest;
    out(`${label}|manifest-root`, manifest.$);
    out(`${label}|uses-permission`, (manifest['uses-permission'] || []).map((l) => l.$));
    out(`${label}|uses-permission-sdk-23`, (manifest['uses-permission-sdk-23'] || []).map((l) => l.$));
    out(`${label}|uses-feature`, (manifest['uses-feature'] || []).map((l) => l.$));
    const plist = mr.ios.infoPlist || {};
    const usage = Object.fromEntries(Object.entries(plist).filter(([k]) => /UsageDescription$/.test(k)));
    out(`${label}|infoplist-usage`, usage);
    out(`${label}|infoplist-keys`, Object.keys(plist).sort());
    expect(manifest['uses-permission']).toBeDefined();
  }, 120000);
});
