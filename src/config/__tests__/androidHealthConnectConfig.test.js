const app = require('../../../app.json').expo;
const configure = require('../../../app.config');
const eas = require('../../../eas.json');

const SAMSUNG =
  'com.samsung.android.hardware.sensormanager.permission.READ_ADDITIONAL_HEALTH_DATA';
const isHealthPermission = (name) =>
  name.startsWith('android.permission.health.') || name === SAMSUNG;
const pluginNames = (config) =>
  config.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin));
const originalSwitch = process.env.TGP_ANDROID_HEALTH_CONNECT;

afterEach(() => {
  if (originalSwitch === undefined)
    delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = originalSwitch;
});

test.each([undefined, '', '0', 'false', 'true', 'unexpected'])(
  'defaults OFF for %s and blocks every removed manifest permission',
  (value) => {
    if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
    else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
    const result = configure();
    expect(result.extra.healthConnectEnabled).toBe(false);
    expect(result.android.permissions).toEqual(
      app.android.permissions.filter((name) => !isHealthPermission(name)),
    );
    expect(result.android.permissions.some(isHealthPermission)).toBe(false);
    expect(result.android.blockedPermissions).toEqual(
      expect.arrayContaining(
        app.android.permissions.filter(isHealthPermission),
      ),
    );
    expect(pluginNames(result)).not.toContain('react-native-health-connect');
    expect(result.ios).toEqual(app.ios);
    expect(pluginNames(result)).toContain('react-native-health');
    // The switch never changes the build number; the value itself is pinned in
    // scripts/__tests__/validateAppConfigUpdates.test.js (bumped to 5 by #305).
    expect(result.android.versionCode).toBe(app.android.versionCode);
    expect(result.android.versionCode).toBe(5);
    expect(result.android.package).toBe('com.growthproject.app');
    expect(result.extra.eas).toEqual(app.extra.eas);
  },
);

const NEVER_DECLARED = [SAMSUNG, 'android.permission.ACTIVITY_RECOGNITION'];

test('S-WEAR-3 (Opus C-317-5): no Samsung sensor or activity-recognition permission is declared; both are blocked in every build', () => {
  expect(app.android.permissions).not.toContain(SAMSUNG);
  expect(app.android.permissions).not.toContain('android.permission.ACTIVITY_RECOGNITION');
  for (const value of ['1', '0', undefined]) {
    if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
    else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
    const result = configure();
    for (const name of NEVER_DECLARED) {
      expect(result.android.permissions).not.toContain(name);
      expect(result.android.blockedPermissions).toContain(name);
    }
  }
  // A config that still lists them (an old app.json) is cleaned in both modes.
  const legacy = {
    ...app,
    android: { ...app.android, permissions: [...app.android.permissions, ...NEVER_DECLARED] },
  };
  process.env.TGP_ANDROID_HEALTH_CONNECT = '1';
  expect(configure({ config: legacy }).android.permissions).toEqual(app.android.permissions);
});

test('ON preserves every Android declaration, all plugins and all iOS settings', () => {
  process.env.TGP_ANDROID_HEALTH_CONNECT = '1';
  const result = configure();
  expect(result.android).toEqual({
    ...app.android,
    blockedPermissions: [...(app.android.blockedPermissions ?? []), ...NEVER_DECLARED],
  });
  expect(result.plugins).toEqual(app.plugins);
  expect(result.ios).toEqual(app.ios);
  expect(result.extra).toEqual({ ...app.extra, healthConnectEnabled: true });
});

test('OFF handles future #317 permissions/plugins, tuples, existing blocks, and is pure/idempotent', () => {
  delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  const input = {
    ...app,
    android: {
      ...app.android,
      permissions: [
        ...app.android.permissions,
        'android.permission.health.READ_RESTING_HEART_RATE',
        'android.permission.health.READ_FUTURE_RECORD',
      ],
      blockedPermissions: ['android.permission.RECORD_AUDIO', SAMSUNG],
    },
    plugins: [
      ...app.plugins.filter(
        (plugin) => plugin !== 'react-native-health-connect',
      ),
      ['react-native-health-connect', {}],
      ['./plugins/withHealthConnectPermissionDelegate', {}],
    ],
  };
  const before = JSON.stringify(input);
  const result = configure({ config: input });
  expect(result.android.permissions.some(isHealthPermission)).toBe(false);
  expect(result.android.blockedPermissions).toEqual(
    expect.arrayContaining([
      ...input.android.permissions.filter(isHealthPermission),
      'android.permission.RECORD_AUDIO',
    ]),
  );
  expect(new Set(result.android.blockedPermissions).size).toBe(
    result.android.blockedPermissions.length,
  );
  expect(pluginNames(result)).not.toContain('react-native-health-connect');
  expect(pluginNames(result)).not.toContain(
    './plugins/withHealthConnectPermissionDelegate',
  );
  expect(result.ios).toEqual(input.ios);
  expect(JSON.stringify(input)).toBe(before);
  expect(configure({ config: result })).toEqual(result);

  process.env.TGP_ANDROID_HEALTH_CONNECT = '1';
  const enabled = configure({ config: input });
  expect(enabled.android.permissions).toEqual(input.android.permissions);
  expect(enabled.android.blockedPermissions).toEqual(
    expect.arrayContaining([...input.android.blockedPermissions, ...NEVER_DECLARED]),
  );
  expect(enabled.plugins).toEqual(input.plugins);
});

test('production and preview explicitly opt out; the clinic launch profile opts in (S14 round 3)', () => {
  expect(eas.build.production.env.TGP_ANDROID_HEALTH_CONNECT).toBe('0');
  expect(eas.build.preview.env.TGP_ANDROID_HEALTH_CONNECT).toBe('0');
  expect(eas.build.clinic.extends).toBe('production');
  // Health Connect returns in the clinic binary after #317's isolation fixes.
  // A new Android binary is required (native permissions); never an OTA.
  expect(eas.build.clinic.env.TGP_ANDROID_HEALTH_CONNECT).toBe('1');
});
