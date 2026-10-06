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

// OR-113-2: Apple Pay / Google Pay in the native PaymentSheet are off by
// config. The Stripe config plugin (Apple Pay entitlement, Google Pay wallet
// meta-data) is added only when a merchant ID or the Google Pay switch is
// set, with the same values src/config/wallets.ts reads at runtime, so a
// build without a merchant ID never ships a dead wallet button.
const STRIPE_PLUGIN = '@stripe/stripe-react-native';
const MERCHANT_ID_RE = /^merchant\.[A-Za-z0-9.-]+$/;

function stripeWalletPlugin() {
  const merchantIdentifier = (process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER || '').trim();
  const googleFlag = (process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED || '').trim().toLowerCase();
  const enableGooglePay = googleFlag === '1' || googleFlag === 'true';
  const apple = MERCHANT_ID_RE.test(merchantIdentifier);
  if (!apple && !enableGooglePay) return null;
  return [STRIPE_PLUGIN, { ...(apple ? { merchantIdentifier } : {}), enableGooglePay }];
}

function withWalletPlugin(plugins) {
  const wallet = stripeWalletPlugin();
  const rest = (plugins || []).filter(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) !== STRIPE_PLUGIN,
  );
  return wallet ? [...rest, wallet] : plugins;
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
    plugins: withWalletPlugin(
      enabled
        ? config.plugins
        : config.plugins?.filter(
            (plugin) =>
              !HEALTH_CONNECT_PLUGINS.has(
                Array.isArray(plugin) ? plugin[0] : plugin,
              ),
          ),
    ),
    extra: { ...config.extra, healthConnectEnabled: enabled },
  };
};
