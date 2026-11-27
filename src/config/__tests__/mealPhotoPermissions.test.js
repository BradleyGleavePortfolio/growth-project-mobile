/**
 * MEAL-PHOTO-M (case 12, owner 203-D8 op 1): the two rewritten iPhone permission lines and the one expo-image-picker
 * plugin entry, proven the way storeReviewPermissions.test.js proves Face ID (:96-110) and expo-audio (:66-78): the
 * resolved config and the real plugin at the pinned version (56.0.25). The plugin reads photosPermission,
 * cameraPermission and microphonePermission (plugin/build/withImagePicker.js:48-66); `false` writes no microphone line
 * and blocks RECORD_AUDIO.
 */
const app = require('../../../app.json').expo;
const configure = require('../../../app.config');

const CAMERA =
  'TGP Fitness uses the camera only when you choose to take a photo: a photo of a meal to keep with your food log, or a photo to send in a support chat.';
const LIBRARY =
  'TGP Fitness opens your photo library only when you choose a photo: a photo of a meal to keep with your food log, or a photo to send in a support chat.';
const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';
// 203-D35 op 1: nothing on Android uses the camera in v1 (the Photo tile is iPhone only), so the build blocks it.
const ANDROID_CAMERA = 'android.permission.CAMERA';
const EARLIER_BLOCKS = ['android.permission.READ_CALENDAR', 'android.permission.WRITE_CALENDAR', RECORD_AUDIO];
const originalSwitch = process.env.TGP_ANDROID_HEALTH_CONNECT;
const named = (config, name) => config.plugins.filter((p) => (Array.isArray(p) ? p[0] : p) === name);
const entry = (config) => named(config, 'expo-image-picker')[0];
const setSwitch = (value) => {
  if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
};
const realPlugin = (name) => {
  const mod = require(`${name}/app.plugin.js`);
  return mod.default || mod;
};
/** Runs the iOS Info.plist mods the plugins registered, from the given start, as prebuild does. */
const infoPlistOf = async (config, start) => {
  const { modResults } = await config.mods.ios.infoPlist({ ...config, modResults: { ...start }, modRequest: {} });
  return modResults;
};

/** The block is on the list exactly once, the three earlier blocks are still there, and nothing asks for the camera. */
const expectCameraBlocked = (android) => {
  expect((android.blockedPermissions ?? []).filter((name) => name === ANDROID_CAMERA)).toHaveLength(1);
  expect(android.blockedPermissions).toEqual(expect.arrayContaining(EARLIER_BLOCKS));
  expect(android.permissions ?? []).not.toContain(ANDROID_CAMERA);
};
const fromPackage = (name, file) => require(`${name}/${file}`);
/**
 * Runs the Android manifest mods as prebuild does, from a manifest already holding the given permission lines: after
 * the app's plugin, Expo's two permission plugins in prebuild's own order (@expo/prebuild-config
 * withAndroidExpoPlugins). Loaded by path, as realPlugin is: src/ must not import expo/config-plugins (the entry-point
 * list in declaredDependencies.test.ts).
 */
const usesPermissionsOf = async (config, start) => {
  const { withInternalBlockedPermissions, withPermissions } = fromPackage('expo', 'config-plugins').AndroidConfig.Permissions;
  const built = withPermissions(withInternalBlockedPermissions(config));
  const { modResults } = await built.mods.android.manifest({
    ...built,
    modResults: { manifest: { $: {}, 'uses-permission': start.map((name) => ({ $: { 'android:name': name } })) } },
    modRequest: {},
  });
  return modResults.manifest['uses-permission'].map((line) => line.$);
};

afterEach(() => setSwitch(originalSwitch));

describe('the two iPhone lines (R9)', () => {
  test('Info.plist carries the rewritten camera and photo library lines; the save-image line is unchanged', () => {
    expect(app.ios.infoPlist.NSCameraUsageDescription).toBe(CAMERA);
    expect(app.ios.infoPlist.NSPhotoLibraryUsageDescription).toBe(LIBRARY);
    expect(app.ios.infoPlist.NSPhotoLibraryAddUsageDescription).toBe(
      'TGP Fitness saves an image to your photo library only when you choose Save Image, for example a progress card or an invite QR code.',
    );
    expect(app.ios.infoPlist).not.toHaveProperty('NSMicrophoneUsageDescription');
  });

  test('one expo-image-picker entry, with the same texts and microphonePermission false, after expo-audio', () => {
    expect(named(app, 'expo-image-picker')).toHaveLength(1);
    expect(entry(app)[1]).toEqual({ photosPermission: LIBRARY, cameraPermission: CAMERA, microphonePermission: false });
    // Mods run last-added first: placed after expo-audio, the picker's `false` runs before expo-audio writes its line.
    const at = (name) => app.plugins.findIndex((p) => (Array.isArray(p) ? p[0] : p) === name);
    expect(at('expo-image-picker')).toBeGreaterThan(at('expo-audio'));
  });
});

