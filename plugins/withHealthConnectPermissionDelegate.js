/* eslint-disable @typescript-eslint/no-var-requires -- Expo config plugins are CommonJS */
/**
 * S14 — Health Connect wiring that react-native-health-connect's own config
 * plugin does not do.
 *
 * 1. Permission delegate. react-native-health-connect 3.x launches the Health
 *    Connect permission screen through an ActivityResultLauncher that must be
 *    registered in MainActivity.onCreate:
 *      HealthConnectPermissionDelegate.setPermissionDelegate(this)
 *    The library's plugin only adds the rationale intent filter, so without
 *    this call `requestPermission()` throws (uninitialized launcher) and the
 *    Connect sheet reports "access wasn't granted" on every Android device.
 *
 * 2. Android 14+ permission usage entry. On Android 14 Health Connect is part
 *    of the OS and links to the app's privacy rationale through an
 *    activity-alias that handles VIEW_PERMISSION_USAGE in the
 *    HEALTH_PERMISSIONS category. (Android 13 and below use the
 *    ACTION_SHOW_PERMISSIONS_RATIONALE filter the library plugin adds.)
 *
 * 3. B-364-2: both of those land on MainActivity, which must show the privacy
 *    policy (the Play Console one, PRIVACY_POLICY_URL in src/config/env.ts).
 *    MainActivity opens it for either intent: on a cold start it then
 *    finishes, while the app is running it handles them in onNewIntent.
 *
 * All edits are idempotent so repeated prebuilds do not duplicate them.
 */
const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

const DELEGATE_IMPORT = 'dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const DELEGATE_CALL = 'HealthConnectPermissionDelegate.setPermissionDelegate(this)';
const ALIAS_NAME = 'ViewPermissionUsageActivity';
const PRIVACY_POLICY_URL = 'https://app.trygrowthproject.com/privacy';
const PRIVACY_CHECK = 'if (showHealthConnectPrivacyPolicy(intent)) finish()';
const PRIVACY_MEMBERS = `
  // B-364-2: Health Connect's privacy policy link (Android 13 rationale, Android 14+ usage).
  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    showHealthConnectPrivacyPolicy(intent)
  }

  private fun showHealthConnectPrivacyPolicy(intent: android.content.Intent?): Boolean {
    val action = intent?.action
    if (action != "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" &&
      action != "android.intent.action.VIEW_PERMISSION_USAGE") return false
    val policy = android.net.Uri.parse("${PRIVACY_POLICY_URL}")
    return try {
      startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, policy))
      true
    } catch (e: android.content.ActivityNotFoundException) {
      false
    }
  }
`;

function addDelegateToMainActivity(contents, language) {
  if (contents.includes(DELEGATE_CALL)) return contents;
  if (language === 'java') {
    throw new Error('withHealthConnectPermissionDelegate: needs a Kotlin MainActivity.');
  }
  if (/fun onNewIntent\(/.test(contents)) {
    throw new Error('withHealthConnectPermissionDelegate: MainActivity already has onNewIntent.');
  }
  const importLine = `import ${DELEGATE_IMPORT}`;
  let out = contents;
  if (!out.includes(importLine)) {
    out = out.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
  }
  const superCall = /(super\.onCreate\([^)]*\);?)/;
  if (!superCall.test(out)) {
    throw new Error(
      'withHealthConnectPermissionDelegate: MainActivity has no super.onCreate(...) call to anchor on.',
    );
  }
  out = out.replace(superCall, `$1\n    ${DELEGATE_CALL}\n    ${PRIVACY_CHECK}`);
  return out.replace(/\}\s*$/, `${PRIVACY_MEMBERS}}\n`);
}

function addPermissionUsageAlias(manifest) {
  const application = manifest.application && manifest.application[0];
  if (!application) return manifest;
  application['activity-alias'] = application['activity-alias'] || [];
  const exists = application['activity-alias'].some(
    (a) => a.$ && a.$['android:name'] === ALIAS_NAME,
  );
  if (!exists) {
    application['activity-alias'].push({
      $: {
        'android:name': ALIAS_NAME,
        'android:exported': 'true',
        'android:targetActivity': '.MainActivity',
        'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
      },
      'intent-filter': [
        {
          action: [
            {
              $: {
                'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE',
              },
            },
          ],
          category: [
            {
              $: {
                'android:name': 'android.intent.category.HEALTH_PERMISSIONS',
              },
            },
          ],
        },
      ],
    });
  }
  return manifest;
}

function withHealthConnectPermissionDelegate(config) {
  config = withMainActivity(config, (cfg) => {
    cfg.modResults.contents = addDelegateToMainActivity(
      cfg.modResults.contents,
      cfg.modResults.language,
    );
    return cfg;
  });
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults.manifest = addPermissionUsageAlias(cfg.modResults.manifest);
    return cfg;
  });
  return config;
}

module.exports = withHealthConnectPermissionDelegate;
module.exports.addDelegateToMainActivity = addDelegateToMainActivity;
module.exports.addPermissionUsageAlias = addPermissionUsageAlias;
