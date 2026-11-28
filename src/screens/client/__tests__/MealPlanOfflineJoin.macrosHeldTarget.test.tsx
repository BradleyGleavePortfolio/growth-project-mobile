/**
 * MEALPLAN-OFFLINE-JOIN-M (SWEEP-FINAL-OFFLINE C1 = SWEEP-FINAL-COACH C3, raised in OPERATOR TRIAGE 7237179575; the ruled
 * class "a re-read that fails keeps the last good answer"): Macro targets keeps the target it holds when a re-read of
 * ['macros','me','current'] fails (offline after its five minutes, a cold start offline, a weak signal). At main 89a4e7f9
 * `isError` puts "Could not load your targets right now. Pull to retry." over the held target and empties the masthead
 * (ClientMacrosScreen.tsx:93-94, :125-128). A read that failed with no target held keeps main's error words. The day's
 * food totals line is m#1043's and unchanged.
 *
 * The target read is the real hook (useCurrentMacrosForSelf) on a react-query client; the server answers once, then
 * every read fails as a lost connection does. Names are fictional.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientMacrosScreen from '../ClientMacrosScreen';

const TARGET = {
  id: 't1', client_id: 'u1', coach_id: 'c1', calories_kcal: 1789, protein_g: 150, carbs_g: 185, fats_g: 50, fiber_g: 25,
  notes: null, effective_from: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', archived_at: null,
};
const KEY = ['macros', 'me', 'current'];
const ERROR_WORDS = 'Could not load your targets right now. Pull to retry.';
const lost = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true });

const mockServer = { up: true, target: TARGET as typeof TARGET | null };
const mockCurrent = jest.fn(async () => {
  if (!mockServer.up) throw lost();
  return { data: mockServer.target };
});
jest.mock('../../../api/macrosApi', () => {
  const actual = jest.requireActual('../../../api/macrosApi');
  return { ...actual, macrosApi: { ...actual.macrosApi, currentForSelf: () => mockCurrent() } };
});
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(async () => ({ data: { id: 'c1', name: 'Sam Lee' } })) },
}));
let mockLog: { data: Record<string, number> | undefined; isError: boolean; isLoading: boolean } = {
  data: undefined, isError: false, isLoading: false,
};
jest.mock('../../../hooks/useApi', () => ({
  useTodayLog: () => ({ ...mockLog, refetch: jest.fn(), isRefetching: false }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'u1' }) }));
jest.mock('../../../macros/macroDisplayStore', () => ({ useMacroDisplayMode: () => 'full', reportMacroDisplay: jest.fn() }));

let client: QueryClient;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const show = async () => {
  await render(<QueryClientProvider client={client}><ClientMacrosScreen /></QueryClientProvider>);
  await settle();
};
/** A re-read of the target that fails (her pull, a return after five minutes): react-query keeps the data, sets the error. */
const reReadFails = async () => {
  mockServer.up = false;
  await act(async () => { await client.refetchQueries({ queryKey: KEY }); });
  await settle();
  expect(client.getQueryState(KEY)?.status).toBe('error');
};
const showsHeldTarget = () => {
  expect(screen.getByTestId('macros-day-target')).toBeTruthy();
  expect(screen.getByText('1,789')).toBeTruthy();
  expect(screen.getByText('Set by Sam')).toBeTruthy();
  expect(screen.getByTestId('macros-tile-protein')).toBeTruthy();
  expect(screen.getByTestId('macros-cells')).toBeTruthy();
  expect(screen.queryByText(ERROR_WORDS)).toBeNull();
};

beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  Object.assign(mockServer, { up: true, target: TARGET });
  mockLog = { data: { total_calories: 600, total_protein_g: 50, total_carbs_g: 60, total_fat_g: 20 }, isError: false, isLoading: false };
});
afterEach(() => { client.clear(); });

describe('MEALPLAN-OFFLINE-JOIN-M: Macro targets keeps the target it holds when a re-read fails', () => {
  it.each([
    ['a re-read on the open page fails (her pull with no signal)', async () => {
      await show();
      expect(screen.getByText('1,789')).toBeTruthy();
      await reReadFails();
    }],
    ['opened offline after five minutes (the held target is stale, its read fails)', async () => {
      client.setQueryData(KEY, TARGET, { updatedAt: Date.now() - 6 * 60 * 1000 });
      mockServer.up = false;
      await show();
      expect(client.getQueryState(KEY)?.status).toBe('error');
    }],
  ])('%s: the target, the masthead and the card stay, with no error card', async (_path, steps) => {
    await steps();
    expect(mockCurrent).toHaveBeenCalled();
    showsHeldTarget();
    // The day's food totals line is unchanged (m#1043): today's totals still show.
    expect(screen.getByText('600 kcal eaten today')).toBeTruthy();
  });

  it('a held target with no food totals yet keeps main\'s totals line under it', async () => {
    mockLog = { data: undefined, isError: true, isLoading: false };
    await show();
    await reReadFails();
    showsHeldTarget();
    expect(screen.getByText("Today's food totals did not load. Pull to retry.")).toBeTruthy();
    expect(screen.queryByText(/kcal eaten today/)).toBeNull();
  });

  it('no target held and the read fails: main\'s error words, no number and no masthead', async () => {
    mockServer.up = false;
    await show();
    expect(client.getQueryState(KEY)?.status).toBe('error');
    expect(screen.getByText(ERROR_WORDS)).toBeTruthy();
    expect(screen.queryByTestId('macros-day-target')).toBeNull();
    expect(screen.queryByText('1,789')).toBeNull();
    expect(screen.queryByText('Your target')).toBeNull();
    expect(screen.queryByText('Set by Sam')).toBeNull();
  });

  it('online, a re-read that answers shows the new target (nothing held over an answer)', async () => {
    await show();
    mockServer.target = { ...TARGET, calories_kcal: 1900 };
    await act(async () => { await client.refetchQueries({ queryKey: KEY }); });
    await settle();
    expect(screen.getByText('1,900')).toBeTruthy();
    expect(screen.queryByText('1,789')).toBeNull();
    expect(screen.queryByText(ERROR_WORDS)).toBeNull();
  });
});
