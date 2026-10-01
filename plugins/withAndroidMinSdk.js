/**
 * Raises the Android minSdkVersion through gradle.properties
 * (`android.minSdkVersion`, read by Expo's autolinking version catalog).
 *
 * Why: androidx.health.connect:connect-client (pulled in by
 * react-native-health-connect) declares minSdk 26; Expo SDK 56 defaults to 24,
 * so the release manifest merge fails without this. Android 8.0+ only.
 */
const { withGradleProperties } = require('expo/config-plugins');

module.exports = function withAndroidMinSdk(config, props = {}) {
  const minSdkVersion = String(props.minSdkVersion ?? 26);
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'android.minSdkVersion'),
    );
    cfg.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: minSdkVersion });
    return cfg;
  });
};
