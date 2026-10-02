// Expo loads the dynamic build config as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('./app.json').expo;

const SAMSUNG_PERMISSION =
  'com.samsung.android.hardware.sensormanager.permission.READ_ADDITIONAL_HEALTH_DATA';
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

  return {
    ...config,
    android: enabled
      ? config.android
      : {
          ...config.android,
          permissions: permissions.filter((name) => !isHealthPermission(name)),
          // Manifest merger can restore library permissions unless blocked.
          blockedPermissions: [
            ...new Set([
              ...(config.android?.blockedPermissions ?? []),
              ...disabledPermissions,
              SAMSUNG_PERMISSION,
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
