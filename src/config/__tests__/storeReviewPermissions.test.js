/**
 * Store-review permissions for the 10-07 build (M-STORE-123).
 *
 * B-IOSREV-1: iOS ends the app when a framework touches the camera or the
 * photo library without a purpose string. The share sheet's "Save Image"
 * (progress card, invite QR) writes to the photo library, and the Crisp
 * support chat can take or pick a photo, so all three keys must be present
 * with specific text. App Store Connect also rejects such a binary at upload
 * (ITMS-90683).
 *
 * B-PLAYREV-1: voice notes are off in every store profile, so the Android
 * build must not declare RECORD_AUDIO. expo-audio adds it unless
 * `recordAudioAndroid` is false; the manifest merger can also restore it from
 * a library, so it is blocked as well.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const app = require('../../../app.json').expo;
const eas = require('../../../eas.json');
const configure = require('../../../app.config');

const RECORD_AUDIO = 'android.permission.RECORD_AUDIO';
const originalSwitch = process.env.TGP_ANDROID_HEALTH_CONNECT;

afterEach(() => {
  if (originalSwitch === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
  else process.env.TGP_ANDROID_HEALTH_CONNECT = originalSwitch;
});

describe('B-IOSREV-1: iOS camera and photo-library purpose strings', () => {
  test.each([
    ['NSCameraUsageDescription', /camera only when you choose to take a photo/],
    ['NSPhotoLibraryUsageDescription', /photo library only when you choose a photo/],
    ['NSPhotoLibraryAddUsageDescription', /only when you choose Save Image/],
  ])('%s is present and names its purpose', (key, purpose) => {
    const text = app.ios.infoPlist[key];
    expect(typeof text).toBe('string');
    expect(text).toMatch(/^The Growth Project /);
    expect(text).toMatch(purpose);
    expect(text).not.toMatch(/!|\b(we|our|us|I)\b/);
  });

  test.each([undefined, '1'])('the resolved config keeps them (TGP_ANDROID_HEALTH_CONNECT=%s)', (value) => {
    if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
    else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
    const result = configure();
    for (const key of [
      'NSCameraUsageDescription',
      'NSPhotoLibraryUsageDescription',
      'NSPhotoLibraryAddUsageDescription',
    ]) {
      expect(result.ios.infoPlist[key]).toBe(app.ios.infoPlist[key]);
    }
  });
});

describe('B-PLAYREV-1: no Android microphone permission while voice notes are off', () => {
  const audioEntry = () => app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-audio');

  test('expo-audio is configured with recordAudioAndroid false', () => {
    expect(audioEntry()[1].recordAudioAndroid).toBe(false);
  });

  test.each([undefined, '1'])(
    'the real expo-audio plugin adds no RECORD_AUDIO and the permission is blocked (TGP_ANDROID_HEALTH_CONNECT=%s)',
    (value) => {
      if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
      else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
      const result = JSON.parse(JSON.stringify(configure()));
      const pluginModule = require('expo-audio/app.plugin.js');
      const withAudio = pluginModule.default || pluginModule;
      const entry = result.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-audio');
      const withPlugin = withAudio(result, entry[1]);
      expect(withPlugin.android.permissions ?? []).not.toContain(RECORD_AUDIO);
      expect(withPlugin.android.blockedPermissions).toContain(RECORD_AUDIO);
    },
  );

  test('voice notes stay off in every store profile, so no screen records audio', () => {
    const flags = fs.readFileSync(path.join(ROOT, 'src/config/featureFlags.ts'), 'utf8');
    expect(flags).toMatch(/communityVoiceNotes: readFlag\('EXPO_PUBLIC_FF_COMMUNITY_VOICE_NOTES', false\)/);
    for (const [name, profile] of Object.entries(eas.build)) {
      const v = profile.env?.EXPO_PUBLIC_FF_COMMUNITY_VOICE_NOTES;
      expect([name, v === undefined || v === 'false']).toEqual([name, true]);
    }
    // The only recording surface is the voice composer route, registered only
    // with the flag on.
    const nav = fs.readFileSync(path.join(ROOT, 'src/navigation/CommunityNavigator.tsx'), 'utf8');
    expect(nav).toMatch(/featureFlags\.communityVoiceNotes \? \(\s*<CommunityStack\.Screen\s*name="CommunityVoiceComposer"/);
  });
});

describe('IOS-RELEASE-129: the Face ID purpose string names what Face ID does', () => {
  const pluginText = () =>
    app.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-local-authentication')[1].faceIDPermission;

  test('Info.plist and the expo-local-authentication plugin carry the same text', () => {
    expect(app.ios.infoPlist.NSFaceIDUsageDescription).toBe(pluginText());
  });

  test('it names unlocking only: Face ID gates reopening the app (BiometricUnlockSetting), nothing else', () => {
    const text = app.ios.infoPlist.NSFaceIDUsageDescription;
    expect(text).toMatch(/^The Growth Project /);
    expect(text).toMatch(/unlock the app/);
    expect(text).not.toMatch(/sensitive actions|confirm/i);
    expect(text).not.toMatch(/!|\b(we|our|us|I)\b/);
  });
});

describe('HEALTH-STRINGS-130: Apple Health purpose strings match read-only use', () => {
  const healthEntry = (config) =>
    config.plugins.find((p) => Array.isArray(p) && p[0] === 'react-native-health');
  const purposeKeys = [
    ['NSHealthShareUsageDescription', 'healthSharePermission'],
    ['NSHealthUpdateUsageDescription', 'healthUpdatePermission'],
  ];

  test('the read purpose names shared coach data and conditional Roman summaries', () => {
    const text = app.ios.infoPlist.NSHealthShareUsageDescription;
    expect(text).toMatch(/Roman.*daily summaries.*when you allow AI access/);
    expect(text).toMatch(/your coach.*data you share/i);
    expect(text).not.toMatch(/!|\b(we|our|us|I)\b/);
  });

  test('the update purpose makes no promise to write workouts or other data', () => {
    const text = app.ios.infoPlist.NSHealthUpdateUsageDescription;
    expect(text).toMatch(/does not write data to Apple Health/);
    expect(text).not.toMatch(/may write|write workouts|!|\b(we|our|us|I)\b/);
  });

  test.each(purposeKeys)('%s matches the react-native-health plugin option', (key, option) => {
    expect(healthEntry(app)[1][option]).toBe(app.ios.infoPlist[key]);
  });

  test.each([undefined, '1'])(
    'the real plugin generates the same iOS strings (TGP_ANDROID_HEALTH_CONNECT=%s)',
    async (value) => {
      if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
      else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
      const result = JSON.parse(JSON.stringify(configure()));
      const withHealthKit = require('react-native-health/app.plugin.js');
      const generated = withHealthKit(result, healthEntry(result)[1]);
      const { modResults } = await generated.mods.ios.infoPlist({
        ...generated,
        modResults: {},
        modRequest: {},
      });
      for (const [key] of purposeKeys) {
        expect(modResults[key]).toBe(app.ios.infoPlist[key]);
      }
    },
  );
});
