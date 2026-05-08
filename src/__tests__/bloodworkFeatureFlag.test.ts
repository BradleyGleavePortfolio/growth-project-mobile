/**
 * Verifies the bloodwork feature flag is OFF by default.
 *
 * The first version of this feature must ship with EXPO_PUBLIC_FEATURE_BLOODWORK
 * unset (or explicitly false). A future build can flip it on per environment,
 * but the *default* posture is OFF — this test pins that contract.
 */

describe('feature flags', () => {
  const ORIGINAL = process.env.EXPO_PUBLIC_FEATURE_BLOODWORK;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.EXPO_PUBLIC_FEATURE_BLOODWORK;
    } else {
      process.env.EXPO_PUBLIC_FEATURE_BLOODWORK = ORIGINAL;
    }
    jest.resetModules();
  });

  it('bloodwork is OFF when env var is unset', () => {
    delete process.env.EXPO_PUBLIC_FEATURE_BLOODWORK;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../config/featureFlags');
    expect(mod.isFeatureEnabled('bloodwork')).toBe(false);
    expect(mod.featureFlags.bloodwork).toBe(false);
  });

  it('bloodwork is OFF when env var is "false"', () => {
    process.env.EXPO_PUBLIC_FEATURE_BLOODWORK = 'false';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../config/featureFlags');
    expect(mod.isFeatureEnabled('bloodwork')).toBe(false);
  });

  it('bloodwork can be turned on with "true"', () => {
    process.env.EXPO_PUBLIC_FEATURE_BLOODWORK = 'true';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../config/featureFlags');
    expect(mod.isFeatureEnabled('bloodwork')).toBe(true);
  });
});
