/**
 * S14 — native config the wearables path depends on (app.json + local plugin).
 *
 * Guards the breaks found in the S14 trace:
 *  - every Health Connect record type the sync reads has its READ_* permission
 *    declared (RestingHeartRate was missing, so its read always failed);
 *  - the Health Connect permission delegate is registered in MainActivity
 *    (without it `requestPermission()` throws on every Android device);
 *  - the Android 14 permission usage alias exists;
 *  - Apple Health has its plugin, usage strings, and (through the plugin) the
 *    HealthKit entitlement.
 */

import * as fs from 'fs';
import * as path from 'path';

import { HEALTH_CONNECT_RECORD_TYPES } from '../healthConnect/healthConnectClient';
import { PRIVACY_POLICY_URL } from '../../../config/env';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')) as {
  expo: {
    android: { permissions: string[] };
    plugins: (string | [string, Record<string, unknown>])[];
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('../../../../plugins/withHealthConnectPermissionDelegate') as ((
  config: Record<string, unknown>,
) => ModConfig) & {
  addDelegateToMainActivity: (contents: string, language: string) => string;
  addPermissionUsageAlias: (manifest: Record<string, unknown>) => {
    application: { 'activity-alias': { $: Record<string, string> }[] }[];
  };
};

type ModFn = (config: Record<string, unknown>) => Promise<{
  modResults: { contents?: string; manifest?: Record<string, unknown> };
}>;
type ModConfig = {
  mods: { android: { mainActivity: ModFn; manifest: ModFn } };
};

/** Run one registered mod the way prebuild does (end of the mod chain). */
async function runMod(
  modName: 'mainActivity' | 'manifest',
  modResults: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = plugin({ name: 'tgp', slug: 'tgp' });
  const out = await config.mods.android[modName]({
    ...config,
    modResults,
    modRequest: {
      nextMod: async (c: unknown) => c,
      platform: 'android',
      modName,
      introspect: false,
      projectRoot: '/tmp',
    },
  });
  return out.modResults;
}

/** MainActivity.onCreate exactly as decompiled from the 09-30 clinic APK. */
const APK_MAIN_ACTIVITY = `package com.growthproject.app

import android.os.Bundle
import com.facebook.react.ReactActivity
import expo.modules.splashscreen.SplashScreenManager

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
  }
}
`;

const RECORD_TYPE_PERMISSION: Record<(typeof HEALTH_CONNECT_RECORD_TYPES)[number], string> = {
  Steps: 'READ_STEPS',
  ActiveCaloriesBurned: 'READ_ACTIVE_CALORIES_BURNED',
  HeartRate: 'READ_HEART_RATE',
  RestingHeartRate: 'READ_RESTING_HEART_RATE',
  Vo2Max: 'READ_VO2_MAX',
  ExerciseSession: 'READ_EXERCISE',
  Distance: 'READ_DISTANCE',
  Weight: 'READ_WEIGHT',
  BodyFat: 'READ_BODY_FAT',
  BloodPressure: 'READ_BLOOD_PRESSURE',
  SleepSession: 'READ_SLEEP',
  HeartRateVariabilityRmssd: 'READ_HEART_RATE_VARIABILITY',
  OxygenSaturation: 'READ_OXYGEN_SATURATION',
  RespiratoryRate: 'READ_RESPIRATORY_RATE',
  BodyTemperature: 'READ_BODY_TEMPERATURE',
};

const pluginNames = appJson.expo.plugins.map((p) => (Array.isArray(p) ? p[0] : p));

const EXPO_MAIN_ACTIVITY = `package com.growthproject.app

import android.os.Bundle
import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }
}
`;

describe('Health Connect manifest', () => {
  it.each(HEALTH_CONNECT_RECORD_TYPES.map((t) => [t]))(
    'declares the read permission for %s',
    (recordType) => {
      expect(appJson.expo.android.permissions).toContain(
        `android.permission.health.${RECORD_TYPE_PERMISSION[recordType]}`,
      );
    },
  );

  // S14 round 4b (least privilege, Play health review): the manifest declares
  // EXACTLY the Health Connect read permissions the sync reads. Unused ones
  // (total calories, basal body temperature, background reads) are rejected.
  it('declares exactly the Health Connect read permissions the sync reads', () => {
    const declared = appJson.expo.android.permissions
      .filter((p) => p.startsWith('android.permission.health.'))
      .sort();
    const read = HEALTH_CONNECT_RECORD_TYPES.map(
      (rt) => `android.permission.health.${RECORD_TYPE_PERMISSION[rt]}`,
    ).sort();
    expect(declared).toEqual(read);
    for (const unused of [
      'READ_TOTAL_CALORIES_BURNED',
      'READ_BASAL_BODY_TEMPERATURE',
      'READ_HEALTH_DATA_IN_BACKGROUND',
    ]) {
      expect(declared).not.toContain(`android.permission.health.${unused}`);
    }
  });

  it('registers the library plugin and the S14 delegate plugin after it', () => {
    const lib = pluginNames.indexOf('react-native-health-connect');
    const local = pluginNames.indexOf('./plugins/withHealthConnectPermissionDelegate');
    expect(lib).toBeGreaterThanOrEqual(0);
    expect(local).toBeGreaterThan(lib);
  });
});

describe('withHealthConnectPermissionDelegate', () => {
  it('prebuild mod adds the delegate to the APK MainActivity, after super.onCreate', async () => {
    const out = await runMod('mainActivity', {
      contents: APK_MAIN_ACTIVITY,
      language: 'kt',
      path: 'MainActivity.kt',
    });
    const contents = String(out.contents);
    expect(contents).toContain(
      'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate',
    );
    const splash = contents.indexOf('SplashScreenManager.registerOnActivity(this)');
    const superCall = contents.indexOf('super.onCreate(null)');
    const delegate = contents.indexOf(
      'HealthConnectPermissionDelegate.setPermissionDelegate(this)',
    );
    expect(splash).toBeGreaterThan(-1);
    expect(superCall).toBeGreaterThan(splash);
    expect(delegate).toBeGreaterThan(superCall);
    // Exactly one call, still inside onCreate (before its closing brace).
    expect(contents.split('setPermissionDelegate(this)')).toHaveLength(2);
    expect(delegate).toBeLessThan(contents.indexOf('  }\n}'));
  });

  it('prebuild mod adds the Android 14 permission usage alias', async () => {
    const out = await runMod('manifest', {
      manifest: {
        application: [{ activity: [{ $: { 'android:name': '.MainActivity' } }] }],
      },
    });
    const manifest = out.manifest as {
      application: { 'activity-alias': { $: Record<string, string> }[] }[];
    };
    expect(manifest.application[0]['activity-alias'][0].$['android:name']).toBe(
      'ViewPermissionUsageActivity',
    );
  });

  it('registers the delegate right after super.onCreate (Kotlin)', () => {
    const out = plugin.addDelegateToMainActivity(EXPO_MAIN_ACTIVITY, 'kt');
    expect(out).toContain(
      'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate',
    );
    expect(out).toMatch(
      /super\.onCreate\(null\)\n\s+HealthConnectPermissionDelegate\.setPermissionDelegate\(this\)/,
    );
  });

  // B-364-2 (Opus H6 probe, run 37220808402): Health Connect's privacy policy link (the
  // rationale filter and the Android 14 alias both target MainActivity) opens the policy.
  it('MainActivity opens the privacy policy for both Health Connect privacy intents', () => {
    const out = plugin.addDelegateToMainActivity(APK_MAIN_ACTIVITY, 'kt');
    expect(out).toMatch(
      /setPermissionDelegate\(this\)\n\s+if \(showHealthConnectPrivacyPolicy\(intent\)\) finish\(\)\n\s+\}/,
    );
    expect(out).toMatch(
      /override fun onNewIntent\(intent: android\.content\.Intent\) \{\n\s+super\.onNewIntent\(intent\)\n\s+showHealthConnectPrivacyPolicy\(intent\)/,
    );
    expect(out).toContain('"androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE"');
    expect(out).toContain('"android.intent.action.VIEW_PERMISSION_USAGE"');
    expect(out).toContain(`android.net.Uri.parse("${PRIVACY_POLICY_URL}")`);
    expect(out).toMatch(/\n {2}\}\n\}\n$/);
  });

  it('fails loudly where the privacy policy handler cannot be added', () => {
    const withIntent = APK_MAIN_ACTIVITY.replace(/\}\n$/, '  override fun onNewIntent(i: Intent) {}\n}\n');
    expect(() => plugin.addDelegateToMainActivity(withIntent, 'kt')).toThrow(/onNewIntent/);
    expect(() => plugin.addDelegateToMainActivity(APK_MAIN_ACTIVITY, 'java')).toThrow(/Kotlin/);
  });

  it('is idempotent across repeated prebuilds', () => {
    const once = plugin.addDelegateToMainActivity(EXPO_MAIN_ACTIVITY, 'kt');
    expect(plugin.addDelegateToMainActivity(once, 'kt')).toBe(once);
  });

  it('fails loudly when MainActivity has no onCreate anchor', () => {
    expect(() =>
      plugin.addDelegateToMainActivity('package x\n\nclass MainActivity : ReactActivity()\n', 'kt'),
    ).toThrow(/super\.onCreate/);
  });

  it('adds the Android 14 permission usage alias once', () => {
    const manifest = {
      application: [{ activity: [{ $: { 'android:name': '.MainActivity' } }] }],
    };
    const out = plugin.addPermissionUsageAlias(plugin.addPermissionUsageAlias(manifest));
    const aliases = out.application[0]['activity-alias'];
    expect(aliases).toHaveLength(1);
    expect(aliases[0].$).toMatchObject({
      'android:name': 'ViewPermissionUsageActivity',
      'android:exported': 'true',
      'android:targetActivity': '.MainActivity',
      'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
    });
  });
});

describe('Apple Health config', () => {
  it('registers react-native-health with read and write usage strings', () => {
    const entry = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === 'react-native-health',
    ) as [string, Record<string, string>] | undefined;
    expect(entry).toBeDefined();
    expect(entry?.[1].healthSharePermission?.length ?? 0).toBeGreaterThan(20);
    expect(entry?.[1].healthUpdatePermission?.length ?? 0).toBeGreaterThan(20);
  });
});
