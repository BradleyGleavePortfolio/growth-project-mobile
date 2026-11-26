// LO-992R1 mutation FM3 (ci lane only, never merge): an app plugin whose manifest mod pushes a plain CAMERA line.
const { withAndroidManifest } = require('expo/config-plugins');
module.exports = (config) => withAndroidManifest(config, (c) => {
  const lines = c.modResults.manifest['uses-permission'] || [];
  lines.push({ $: { 'android:name': 'android.permission.CAMERA' } });
  c.modResults.manifest['uses-permission'] = lines;
  return c;
});
