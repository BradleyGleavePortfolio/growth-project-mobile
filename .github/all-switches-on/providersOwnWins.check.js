/**
 * ALL-ON-TRIAGE-M: switchesOn.setup.js gives render and renderHook the two
 * root providers the app always mounts (a QueryClient and a navigation
 * object) only as an outer default. Whatever a test supplies itself sits
 * inside and wins. Run by the proof step only.
 */
const React = require('react');
const { Text } = require('react-native');
const rtl = require('@testing-library/react-native');
const { render, renderHook } = rtl;
const { QueryClient, QueryClientProvider, useQueryClient } = require('@tanstack/react-query');
const { NavigationContainer, useNavigation, useRoute } = require('@react-navigation/native');
const { createNativeStackNavigator } = require('@react-navigation/native-stack');

test('a bare hook gets a QueryClient and a navigation object', async () => {
  const { result } = await renderHook(() => ({ qc: useQueryClient(), nav: useNavigation(), route: useRoute() }));
  expect(result.current.qc).toBeInstanceOf(QueryClient);
  expect(typeof result.current.nav.navigate).toBe('function');
  expect(result.current.nav.canGoBack()).toBe(false);
  expect(result.current.route.name).toBe('AllOnTest');
});

test("a test's own QueryClientProvider wins", async () => {
  const own = new QueryClient();
  const wrapper = ({ children }) => React.createElement(QueryClientProvider, { client: own }, children);
  const { result } = await renderHook(() => useQueryClient(), { wrapper });
  expect(result.current).toBe(own);
});

test("a test's own NavigationContainer and navigator win", async () => {
  const Stack = createNativeStackNavigator();
  function Probe() {
    const route = useRoute();
    const nav = useNavigation();
    return React.createElement(Text, null, `${route.name}:${nav.getState().routeNames.join(',')}`);
  }
  await render(
    React.createElement(
      NavigationContainer,
      null,
      React.createElement(Stack.Navigator, null, React.createElement(Stack.Screen, { name: 'Own', component: Probe })),
    ),
  );
  expect(await rtl.screen.findByText('Own:Own')).toBeTruthy();
});
