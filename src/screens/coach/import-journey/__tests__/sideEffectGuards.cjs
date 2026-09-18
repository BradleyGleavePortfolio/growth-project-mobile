// Imported before the views. The real app ThemeProvider reads preferences and
// identity; these leaf tests inject only its semantic-token result, never mount it.
const mockForbidden = jest.fn(() => { throw new Error('P1 attempted a forbidden side effect'); });
const forbiddenModule = new Proxy(mockForbidden, {
  get: (_target, key) => key === '__esModule' ? true : key === 'then' ? undefined : forbiddenModule,
});
const mockTheme = { mode: 'light' };
jest.mock('../../../../theme/useTheme', () => ({
  useTheme: () => {
    const tokens = require('../../../../theme/tokens');
    return { semanticColors: mockTheme.mode === 'dark' ? tokens.darkTokens : tokens.lightTokens };
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../../services/api', () => forbiddenModule);
jest.mock('../../../../api/extensionPairApi', () => forbiddenModule);
jest.mock('../../../../hooks/useExtensionPairing', () => forbiddenModule);
jest.mock('../../../../services/authActions', () => forbiddenModule);
jest.mock('../../../../utils/supabaseAuth', () => forbiddenModule);
jest.mock('../../../../lib/analytics', () => forbiddenModule);
jest.mock('../../../../analytics/posthog.service', () => forbiddenModule);
jest.mock('@react-native-async-storage/async-storage', () => forbiddenModule);
jest.mock('expo-secure-store', () => forbiddenModule);
jest.mock('expo-clipboard', () => forbiddenModule);
jest.mock('expo-sharing', () => forbiddenModule);

exports.theme = mockTheme;
exports.installGuards = () => {
  mockTheme.mode = 'light';
  mockForbidden.mockClear();
  const { Linking, Share } = require('react-native');
  jest.spyOn(Linking, 'openURL').mockImplementation(mockForbidden);
  jest.spyOn(Linking, 'canOpenURL').mockImplementation(mockForbidden);
  jest.spyOn(Share, 'share').mockImplementation(mockForbidden);
  jest.spyOn(global, 'fetch').mockImplementation(mockForbidden);
};
exports.assertNoSideEffects = () => expect(mockForbidden).not.toHaveBeenCalled();
exports.exerciseGuards = () => {
  const { Linking, Share } = require('react-native');
  const calls = [
    () => require('../../../../services/api').default.post('/forbidden'),
    () => require('../../../../api/extensionPairApi').init(),
    () => require('../../../../hooks/useExtensionPairing').useExtensionPairing(),
    () => require('../../../../services/authActions').signOut(),
    () => require('../../../../utils/supabaseAuth').signIn(),
    () => require('../../../../lib/analytics').track('forbidden'),
    () => require('../../../../analytics/posthog.service').track('forbidden'),
    () => require('@react-native-async-storage/async-storage').setItem('forbidden', 'value'),
    () => require('expo-secure-store').setItemAsync('forbidden', 'value'),
    () => require('expo-clipboard').setStringAsync('forbidden'),
    () => require('expo-sharing').shareAsync('forbidden'),
    () => Linking.openURL('https://example.com'),
    () => Linking.canOpenURL('https://example.com'),
    () => Share.share({ message: 'forbidden' }),
    () => global.fetch('https://example.com'),
  ];
  calls.forEach(call => expect(call).toThrow('P1 attempted a forbidden side effect'));
  expect(mockForbidden).toHaveBeenCalledTimes(calls.length);
  mockForbidden.mockClear();
};
