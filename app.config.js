// Expo loads the dynamic build config as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('./app.json').expo;

const SAMSUNG_PERMISSION =
  'com.samsung.android.hardware.sensormanager.permission.READ_ADDITIONAL_HEALTH_DATA';
// S-WEAR-3 (Opus C-317-5): nothing in the app reads these (Samsung Health data
// arrives through Health Connect; steps come from Health Connect / Apple
// Health). They are blocked in EVERY build so a library manifest cannot merge
// them back in, and the Play health declaration lists only what is read.
const NEVER_DECLARED_PERMISSIONS = [
  SAMSUNG_PERMISSION,
  'android.permission.ACTIVITY_RECOGNITION',
];
const HEALTH_CONNECT_PLUGINS = new Set([
  'react-native-health-connect',
  // #317 registers this Android-only delegate. It must follow the same switch.
  './plugins/withHealthConnectPermissionDelegate',
]);

function isHealthPermission(permission) {
  return (
    permission.startsWith('android.permission.health.') ||
    permission === SAMSUNG_PERMISSION
  );
}

// Opt in only with 1. Every other value (including unset) builds without HC.
module.exports = ({ config = app } = {}) => {
  const enabled = process.env.TGP_ANDROID_HEALTH_CONNECT === '1';
  const permissions = config.android?.permissions ?? [];
  const disabledPermissions = permissions.filter(isHealthPermission);

  const neverDeclared = (name) => NEVER_DECLARED_PERMISSIONS.includes(name);

  return {
    ...config,
    android: enabled
      ? {
          ...config.android,
          permissions: permissions.filter((name) => !neverDeclared(name)),
          blockedPermissions: [
            ...new Set([
              ...(config.android?.blockedPermissions ?? []),
              ...NEVER_DECLARED_PERMISSIONS,
            ]),
          ],
        }
      : {
          ...config.android,
          permissions: permissions.filter(
            (name) => !isHealthPermission(name) && !neverDeclared(name),
          ),
          // Manifest merger can restore library permissions unless blocked.
          blockedPermissions: [
            ...new Set([
              ...(config.android?.blockedPermissions ?? []),
              ...disabledPermissions,
              ...NEVER_DECLARED_PERMISSIONS,
            ]),
          ],
        },
    plugins: enabled
      ? config.plugins
      : config.plugins?.filter(
          (plugin) =>
            !HEALTH_CONNECT_PLUGINS.has(
              Array.isArray(plugin) ? plugin[0] : plugin,
            ),
        ),
    extra: { ...config.extra, healthConnectEnabled: enabled },
  };
};
