/**
 * M3 (AUTHA-08, DATA-11): Android auto-backup copies the app's data folder
 * (AsyncStorage, SQLite) to the person's cloud backup. That folder holds the
 * health and food cache, so backup is off in every build mode, through the
 * same Expo step that writes android:allowBackup into the manifest.
 */
const { AndroidConfig } = require('expo/config-plugins');
const configure = require('../../../app.config');

const originalSwitch = process.env.TGP_ANDROID_HEALTH_CONNECT;

afterEach(() => {
  if (originalSwitch === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = originalSwitch;
});

test.each([undefined, '1'])('the manifest turns Android backup off with TGP_ANDROID_HEALTH_CONNECT=%s', (value) => {
  if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
  const config = configure();
  expect(config.android.allowBackup).toBe(false);

  const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' } }] } };
  AndroidConfig.AllowBackup.setAllowBackup(config, manifest);
  expect(manifest.manifest.application[0].$['android:allowBackup']).toBe('false');
  expect(AndroidConfig.AllowBackup.getAllowBackupFromManifest(manifest)).toBe(false);
});
