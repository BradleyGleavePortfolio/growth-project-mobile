/**
 * S-RELEASE-3 (B-305-6): every Sentry event names the running OTA update, so
 * an update can be watched by id and channel (it keeps the binary's release).
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  otaUpdateTags,
  readOtaUpdateState,
  reportOtaUpdateLaunch,
  resetOtaUpdateReportForTests,
  emergencyReasonCategory,
  otaUpdatesContext,
  EMERGENCY_REASON_CATEGORIES,
  OTA_UPDATES_CONTEXT,
} from '../otaUpdateTags';

const RUNTIME = '0123456789abcdef0123456789abcdef01234567';

function rootWith(mod: Record<string, unknown> | undefined): { expo: { modules: Record<string, unknown> } } {
  return { expo: { modules: mod ? { ExpoUpdates: mod } : {} } };
}

function fakeSentry() {
  return { setTags: jest.fn(), setContext: jest.fn(), captureMessage: jest.fn() };
}

const UPDATE = {
  isEnabled: true,
  updateId: 'ABCDEF00-1111-2222-3333-444455556666',
  channel: 'clinic',
  runtimeVersion: RUNTIME,
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
  emergencyLaunchReason: null,
};

describe('otaUpdateTags', () => {
  beforeEach(() => resetOtaUpdateReportForTests());

  it('is a no-op without expo-updates (dev, Expo Go, web, tests) or when it is disabled', () => {
    const sentry = fakeSentry();
    expect(reportOtaUpdateLaunch(sentry, {})).toBeNull();
    expect(reportOtaUpdateLaunch(sentry, rootWith(undefined))).toBeNull();
    expect(reportOtaUpdateLaunch(sentry, rootWith({ ...UPDATE, isEnabled: false }))).toBeNull();
    expect(reportOtaUpdateLaunch(sentry)).toBeNull();
    expect(sentry.setTags).not.toHaveBeenCalled();
    expect(sentry.setContext).not.toHaveBeenCalled();
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('tags the scope with the searchable update id (lowercase), channel and runtime', () => {
    const sentry = fakeSentry();
    reportOtaUpdateLaunch(sentry, rootWith(UPDATE));
    expect(sentry.setTags).toHaveBeenCalledWith({
      'expo.updates.update_id': 'abcdef00-1111-2222-3333-444455556666',
      'expo.updates.channel': 'clinic',
      'expo.updates.runtime_version': RUNTIME,
      'expo.updates.embedded': 'false',
      'expo.updates.emergency': 'false',
    });
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('B-305-12: sets the bounded ota_updates context (SDK field names, no reason text) for every event and native crash', () => {
    const sentry = fakeSentry();
    reportOtaUpdateLaunch(
      sentry,
      rootWith({
        ...UPDATE,
        isEmbeddedLaunch: true,
        isEmergencyLaunch: true,
        isUsingEmbeddedAssets: true,
        checkAutomatically: 'ON_LOAD',
        launchDuration: 412,
        emergencyLaunchReason: 'Failed to launch the update for Jane Doe',
      }),
    );
    expect(OTA_UPDATES_CONTEXT).toBe('ota_updates');
    expect(sentry.setContext).toHaveBeenCalledTimes(1);
    expect(sentry.setContext).toHaveBeenCalledWith('ota_updates', {
      is_enabled: true,
      is_embedded_launch: true,
      is_emergency_launch: true,
      is_using_embedded_assets: true,
      update_id: 'abcdef00-1111-2222-3333-444455556666',
      channel: 'clinic',
      runtime_version: RUNTIME,
      check_automatically: 'on_load',
      launch_duration: 412,
      emergency_reason_category: 'launch_failed',
    });
    expect(JSON.stringify(sentry.setContext.mock.calls)).not.toContain('Jane');
  });

  it('B-305-12: unexpected check modes and launch durations are dropped from the context', () => {
    for (const [checkAutomatically, launchDuration] of [
      ['ON_LOAD Jane Doe', -1],
      ['sometimes', Number.NaN],
      [42, 86_400_001],
      [null, '412'],
    ] as const) {
      const state = readOtaUpdateState(rootWith({ ...UPDATE, checkAutomatically, launchDuration }));
      if (!state) throw new Error('expected an update state');
      const ctx = otaUpdatesContext(state);
      expect(ctx).not.toHaveProperty('check_automatically');
      expect(ctx).not.toHaveProperty('launch_duration');
    }
    const ok = readOtaUpdateState(rootWith({ ...UPDATE, checkAutomatically: 'WIFI_ONLY', launchDuration: 0 }));
    if (!ok) throw new Error('expected an update state');
    expect(otaUpdatesContext(ok)).toMatchObject({ check_automatically: 'wifi_only', launch_duration: 0 });
  });

  it('marks the embedded bundle', () => {
    const state = readOtaUpdateState(rootWith({ ...UPDATE, isEmbeddedLaunch: true }));
    expect(state && otaUpdateTags(state)['expo.updates.embedded']).toBe('true');
  });

  it('reports an emergency launch (update rolled back natively) once per process, with only a reason category', () => {
    const sentry = fakeSentry();
    const root = rootWith({
      ...UPDATE,
      isEmbeddedLaunch: true,
      isEmergencyLaunch: true,
      emergencyLaunchReason: 'Failed to launch /var/mobile/Containers/Data/Application/X/.expo-internal/a.hbc from https://u.expo.dev/abc?token=1',
    });
    reportOtaUpdateLaunch(sentry, root);
    reportOtaUpdateLaunch(sentry, root);
    expect(sentry.setTags).toHaveBeenCalledTimes(2);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, ctx] = sentry.captureMessage.mock.calls[0];
    expect(message).toMatch(/^OTA emergency launch/);
    expect(ctx.level).toBe('warning');
    expect(ctx.tags['expo.updates.emergency']).toBe('true');
    expect(ctx.fingerprint).toEqual(['ota-emergency-launch', RUNTIME]);
    expect(ctx.contexts).toEqual({ ota_emergency: { reason_category: 'asset_or_bundle' } });
  });

  it('Sol B-305-10: the reason is a closed category with an unknown fallback, never text', () => {
    expect(emergencyReasonCategory(null)).toBe('not_reported');
    expect(emergencyReasonCategory('Failed to launch embedded or launchable update')).toBe('launch_failed');
    expect(emergencyReasonCategory('Asset download failed for bundle')).toBe('asset_or_bundle');
    expect(emergencyReasonCategory('SQLite database is locked')).toBe('database');
    expect(emergencyReasonCategory('The request timed out')).toBe('timeout');
    expect(emergencyReasonCategory('Jane Doe +1 415 555 0142')).toBe('unknown');
    expect([...EMERGENCY_REASON_CATEGORIES]).toEqual(['not_reported', 'launch_failed', 'asset_or_bundle', 'database', 'timeout', 'unknown']);
    for (const r of ['x'.repeat(500), 'Failed to launch', 'nothing', 'database', 'timeout']) {
      expect(EMERGENCY_REASON_CATEGORIES).toContain(emergencyReasonCategory(r));
    }
  });

  it('Sol B-305-10 canary: personal data in any native field never reaches setTags or captureMessage', () => {
    const CANARY = ['Janet Canaryfield', 'janet.canaryfield@example.com', '+1 415 555 0142', 'patient-7731', 'HIV positive, insulin dependent'];
    const text = CANARY.join(' ');
    const sentry = fakeSentry();
    const state = reportOtaUpdateLaunch(
      sentry,
      rootWith({
        ...UPDATE,
        updateId: `${UPDATE.updateId} ${CANARY[0]}`,
        channel: `clinic ${CANARY[1]}`,
        runtimeVersion: `${RUNTIME} ${CANARY[2]}`,
        isEmbeddedLaunch: true,
        isEmergencyLaunch: true,
        emergencyLaunchReason: `Failed to launch update for ${text}`,
      }),
    );
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify([sentry.setTags.mock.calls, sentry.setContext.mock.calls, sentry.captureMessage.mock.calls, state]);
    for (const fragment of [...CANARY, 'Janet', 'Canaryfield', 'example.com', '415', 'insulin', 'HIV', '7731']) {
      expect(sent).not.toContain(fragment);
    }
    // Malformed identifiers are dropped or mapped, never echoed.
    expect(state).toMatchObject({ updateId: null, channel: 'other', runtimeVersion: null, emergencyReason: 'launch_failed' });
  });

  it('well-formed identifiers are kept; an unknown channel is reported as other', () => {
    expect(readOtaUpdateState(rootWith(UPDATE))).toMatchObject({ updateId: 'abcdef00-1111-2222-3333-444455556666', channel: 'clinic', runtimeVersion: RUNTIME });
    expect(readOtaUpdateState(rootWith({ ...UPDATE, channel: 'Staging' }))?.channel).toBe('other');
    expect(readOtaUpdateState(rootWith({ ...UPDATE, runtimeVersion: '1.0.0' }))?.runtimeVersion).toBe('1.0.0');
  });

  it('never throws (diagnostics must not break launch)', () => {
    const sentry = {
      setTags: jest.fn(() => {
        throw new Error('scope closed');
      }),
      setContext: jest.fn(),
      captureMessage: jest.fn(),
    };
    expect(reportOtaUpdateLaunch(sentry, rootWith(UPDATE))).toBeNull();
  });

  it('App.tsx tags the update right after initSentry()', () => {
    const app = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'App.tsx'), 'utf8');
    const init = app.indexOf('\ninitSentry();');
    const report = app.indexOf('\nreportOtaUpdateLaunch();');
    expect(init).toBeGreaterThan(-1);
    expect(report).toBeGreaterThan(init);
  });
});
