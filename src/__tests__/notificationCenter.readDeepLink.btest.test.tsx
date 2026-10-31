import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../theme/ThemeProvider';

const LINK = 'tgp://coach/clients/137c1340-c8a2-45d6-a006-7a6e695ed845';
const mockGet = jest.fn();
const mockPost = jest.fn().mockResolvedValue({ data: {} });
const mockRoutePushTap = jest.fn().mockReturnValue(true);

jest.mock('../services/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));
jest.mock('../config/featureFlags', () => ({ NOTIFICATIONS_MOCK_ENABLED: false }));
jest.mock('../services/pushTapRouter', () => ({
  routePushTap: (...args: unknown[]) => mockRoutePushTap(...args),
}));

import NotificationCenterScreen from '../screens/notifications/NotificationCenterScreen';

it('OWN-PR B: read deep-link rows still open their real destination, just like the unread control', async () => {
  const row = (id: string, body: string, read_at: string | null) => ({
    id,
    kind: 'first_payment',
    body,
    read_at,
    created_at: '2026-10-28T18:00:00.000Z',
    deep_link: LINK,
    payload: { amount: 4900, currency: 'usd', clientId: '137c1340-c8a2-45d6-a006-7a6e695ed845' },
  });
  mockGet.mockImplementation(async (url: string) => ({
    data: url === '/notifications/unread-count'
      ? { count: 1 }
      : {
        items: [
          row('unread-control', 'Unread payment control.', null),
          row('read-destination', 'Previously read payment.', '2026-10-28T18:01:00.000Z'),
        ],
        nextCursor: null,
      },
  }));

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <NavigationContainer><ThemeProvider><NotificationCenterScreen /></ThemeProvider></NavigationContainer>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Previously read payment.')).not.toBeNull());
  await act(async () => { fireEvent.press(screen.getByText('Unread payment control.')); });
  await waitFor(() => expect(mockRoutePushTap).toHaveBeenCalledWith(undefined, undefined, undefined, LINK));
  mockRoutePushTap.mockClear();

  await act(async () => { fireEvent.press(screen.getByText('Previously read payment.')); });
  expect(mockRoutePushTap).toHaveBeenCalledWith(undefined, undefined, undefined, LINK);
  await screen.unmount();
  queryClient.clear();
});
