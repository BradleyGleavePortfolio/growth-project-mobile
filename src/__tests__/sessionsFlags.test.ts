// Verifies feature flags default OFF and that the master switch gates
// every sub-flag (so a half-configured build can't enable a sub-feature).

describe('sessionsFlags', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_SESSIONS_ENABLED;
    delete process.env.EXPO_PUBLIC_SESSIONS_CLIENT_REQUESTS_ENABLED;
    delete process.env.EXPO_PUBLIC_SESSIONS_COACH_AVAILABILITY_ENABLED;
    delete process.env.EXPO_PUBLIC_SESSIONS_VIDEO_PROVIDER_ENABLED;
    delete process.env.EXPO_PUBLIC_SESSIONS_PREP_ENABLED;
    delete process.env.EXPO_PUBLIC_SESSIONS_BRIEF_ENABLED;
  });

  it('defaults every flag to OFF', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sessionsFlags } = require('../config/sessionsFlags');
    expect(sessionsFlags.SESSIONS_ENABLED).toBe(false);
    expect(sessionsFlags.SESSIONS_CLIENT_REQUESTS_ENABLED).toBe(false);
    expect(sessionsFlags.SESSIONS_COACH_AVAILABILITY_ENABLED).toBe(false);
    expect(sessionsFlags.SESSIONS_VIDEO_PROVIDER_ENABLED).toBe(false);
    expect(sessionsFlags.SESSIONS_PREP_ENABLED).toBe(false);
    expect(sessionsFlags.SESSIONS_BRIEF_ENABLED).toBe(false);
  });

  it('the master switch gates sub-flags via isSessionsFeatureEnabled', () => {
    process.env.EXPO_PUBLIC_SESSIONS_CLIENT_REQUESTS_ENABLED = 'true';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isSessionsFeatureEnabled } = require('../config/sessionsFlags');
    // Master switch off — sub-flag must NOT be enabled.
    expect(isSessionsFeatureEnabled('SESSIONS_CLIENT_REQUESTS_ENABLED')).toBe(
      false,
    );
  });

  it('returns true only when both master and sub-flag are on', () => {
    process.env.EXPO_PUBLIC_SESSIONS_ENABLED = 'true';
    process.env.EXPO_PUBLIC_SESSIONS_CLIENT_REQUESTS_ENABLED = 'true';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { isSessionsFeatureEnabled } = require('../config/sessionsFlags');
    expect(isSessionsFeatureEnabled('SESSIONS_CLIENT_REQUESTS_ENABLED')).toBe(
      true,
    );
    expect(isSessionsFeatureEnabled('SESSIONS_BRIEF_ENABLED')).toBe(false);
  });

  it('accepts both "1" and "true" as truthy', () => {
    process.env.EXPO_PUBLIC_SESSIONS_ENABLED = '1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sessionsFlags } = require('../config/sessionsFlags');
    expect(sessionsFlags.SESSIONS_ENABLED).toBe(true);
  });
});
