// LO-992R1 throwaway (ci lane only, never merge): the real prebuild chain, as `expo config --type introspect` runs it,
// without an android/ or ios/ folder: getPrebuildConfigAsync, then compileModsAsync in introspect mode. Prints JSON.
const path = require('path');
const root = path.resolve(__dirname, '..');
(async () => {
  const { getPrebuildConfigAsync } = require('@expo/prebuild-config');
  const { compileModsAsync } = require('@expo/config-plugins');
  const { exp } = await getPrebuildConfigAsync(root, { platforms: ['ios', 'android'] });
  const out = await compileModsAsync(exp, {
    projectRoot: root, platforms: ['ios', 'android'], introspect: true, assertMissingModProviders: false,
  });
  const manifest = out._internal.modResults.android.manifest.manifest;
  const plist = out._internal.modResults.ios.infoPlist;
  const lines = (k) => (manifest[k] || []).map((l) => l.$);
  process.stdout.write(JSON.stringify({
    manifestAttrs: manifest.$,
    usesPermission: lines('uses-permission'),
    usesPermissionSdk23: lines('uses-permission-sdk-23'),
    usesFeature: lines('uses-feature'),
    plistUsage: Object.fromEntries(Object.entries(plist).filter(([k]) => /UsageDescription$/.test(k))),
    plugins: (exp.plugins || []).map((p) => (Array.isArray(p) ? p[0] : p)),
    staticPermissions: out.android && out.android.permissions,
    blocked: out.android && out.android.blockedPermissions,
  }));
})().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
