/**
 * STORE-04 / STORE-05 (M4a): the iOS privacy manifest (expo.ios.privacyManifests,
 * merged into PrivacyInfo.xcprivacy by @expo/config-plugins withPrivacyInfo).
 *
 * Required-reason APIs: a pod whose podspec bundles its own PrivacyInfo.xcprivacy
 * declares itself (the SDK 56 Podfile aggregates those into the app manifest).
 * Every other installed pod that calls one of these APIs must be declared here,
 * so a new dependency with an undeclared call fails this test.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../../..');
const NM = path.join(ROOT, 'node_modules');
const manifest = require('../../../app.json').expo.ios.privacyManifests;
const configure = require('../../../app.config');

const CATEGORY = {
  UserDefaults: /\b(NS)?UserDefaults\b/,
  FileTimestamp:
    /contentModificationDateKey|creationDateKey|contentAccessDateKey|NSFile(Creation|Modification)Date|FileAttributeKey\.(creationDate|modificationDate)|getattrlist|[^\w.](f|l)?stat\(/,
  SystemBootTime: /systemUptime|mach_absolute_time/,
  DiskSpace: /volume(Available|Total)Capacity|NSFileSystem(Free)?Size|[^\w.]statv?fs\(/,
  ActiveKeyboards: /activeInputModes/,
};

// Pods without their own manifest: category -> reason, with the call that needs it.
const UNCOVERED = {
  '@stripe/stripe-react-native': { UserDefaults: 'CA92.1' }, // ios/StripeSdkImpl.swift:170
  'expo-document-picker': { FileTimestamp: '3B52.1' }, // ios/DocumentPickerModule.swift:136, user-picked file
  'expo-eas-client': { UserDefaults: 'CA92.1' }, // ios/EASClient/EASClientID.swift:10
  'expo-sharing': { UserDefaults: 'CA92.1' }, // ios/SharingModule.swift:95, app-group suite unused (no app group)
  // vendor/sqlite3/sqlite3.c (compiled into the pod): fstat/stat on the app's own
  // database files, and fstatfs on open (line 45304) to read the volume type so it
  // knows how to write the file. E174.1 is the only DiskSpace reason this use can
  // meet (85F4.1 shows space to the user, 7D9E.1 is a bug report, B728.1 is a
  // health-research-only app); SQLCipher ships E174.1 for the same code.
  'expo-sqlite': { FileTimestamp: 'C617.1', DiskSpace: 'E174.1' },
  'expo-updates': { UserDefaults: 'CA92.1' }, // ios/EXUpdates/UpdatesConfigOverride.swift:15
  'expo-video': { UserDefaults: 'CA92.1', FileTimestamp: 'C617.1' }, // ios/Cache/VideoCacheManager.swift:11,173
};

const SKIP_DIRS = new Set(['android', 'node_modules', 'example', 'Tests', 'tests', '__tests__', 'build', 'lib']);
function nativeSources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) nativeSources(full, out);
    } else if (/\.(m|mm|swift|h|c|cpp)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function installedPods() {
  const names = [];
  for (const name of fs.readdirSync(NM)) {
    if (name.startsWith('.')) continue;
    if (name.startsWith('@')) fs.readdirSync(path.join(NM, name)).forEach((n) => names.push(`${name}/${n}`));
    else names.push(name);
  }
  return names
    .filter((name) => name !== 'react-native') // core reasons are added by the Podfile aggregation itself
    .map((name) => {
      const dir = path.join(NM, name);
      const podspecs = ['.', 'ios', 'apple']
        .map((sub) => path.join(dir, sub))
        .filter((d) => fs.existsSync(d) && fs.statSync(d).isDirectory())
        .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.podspec')).map((f) => path.join(d, f)));
      return { name, dir, podspecs };
    })
    .filter((pod) => pod.podspecs.length > 0);
}

describe('M4a: iOS privacy manifest', () => {
  test('required-reason APIs of pods without their own manifest are declared, and nothing else', () => {
    const found = {};
    for (const pod of installedPods()) {
      if (pod.podspecs.some((p) => fs.readFileSync(p, 'utf8').includes('PrivacyInfo.xcprivacy'))) continue;
      const text = nativeSources(pod.dir).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
      const used = Object.keys(CATEGORY).filter((c) => CATEGORY[c].test(text));
      if (used.length) found[pod.name] = used.sort();
    }
    const expected = Object.fromEntries(
      Object.entries(UNCOVERED).map(([name, reasons]) => [name, Object.keys(reasons).sort()]),
    );
    expect(found).toEqual(expected);

    const declared = {};
    for (const t of manifest.NSPrivacyAccessedAPITypes) {
      declared[t.NSPrivacyAccessedAPIType.replace('NSPrivacyAccessedAPICategory', '')] = t.NSPrivacyAccessedAPITypeReasons;
    }
    const needed = {};
    for (const reasons of Object.values(UNCOVERED)) {
      for (const [category, reason] of Object.entries(reasons)) {
        needed[category] = [...new Set([...(needed[category] || []), reason])];
      }
    }
    expect(Object.keys(declared).sort()).toEqual(Object.keys(needed).sort());
    for (const category of Object.keys(needed)) {
      expect([...declared[category]].sort()).toEqual([...needed[category]].sort());
    }
  });

  test('the only SQLite disk-space call built for iOS is the fstatfs volume-type check', () => {
    const dir = path.join(NM, 'expo-sqlite');
    expect(fs.readFileSync(path.join(dir, 'ios/ExpoSQLite.podspec'), 'utf8')).toContain('-DSQLITE_ENABLE_LOCKING_STYLE=0');
    const src = fs.readFileSync(path.join(dir, 'vendor/sqlite3/sqlite3.c'), 'utf8');
    expect(src).toContain(
      '#if defined(__APPLE__) || SQLITE_ENABLE_LOCKING_STYLE\n  if( fstatfs(fd, &fsInfo) == -1 ){',
    );
    expect(src).not.toMatch(/f_bavail|f_bfree/); // never reads free space
  });

  test('no tracking and no tracking domains', () => {
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
  });

  // Collected type -> purposes, and the code that collects it (file must contain the anchor).
  const COLLECTED = [
    ['Health', ['AppFunctionality'], 'src/services/health/healthkit/healthKitClient.ts', 'AppleHealthKit.getHeartRateSamples'],
    ['Fitness', ['AppFunctionality'], 'src/services/health/healthkit/healthKitClient.ts', 'AppleHealthKit.getDailyStepCountSamples'],
    ['EmailAddress', ['AppFunctionality'], 'src/services/api.ts', "data: { email: string; password: string; name: string"],
    ['Name', ['AppFunctionality'], 'src/services/api.ts', "api.post<RegisterResponse>('/auth/register', body)"],
    ['PhoneNumber', ['AppFunctionality'], 'src/screens/auth/CreateAccountScreen.tsx', 'phone: phone || undefined'],
    ['UserID', ['AppFunctionality', 'Analytics'], 'src/services/sentry.ts', 'Sentry.setUser({ id: user.id })'],
    ['EmailsOrTextMessages', ['AppFunctionality'], 'src/api/messagesApi.ts', "api.post('/messages', {"],
    ['PhotosorVideos', ['AppFunctionality'], 'src/api/coachMediaApi.ts', 'uploadAsync(url, file.uri'],
    ['OtherUserContent', ['AppFunctionality'], 'src/api/communityWinsApi.ts', "api.post<unknown>('/community/wins'"],
    ['CustomerSupport', ['AppFunctionality'], 'src/services/support/crisp.service.ts', 'export function openSupportChat'],
    ['CrashData', ['AppFunctionality'], 'src/services/sentry.ts', 'enableNative: true'],
    ['PerformanceData', ['AppFunctionality'], 'src/services/sentry.ts', 'tracesSampleRate:'],
    ['ProductInteraction', ['Analytics'], 'src/lib/analytics.ts', 'getClient()?.capture(event'],
    // Pregnancy or childbirth answer in the consultation (on in production, eas.json).
    ['SensitiveInfo', ['AppFunctionality'], 'src/lib/consultation/definitions.ts', 'Are you currently pregnant, or have you given birth in the last 6 months?'],
    ['PurchaseHistory', ['AppFunctionality'], 'src/lib/packagePayment.ts', 'export const PAYMENT_INTENT_PATH = "/v1/checkout/payment-intent"'],
  ];

  test('collected data types match the code that collects them, linked to the account, never tracking', () => {
    const byType = Object.fromEntries(
      manifest.NSPrivacyCollectedDataTypes.map((t) => [t.NSPrivacyCollectedDataType.replace('NSPrivacyCollectedDataType', ''), t]),
    );
    expect(Object.keys(byType).sort()).toEqual(COLLECTED.map(([type]) => type).sort());
    for (const [type, purposes, file, anchor] of COLLECTED) {
      expect(fs.readFileSync(path.join(ROOT, file), 'utf8')).toContain(anchor);
      expect(byType[type].NSPrivacyCollectedDataTypeLinked).toBe(true);
      expect(byType[type].NSPrivacyCollectedDataTypeTracking).toBe(false);
      expect(byType[type].NSPrivacyCollectedDataTypePurposes).toEqual(
        purposes.map((p) => `NSPrivacyCollectedDataTypePurpose${p}`),
      );
    }
  });

  test.each([undefined, '1'])('the resolved config keeps the manifest (TGP_ANDROID_HEALTH_CONNECT=%s)', (value) => {
    const saved = process.env.TGP_ANDROID_HEALTH_CONNECT;
    if (value === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
    else process.env.TGP_ANDROID_HEALTH_CONNECT = value;
    try {
      expect(configure().ios.privacyManifests).toEqual(manifest);
    } finally {
      if (saved === undefined) delete process.env.TGP_ANDROID_HEALTH_CONNECT;
      else process.env.TGP_ANDROID_HEALTH_CONNECT = saved;
    }
  });
});
