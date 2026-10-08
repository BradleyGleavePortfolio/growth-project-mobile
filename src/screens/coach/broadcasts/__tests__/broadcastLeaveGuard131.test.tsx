import React from 'react';
import { Alert, Text } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer, type ParamListBase } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) },
}));

import BroadcastComposerScreen from '../BroadcastComposerScreen';

const Stack = createNativeStackNavigator();
let queryClient: QueryClient;

async function openComposer() {
  const navigation = createNavigationContainerRef<ParamListBase>();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer
        ref={navigation}
        initialState={{ index: 1, routes: [{ name: 'CoachBroadcasts' }, { name: 'CoachBroadcastComposer' }] }}
      >
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="CoachBroadcasts">{() => <Text>Broadcast list</Text>}</Stack.Screen>
          <Stack.Screen name="CoachBroadcastComposer" component={BroadcastComposerScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('composer-count').props.children).toBe('Goes to 3 of 3 clients.'));
  return { screen, navigation };
}

async function chooseAlert(label: string) {
  const calls = jest.mocked(Alert.alert).mock.calls;
  const buttons = calls[calls.length - 1]?.[2];
  const button = buttons?.find((item) => item.text === label);
  expect(button).toBeDefined();
  await act(async () => { button?.onPress?.(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockGet.mockResolvedValue({ data: { roster_size: 3, tags: [], packages: [], programs: [], risk_buckets: [] } });
  mockPost.mockImplementation(async (url: string, payload: Record<string, unknown>) => ({
    data: url.endsWith('/preview')
      ? { recipient_count: 3, excluded_blocked_count: 0, roster_size: 3, sample: [] }
      : {
          ...payload, id: 'broadcast-1', next_run_at: null, occurrences_sent: 0,
          last_run_at: null, failure_code: null, created_at: '2026-10-07T12:00:00.000Z',
        },
  }));
});
afterEach(async () => {
  await cleanup();
  queryClient?.clear();
});

describe('broadcast leave guard', () => {
  it.each(['Back', 'Close'])('keeps the message on %s until discard is confirmed', async (action) => {
    const { screen, navigation } = await openComposer();
    await fireEvent.changeText(screen.getByTestId('composer-body'), 'Gym closed Monday');
    await act(async () => {
      if (action === 'Back') navigation.goBack();
      else navigation.reset({ index: 0, routes: [{ name: 'CoachBroadcasts' }] });
    });
    expect(Alert.alert).toHaveBeenLastCalledWith('Discard this message?', expect.any(String), expect.any(Array));
    expect(navigation.getCurrentRoute()?.name).toBe('CoachBroadcastComposer');
    await chooseAlert('Keep editing');
    expect(screen.getByTestId('composer-body').props.value).toBe('Gym closed Monday');
    await act(async () => { navigation.goBack(); });
    await chooseAlert('Discard');
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('CoachBroadcasts'));
    expect(mockPost.mock.calls.some(([url]) => url === '/coach/broadcasts')).toBe(false);
  });

  it('leaves without a prompt when the message is empty or cleared', async () => {
    const { screen, navigation } = await openComposer();
    await fireEvent.changeText(screen.getByTestId('composer-body'), 'Gym closed Monday');
    await fireEvent.changeText(screen.getByTestId('composer-body'), '');
    await act(async () => { navigation.goBack(); });
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('CoachBroadcasts'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('returns after sending without asking to discard the sent message', async () => {
    const { screen, navigation } = await openComposer();
    await fireEvent.changeText(screen.getByTestId('composer-body'), 'Gym closed Monday');
    await fireEvent.press(screen.getByTestId('composer-send'));
    await chooseAlert('Send');
    await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('CoachBroadcasts'));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/coach/broadcasts', expect.objectContaining({ body: 'Gym closed Monday' }), expect.any(Object));
  });

  it('still protects the message after sending fails', async () => {
    mockPost.mockImplementation(async (url: string) => {
      if (url.endsWith('/preview')) return { data: { recipient_count: 3, excluded_blocked_count: 0, roster_size: 3 } };
      throw new Error('offline');
    });
    const { screen, navigation } = await openComposer();
    await fireEvent.changeText(screen.getByTestId('composer-body'), 'Gym closed Monday');
    await fireEvent.press(screen.getByTestId('composer-send'));
    await chooseAlert('Send');
    await waitFor(() => expect(screen.getByTestId('composer-error')).toBeTruthy());
    await act(async () => { navigation.goBack(); });
    expect(Alert.alert).toHaveBeenLastCalledWith('Discard this message?', expect.any(String), expect.any(Array));
    expect(screen.getByTestId('composer-body').props.value).toBe('Gym closed Monday');
  });
});
