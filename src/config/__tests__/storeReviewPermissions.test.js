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
