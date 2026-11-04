/**
 * ALL-ON-CI-M: test-only setup, loaded only by the "All switches on (not
 * required)" job (its proof and test steps pass it with --setupFilesAfterEnv
 * after jest.setup.js). The normal suite and the app never load it.
 *
 * Two switch layers do not reach jest through process.env, so the job turns
 * them on here:
 *   1. Build metadata. src/config/healthConnect.ts reads
 *      Constants.expoConfig.extra.healthConnectEnabled, which app.config.js
 *      builds from TGP_ANDROID_HEALTH_CONNECT. jest-expo never runs
 *      app.config.js, so this rebuilds extra from it with the job's env, on
 *      every read.
 *   2. Server switches. useFeatureFlags reads GET /me/feature-flags; the jest
 *      run has no backend, so getFeatureFlags resolves every key in
 *      SERVER_FEATURE_FLAG_KEYS on, in the shape the strict schema accepts.
 * A test file that mocks expo-constants or featureFlagsApi itself keeps its own
 * mock: its jest.mock runs after this file and replaces this one.
 */
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  const base = actual.default ?? actual;
  const built = () => {
    const { expoConfig } = base;
    const config = jest.requireActual('../../app.config.js')();
    return { ...expoConfig, extra: { ...expoConfig?.extra, ...config.extra } };
  };
  const constants = Object.create(base);
  Object.defineProperty(constants, 'expoConfig', { configurable: true, enumerable: true, get: built });
  return { ...actual, __esModule: true, default: constants };
});

jest.mock('../../src/api/featureFlagsApi', () => {
  const actual = jest.requireActual('../../src/api/featureFlagsApi');
  const getFeatureFlags = async () =>
    actual.FeatureFlagsResponseSchema.parse({
      flags: Object.fromEntries(actual.SERVER_FEATURE_FLAG_KEYS.map((key) => [key, true])),
      evaluated_at: new Date().toISOString(),
    });
  return { ...actual, featureFlagsApi: { ...actual.featureFlagsApi, getFeatureFlags } };
});
