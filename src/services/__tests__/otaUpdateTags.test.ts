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
  EMERGENCY_REASON_CATEGORIES,
} from '../otaUpdateTags';

const RUNTIME = '0123456789abcdef0123456789abcdef01234567';

function rootWith(mod: Record<string, unknown> | undefined): { expo: { modules: Record<string, unknown> } } {
  return { expo: { modules: mod ? { ExpoUpdates: mod } : {} } };
}

function fakeSentry() {
  return { setTags: jest.fn(), captureMessage: jest.fn() };
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
    const sent = JSON.stringify([sentry.setTags.mock.calls, sentry.captureMessage.mock.calls, state]);
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
