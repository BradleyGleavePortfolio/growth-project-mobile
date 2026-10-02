/**
 * Expo module Android build guard (crisp-sdk-react-native 0.2.1 crashed the
 * Android build on Expo SDK 56 through the legacy ExpoModulesCorePlugin.gradle
 * / applyKotlinExpoModulesCorePlugin path).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const guard = require('../check-expo-module-gradle');

const ROOT = path.resolve(__dirname, '..', '..');
// The install tree to check. CI runs `npm ci`, so ROOT is the real tree. The
// override exists only to verify locally against an overlay when a shared
// node_modules is stale; CI never sets it.
const INSTALL_ROOT = process.env.EXPO_MODULE_GUARD_ROOT || ROOT;

const LEGACY_GRADLE = [
  "apply plugin: 'com.android.library'",
  'def expoModulesCorePlugin = new File(project(":expo-modules-core").projectDir.absolutePath, "ExpoModulesCorePlugin.gradle")',
  'apply from: expoModulesCorePlugin',
  'applyKotlinExpoModulesCorePlugin()',
].join('\n');
const PLUGIN_GRADLE = "plugins {\n  id 'com.android.library'\n  id 'expo-module-gradle-plugin'\n}\n";

function makePkg(nm, name, version, gradle, { expoModule = true, file = 'android/build.gradle' } = {}) {
  const dir = path.join(nm, ...name.split('/'));
  fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
  if (expoModule) fs.writeFileSync(path.join(dir, 'expo-module.config.json'), '{"platforms":["android"]}');
  if (gradle !== null) fs.writeFileSync(path.join(dir, file), gradle);
  return dir;
}

describe('check-expo-module-gradle', () => {
  it('the installed tree has no Expo module on the legacy Gradle path, and crisp is on 0.4.x+', () => {
    const { errors, modules } = guard.check(INSTALL_ROOT);
    expect(errors).toEqual([]);
    expect(modules.length).toBeGreaterThan(5);
    const crisp = modules.find((m) => m.startsWith('crisp-sdk-react-native@'));
    expect(crisp).toBeDefined();
    expect(crisp).not.toMatch(/@0\.[0-3]\./);
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    expect(lock.packages['node_modules/crisp-sdk-react-native'].version).not.toMatch(/^0\.[0-3]\./);
  });

  it.each([
    ['the crisp 0.2.1 legacy block', LEGACY_GRADLE, ['apply-ExpoModulesCorePlugin.gradle', 'applyKotlinExpoModulesCorePlugin()']],
    ['only the apply-from', 'apply from: "../expo-modules-core/ExpoModulesCorePlugin.gradle"', ['apply-ExpoModulesCorePlugin.gradle']],
    ['only the function call', 'applyKotlinExpoModulesCorePlugin ()', ['applyKotlinExpoModulesCorePlugin()']],
    ['the modern plugin block', PLUGIN_GRADLE, []],
    ['a commented-out migration note', '// was: applyKotlinExpoModulesCorePlugin()\n' + PLUGIN_GRADLE, []],
  ])('findLegacyGradle: %s', (_label, text, ids) => {
    expect(guard.findLegacyGradle(text)).toEqual(ids);
  });

  describe('fixture install tree', () => {
    let root;
    beforeAll(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-gradle-guard-'));
      const nm = path.join(root, 'node_modules');
      makePkg(nm, 'legacy-top', '0.2.1', LEGACY_GRADLE);
      makePkg(nm, '@scope/legacy-scoped', '1.0.0', 'applyKotlinExpoModulesCorePlugin()', {
        file: 'android/build.gradle.kts',
      });
      makePkg(nm, 'modern', '0.4.3', PLUGIN_GRADLE);
      makePkg(nm, 'not-an-expo-module', '1.0.0', LEGACY_GRADLE, { expoModule: false });
      makePkg(nm, 'expo-modules-core', '3.0.0', 'applyKotlinExpoModulesCorePlugin()', {
        file: 'android/ExpoModulesCorePlugin.gradle',
      });
      makePkg(nm, 'no-android', '1.0.0', null);
      const parent = makePkg(nm, 'parent', '1.0.0', null, { expoModule: false });
      makePkg(path.join(parent, 'node_modules'), 'legacy-nested', '0.1.0', LEGACY_GRADLE);
    });

    it('flags top-level, scoped (.kts) and nested legacy modules; exempts expo-modules-core and non-modules', () => {
      const { errors, modules } = guard.check(root);
      expect(errors.map((e) => e.package).sort()).toEqual([
        '@scope/legacy-scoped@1.0.0',
        'legacy-nested@0.1.0',
        'legacy-top@0.2.1',
      ]);
      expect(modules).toContain('modern@0.4.3');
      expect(modules).toContain('expo-modules-core@3.0.0');
      expect(modules).not.toContain('not-an-expo-module@1.0.0');
    });

    it('the CLI exits 1 on the fixture and names the package', () => {
      const { spawnSync } = require('child_process');
      const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'check-expo-module-gradle.js'), '--root', root], {
        encoding: 'utf8',
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('legacy-top@0.2.1');
    });
  });
});