describe('Android: the unused camera permission is blocked (203-D35 op 1)', () => {
  test('app.json blocks android.permission.CAMERA once, keeps the three earlier blocks and never asks for it', () => {
    expectCameraBlocked(app.android);
  });

  test.each([undefined, '1'])('app.config.js keeps that block (TGP_ANDROID_HEALTH_CONNECT=%s)', (value) => {
    setSwitch(value);
    expectCameraBlocked(configure().android);
  });
});

describe.each([undefined, '1'])('the real plugin (TGP_ANDROID_HEALTH_CONNECT=%s)', (value) => {
  test('it writes the same two lines and no microphone line of its own', async () => {
    setSwitch(value);
    const result = JSON.parse(JSON.stringify(configure()));
    expect(result.ios.infoPlist.NSCameraUsageDescription).toBe(CAMERA);
    expect(result.ios.infoPlist.NSPhotoLibraryUsageDescription).toBe(LIBRARY);
    const generated = realPlugin('expo-image-picker')(result, entry(result)[1]);
    const plist = await infoPlistOf(generated, {});
    expect(plist.NSCameraUsageDescription).toBe(CAMERA);
    expect(plist.NSPhotoLibraryUsageDescription).toBe(LIBRARY);
    expect(plist).not.toHaveProperty('NSMicrophoneUsageDescription');
  });

  test('in app.json\'s order the voice-note microphone line expo-audio writes survives, in its own words', async () => {
    setSwitch(value);
    let config = JSON.parse(JSON.stringify(configure()));
    const audio = named(config, 'expo-audio')[0];
    config = realPlugin('expo-audio')(config, audio[1]);
    config = realPlugin('expo-image-picker')(config, entry(config)[1]);
    const plist = await infoPlistOf(config, {});
    expect(plist.NSMicrophoneUsageDescription).toBe(audio[1].microphonePermission);
    expect(plist.NSCameraUsageDescription).toBe(CAMERA);
  });

  test('Android: it adds no permission, and RECORD_AUDIO stays blocked', () => {
    setSwitch(value);
    const result = JSON.parse(JSON.stringify(configure()));
    const before = [...(result.android.permissions ?? [])];
    const generated = realPlugin('expo-image-picker')(result, entry(result)[1]);
    expect(generated.android.permissions ?? []).toEqual(before);
    expect(generated.android.permissions ?? []).not.toContain(RECORD_AUDIO);
    expect(generated.android.blockedPermissions).toContain(RECORD_AUDIO);
    expect(generated.android.blockedPermissions).toEqual(expect.arrayContaining(app.android.blockedPermissions));
  });

  test('Android: after the picker runs the camera and RECORD_AUDIO are still blocked, and nothing is added', () => {
    setSwitch(value);
    const result = JSON.parse(JSON.stringify(configure()));
    const before = [...(result.android.permissions ?? [])];
    const generated = realPlugin('expo-image-picker')(result, entry(result)[1]);
    expectCameraBlocked(generated.android);
    expect(generated.android.blockedPermissions).toContain(RECORD_AUDIO);
    expect(generated.android.permissions ?? []).toEqual(before);
  });

  // A library's manifest (expo-image-picker's own) declares the camera; the second start stands in for that line.
  test.each([[[]], [[ANDROID_CAMERA]]])(
    'Android: the generated manifest holds one camera line, marked tools:node="remove", and no plain one (start %j)',
    async (start) => {
      setSwitch(value);
      const result = JSON.parse(JSON.stringify(configure()));
      const generated = realPlugin('expo-image-picker')(result, entry(result)[1]);
      const lines = await usesPermissionsOf(generated, start);
      expect(lines.filter((line) => line['android:name'] === ANDROID_CAMERA)).toEqual([
        { 'android:name': ANDROID_CAMERA, 'tools:node': 'remove' },
      ]);
      expect(lines.filter((line) => line['android:name'] === RECORD_AUDIO)).toEqual([
        { 'android:name': RECORD_AUDIO, 'tools:node': 'remove' },
      ]);
    },
  );
});
