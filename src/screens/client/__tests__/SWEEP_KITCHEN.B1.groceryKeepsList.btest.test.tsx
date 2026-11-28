/**
 * SWEEP-KITCHEN B1 (pre-launch flow sweep, agent alm): the Grocery list keeps the list it has when a re-read fails.
 * She opens the Grocery list in a shop with no signal. The phone holds her list (the persisted query cache), but it is
 * older than the page's 60 s staleTime, so the page reads it again on open; the read fails (no connection) and the
 * page swaps every row for "Couldn't load grocery list." with Try again, which cannot work offline. The same happens
 * on a pull to refresh with a weak connection. The list she came to read is gone until the signal comes back.
 * Expected: a failed re-read keeps the last good list on screen (the class of m#1008 LS-KWM-2 C1, 7229714411:
 * "a re-read that fails keeps the last good answer"); the failed state only for a list with no answer yet.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { listsApi } from '../../../services/api';
import GroceryListScreen from '../GroceryListScreen';

const mockNavigation = { goBack: jest.fn(), navigate: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNavigation }));
jest.mock('../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../../../constants/colors').default, semanticColors: jest.requireActual('../../../theme/tokens').lightTokens }),
}));
jest.mock('../../../components/FadeInView', () => ({
  __esModule: true, default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(), notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('../../../services/api', () => ({
  listsApi: { getList: jest.fn(), addItem: jest.fn(), updateItem: jest.fn(), deleteItem: jest.fn(), clearChecked: jest.fn() },
}));

type ListResponse = Awaited<ReturnType<typeof listsApi.getList>>;
const KEY = ['lists', 'grocery'];
const rows = [
  { id: 'milk', name: 'Milk', quantity: 2, unit: 'litres', is_checked: false, added_at: '2026-11-27T10:00:00Z' },
  { id: 'eggs', name: 'Eggs', quantity: 12, is_checked: false, added_at: '2026-11-27T10:01:00Z' },
];
// What axios throws with no connection: no response, code ERR_NETWORK.
const offline = () => Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' });

// The app's retry count is cut to none here; with the app's two retries the list goes a few seconds later, the same way.
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

beforeEach(() => jest.clearAllMocks());

describe('SWEEP-KITCHEN B1: a failed re-read keeps her grocery list on screen', () => {
  it('opened offline with a list on the phone older than 60 s: the rows stay after the re-read fails', async () => {
    const qc = client();
    // The persisted cache gives the list back, last read five minutes ago.
    qc.setQueryData(KEY, rows, { updatedAt: Date.now() - 5 * 60 * 1000 });
    // The re-read hangs until the phone gives up on it (no connection), then fails.
    let giveUp: () => void = () => undefined;
    jest.mocked(listsApi.getList).mockImplementation(() => new Promise((_ok, fail) => { giveUp = () => fail(offline()); }));
    const view = await render(<QueryClientProvider client={qc}><GroceryListScreen /></QueryClientProvider>);
    expect(view.getByText('Milk')).toBeTruthy(); // the phone's copy shows while the re-read runs
    expect(listsApi.getList).toHaveBeenCalledWith('grocery'); // the page reads again on open (staleTime 60 s)
    await act(async () => { giveUp(); });
    await waitFor(() => expect(qc.getQueryState(KEY)?.status).toBe('error'));
    // GROCERY-OFFLINE-KEEP-M: react-query tells the page on a setTimeout(0); let it draw before the checks.
    await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
    expect(view.queryByText("Couldn't load grocery list.")).toBeNull();
    expect(view.getByText('Milk')).toBeTruthy();
    expect(view.getByText('Eggs')).toBeTruthy();
  });

  it('a pull to refresh that fails keeps the rows', async () => {
    const qc = client();
    jest.mocked(listsApi.getList).mockImplementation((type) =>
      Promise.resolve({ data: type === 'grocery' ? rows : [] } as unknown as ListResponse));
    const view = await render(<QueryClientProvider client={qc}><GroceryListScreen /></QueryClientProvider>);
    await view.findByText('Milk');
    jest.mocked(listsApi.getList).mockImplementation(() => Promise.reject(offline()));
    await act(async () => { await view.getByTestId('list-scroll').props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(qc.getQueryState(KEY)?.status).toBe('error'));
    // GROCERY-OFFLINE-KEEP-M: react-query tells the page on a setTimeout(0); let it draw before the checks.
    await act(async () => { await new Promise((done) => setTimeout(done, 20)); });
    expect(view.queryByText("Couldn't load grocery list.")).toBeNull();
    expect(view.getByText('Milk')).toBeTruthy();
  });
});
