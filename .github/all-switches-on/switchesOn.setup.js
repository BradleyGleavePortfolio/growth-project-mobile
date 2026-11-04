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
 *      featureFlagsApi's own contract test is the one file that tests
 *      getFeatureFlags itself against its server double, so it keeps the real
 *      function (ALL-ON-TRIAGE-M, LS-923R2 C1).
 * The server switch state inside the community payloads (feature_flag_state,
 * the /community/me flags map) is the test's own fixture: the job no longer
 * rewrites it (ALL-ON-TRIAGE-M), so it never hides a disabled-state test or
 * reaches enabled screens with a disabled fixture (communityPayloadOwn.check.js).
 *
 * ALL-ON-TRIAGE-M: two providers the app always mounts at its root
 * (App.tsx: QueryClientProvider, NavigationContainer) are missing when a
 * screen test renders a component bare. With every switch on, more screens
 * read a query or the navigation object, so render and renderHook get a
 * default outer wrapper here: a fresh QueryClient (retry off) and a root
 * navigation stand-in that answers useNavigation/useRoute/useFocusEffect when
 * the test mounts no NavigationContainer. Anything the test supplies itself
 * (its own wrapper, QueryClientProvider, NavigationContainer, navigator or a
 * jest.mock of the module) sits inside, so it wins (providersOwnWins.check.js).
 *
 * A test file that mocks expo-constants or featureFlagsApi itself keeps its
 * own mock: its jest.mock runs after this file and replaces this one.
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

// featureFlagsApi's own contract test keeps the real getFeatureFlags (the path
// is read inline: babel-jest hoists jest.mock above any const).
if (!/[\\/]featureFlagsApi\.contract\.test\.[jt]sx?$/.test(String(expect.getState().testPath || ''))) {
  jest.mock('../../src/api/featureFlagsApi', () => {
    const actual = jest.requireActual('../../src/api/featureFlagsApi');
    const getFeatureFlags = async () =>
      actual.FeatureFlagsResponseSchema.parse({
        flags: Object.fromEntries(actual.SERVER_FEATURE_FLAG_KEYS.map((key) => [key, true])),
        evaluated_at: new Date().toISOString(),
      });
    return { ...actual, featureFlagsApi: { ...actual.featureFlagsApi, getFeatureFlags } };
  });
}

jest.mock('@testing-library/react-native', () => {
  const actual = jest.requireActual('@testing-library/react-native');
  const React = jest.requireActual('react');
  const { QueryClient, QueryClientProvider } = jest.requireActual('@tanstack/react-query');
  const { NavigationContainerRefContext, NavigationRouteContext } = jest.requireActual('@react-navigation/core');
  const noop = () => undefined;
  const rootNavigation = () => {
    const state = { key: 'all-on-root', index: 0, routeNames: ['AllOnTest'], routes: [{ key: 'all-on-test', name: 'AllOnTest' }], type: 'stack', stale: false };
    return {
      navigate: jest.fn(),
      dispatch: jest.fn(),
      reset: jest.fn(),
      goBack: jest.fn(),
      push: jest.fn(),
      replace: jest.fn(),
      pop: jest.fn(),
      popToTop: jest.fn(),
      setParams: jest.fn(),
      setOptions: jest.fn(),
      canGoBack: () => false,
      isFocused: () => true,
      isReady: () => true,
      getState: () => state,
      getRootState: () => state,
      getCurrentRoute: () => state.routes[0],
      getCurrentOptions: () => ({}),
      getParent: noop,
      getId: noop,
      addListener: () => noop,
      removeListener: noop,
    };
  };
  const route = { key: 'all-on-test', name: 'AllOnTest', params: undefined };
  const withDefaults = (options) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const navigation = rootNavigation();
    const Inner = options && options.wrapper;
    const wrapper = ({ children }) =>
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          NavigationContainerRefContext.Provider,
          { value: navigation },
          React.createElement(
            NavigationRouteContext.Provider,
            { value: route },
            Inner ? React.createElement(Inner, null, children) : children,
          ),
        ),
      );
    return { ...options, wrapper };
  };
  // Live getters, not a spread: RNTL rebinds `screen` on every render.
  const out = {
    render: (ui, options) => actual.render(ui, withDefaults(options)),
    renderHook: (hook, options) => actual.renderHook(hook, withDefaults(options)),
  };
  for (const key of Object.keys(actual)) {
    if (!(key in out)) Object.defineProperty(out, key, { enumerable: true, get: () => actual[key] });
  }
  return out;
});
