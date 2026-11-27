/**
 * SAVED-MEAL-SAVE-M: rename and delete a saved meal from its sheet (Style 2 Menu, frame S2_use: "Rename" and "Delete"
 * under "Add to today"). The real Kitchen screen mounts with the API mocked at its edge. Rename changes the sheet's body
 * in place (SS10); Delete asks first with the system alert the Food log uses (SS12). Every write sends the id of the
 * meal the sheet was opened for. A lost answer is a rejection with no response. Fixtures fictional (client Jordan).
 */
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';

let mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDims }));
jest.mock('../../../../theme/ThemeProvider', () => {
  const sc = jest.requireActual('../../../../theme/tokens').lightTokens;
  return { useTheme: () => ({ semanticColors: sc, colors: { ...jest.requireActual('../../../../constants/colors').default } }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native/Libraries/Components/RefreshControl/RefreshControl', () => {
  const React = require('react');
  return { __esModule: true, default: (props: object) => React.createElement(require('react-native').View, { ...props }) };
});
jest.mock('../../../../components/StatusBarBand', () => ({ useStatusBarBand: () => undefined }));
jest.mock('../../../../components/FadeInView', () => ({ __esModule: true, default: ({ children }: { children: React.ReactNode }) => children }));
const mockListeners: Record<string, Array<() => void>> = {};
const mockParent = { navigate: jest.fn() };
const mockNav = {
  navigate: jest.fn(), goBack: jest.fn(), getParent: jest.fn(() => mockParent),
  addListener: jest.fn((event: string, cb: () => void) => { (mockListeners[event] ??= []).push(cb); return () => undefined; }),
};
jest.mock('@react-navigation/native', () => ({ useNavigation: () => mockNav }));
const mockFlags: Record<string, boolean> = {};
jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: new Proxy({}, { get: (_t, key: string) => mockFlags[key] ?? false }),
}));
let mockUser: { id: string; coach_id?: string | null } = { id: 'jordan', coach_id: 'sam' };
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../hooks/useNetworkStatus', () => ({
  ...jest.requireActual('../../../../hooks/useNetworkStatus'), useNetworkStatus: () => ({ isOnline: true, isInternetReachable: true }),
}));
jest.mock('../../../../utils/date', () => ({ ...jest.requireActual('../../../../utils/date'), getTodayString: () => '2026-10-13' }));
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPatch = jest.fn();
const mockDelete = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a), patch: (...a: unknown[]) => mockPatch(...a),
    delete: (...a: unknown[]) => mockDelete(...a) },
  logApi: { getDaily: (date: string) => mockGet('/log/daily', date) },
  recipesApi: { list: () => mockGet('/recipes') },
  listsApi: { getList: (type: string) => mockGet(`/lists/${type}`) },
}));
jest.mock('../../../../api/mealTemplatesApi', () => ({ mealTemplatesApi: { todayForClient: (d: string) => mockGet('/me/meal-plan/today', d) } }));
const mockHaptics: Record<string, jest.Mock> = {};
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: new Proxy({}, { get: (_t, key: string) => (mockHaptics[key] ??= jest.fn(async () => undefined)) }),
}));
jest.mock('../../../../lib/analytics', () => ({ track: jest.fn() }));
jest.mock('../../../../services/queryClient', () => ({ queryClient: { invalidateQueries: jest.fn() } }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => ({ id: 'jordan' }) }));
const mockStore = { selectedDate: '2026-10-13', setSelectedDate: jest.fn(), refreshShownDay: jest.fn() };
jest.mock('../../../../store/clientStore', () => ({ useClientStore: Object.assign(() => mockStore, { getState: () => mockStore }) }));
const mockEnqueue = jest.fn();
jest.mock('../../../../services/foodLogQueue', () => ({ ...jest.requireActual('../../../../services/foodLogQueue'), enqueue: (...a: unknown[]) => mockEnqueue(...a) }));

import KitchenScreen from '../KitchenScreen';


// ---------- fixtures (fictional: client Jordan) ----------
const item = (meal: string, food: string, i: number) => ({ id: `${meal}-i${i}`, saved_meal_id: meal, food_item_id: food,
  quantity_multiplier: 1, position: i, food_truth: 'ok', food_item: { id: food, name: food, calories: 100, protein_g: 5 } });
const saved = (id: string, name: string, items: unknown[] = [item(id, 'fx', 0)]) =>
  ({ id, user_id: 'jordan', name, created_at: '2026-10-01', updated_at: '2026-10-01', items });
const MEALS = () => [saved('m1', 'Usual breakfast'), saved('m2', 'Post-gym shake'), saved('m3', 'Friday wrap'), saved('m6', 'Gone lunch', [])];
const LIST = '/me/foods/saved-meals';

let server: Record<string, unknown>;
const refusal = (status: number, message = '') =>
  Object.assign(new Error(message), { response: { status, data: { statusCode: status, message } } });
const lost = () => Promise.reject(new Error('Network Error'));
const ok = (data: unknown) => Promise.resolve({ data });
function answer(url: string) {
  const a = server[url];
  if (typeof a === 'function') return (a as () => unknown)();
  return a === undefined ? Promise.reject(refusal(500)) : ok(a);
}
const reads = (url: string) => mockGet.mock.calls.filter((c) => c[0] === url).length;
const announced = () => (AccessibilityInfo.announceForAccessibility as jest.Mock).mock.calls.map((c) => c[0]);
const rows = () => screen.queryAllByTestId(/^kitchen-meal-/).map((n) => n.props.testID as string);
let alerts: jest.SpyInstance;
type Button = { text: string; style?: string; onPress?: () => void };
const lastAlert = () => alerts.mock.calls[alerts.mock.calls.length - 1] as [string, string, Button[]];
const tap = async (title: string, button: string) => {
  const call = [...alerts.mock.calls].reverse().find((c) => c[0] === title) as [string, string, Button[]];
  await act(async () => { call[2].find((b) => b.text === button)?.onPress?.(); });
};

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 30_000 }, mutations: { gcTime: Infinity } } });
  await render(<QueryClientProvider client={client}><KitchenScreen /></QueryClientProvider>);
  await screen.findByTestId('kitchen-meals');
  return client;
}
async function openMeal(id: string) {
  await fireEvent.press(await screen.findByTestId(`kitchen-meal-${id}`));
  return screen.getByTestId('kitchen-sheet');
}
const textOf = (node: unknown): string => {
  if (typeof node === 'string') return node;
  const n = node as { children?: unknown[] } | null;
  return (n?.children ?? []).map(textOf).join('');
};

beforeEach(() => {
  jest.useRealTimers();
  mockDims = { width: 390, height: 844, scale: 2, fontScale: 1 };
  Object.assign(mockFlags, { youTabV2: true, foodPlanChecklist: true, clientTimelineV2: true, clientPathCopilot: true, romanChat: true });
  mockUser = { id: 'jordan', coach_id: null };
  (NetInfo as unknown as { __reset: () => void }).__reset();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  mockGet.mockReset().mockImplementation((url: string) => answer(url));
  [mockPost, mockPatch, mockDelete].forEach((f) => f.mockReset());
  Object.values(mockHaptics).forEach((f) => f.mockClear());
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
  alerts = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  server = { [LIST]: MEALS(), '/lists/grocery': [], '/lists/shopping': [], '/recipes': [] };
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

describe('SAVED-MEAL-SAVE-M: rename and delete a saved meal (Style 2 Menu)', () => {
  it('18. "Rename" and "Delete" sit under Add to today; Rename opens the edit body (no Delete in it); Delete opens the confirm at once', async () => {
    await mount();
    const sheet = await openMeal('m1');
    const rename = within(sheet).getByTestId('kitchen-rename');
    const del = within(sheet).getByTestId('kitchen-delete');
    expect([textOf(rename), textOf(del)]).toEqual(['Rename', 'Delete']);
    expect(rename.props.accessibilityRole).toBe('button');
    await fireEvent.press(del);
    expect(lastAlert()[0]).toBe('Delete Usual breakfast?');
    expect(lastAlert()[1]).toBe('Foods you already logged from it stay in your log.');
    expect(lastAlert()[2].map((b) => [b.text, b.style])).toEqual([['Cancel', 'cancel'], ['Delete', 'destructive']]);
    await tap('Delete Usual breakfast?', 'Cancel');
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId('kitchen-add')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('kitchen-rename'));
    const edit = screen.getByTestId('kitchen-sheet');
    expect(within(edit).getByText('Rename')).toBeTruthy();
    expect(within(edit).queryByTestId('kitchen-delete')).toBeNull();
    expect(within(edit).queryByTestId('kitchen-add')).toBeNull();
    expect(screen.getByTestId('rename-name').props.value).toBe('Usual breakfast');
  });

  it('10. rename: Save name waits for a new name; PATCH that meal with the trimmed name; the row shows it; KS-15 spoken', async () => {
    await mount();
    await openMeal('m2');
    await fireEvent.press(screen.getByTestId('kitchen-rename'));
    const save = () => screen.getByTestId('rename-submit');
    expect(save().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('rename-name'), '   ');
    expect(save().props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByTestId('rename-name'), '  Shake after the gym ');
    expect(save().props.accessibilityState.disabled).toBe(false);
    mockPatch.mockImplementation(() => { server[LIST] = MEALS().map((m) => (m.id === 'm2' ? { ...m, name: 'Shake after the gym' } : m));
      return ok({ ...saved('m2', 'Shake after the gym') }); });
    await fireEvent.press(save());
    await waitFor(() => expect(screen.queryByTestId('kitchen-sheet')).toBeNull());
    expect(mockPatch.mock.calls).toEqual([[`${LIST}/m2`, { name: 'Shake after the gym' }]]);
    expect(within(screen.getByTestId('kitchen-meal-m2')).getByText('Shake after the gym')).toBeTruthy();
    expect(announced().filter((w) => w === 'Renamed to Shake after the gym.')).toHaveLength(1);
  });

  it('10b. rename failures: 404 shows KK-7 and reads the list; a lost answer shows KS-14 and Try again resends the same name; offline sends nothing', async () => {
    await mount();
    await openMeal('m1');
    await fireEvent.press(screen.getByTestId('kitchen-rename'));
    await fireEvent.changeText(screen.getByTestId('rename-name'), 'Weekday breakfast');
    (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false, isInternetReachable: false });
    await fireEvent.press(screen.getByTestId('rename-submit'));
    expect(await screen.findByText('Renaming a saved meal needs a connection. The name was not changed.')).toBeTruthy();
    expect(mockPatch).not.toHaveBeenCalled();
    (NetInfo as unknown as { __reset: () => void }).__reset();
    mockPatch.mockImplementationOnce(lost).mockImplementationOnce(() => Promise.reject(refusal(404, 'Saved meal not found')));
    await fireEvent.press(screen.getByTestId('rename-submit'));
    expect(await screen.findByText('The new name was not saved. Check the connection and try again.')).toBeTruthy();
    expect(textOf(screen.getByTestId('rename-submit'))).toBe('Try again');
    expect(screen.getByTestId('rename-name').props.value).toBe('Weekday breakfast');
    const listReads = reads(LIST);
    await fireEvent.press(screen.getByTestId('rename-submit'));
    expect(await screen.findByText('This meal is no longer saved.')).toBeTruthy();
    expect(mockPatch.mock.calls.map((c) => c[1])).toEqual([{ name: 'Weekday breakfast' }, { name: 'Weekday breakfast' }]);
    await waitFor(() => expect(reads(LIST)).toBe(listReads + 1));
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
  });

  it('10c. a rename in flight holds the sheet (KITCHEN-M C2 class): Close, the scrim and Android Back wait for the answer, which never reaches the next meal', async () => {
    await mount();
    await openMeal('m1');
    await fireEvent.press(screen.getByTestId('kitchen-rename'));
    await fireEvent.changeText(screen.getByTestId('rename-name'), 'Weekday breakfast');
    let release: (v: unknown) => void = () => undefined;
    mockPatch.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    await fireEvent.press(screen.getByTestId('rename-submit'));
    // The PATCH is running: every way out of the edit body holds still, as the add body's do.
    await fireEvent.press(screen.getByTestId('kitchen-sheet-close'));
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('kitchen-sheet-scrim', { includeHiddenElements: true }));
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
    await fireEvent(screen.getByTestId('kitchen-sheet'), 'requestClose'); // Android Back (the Modal's onRequestClose)
    expect(screen.getByTestId('kitchen-sheet')).toBeTruthy();
    expect(screen.getByTestId('kitchen-sheet-close').props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    // The answer closes the sheet it was sent from; the next meal's sheet opens fresh and stays open.
    await act(async () => { release({ data: saved('m1', 'Weekday breakfast') }); });
    await waitFor(() => expect(screen.queryByTestId('kitchen-sheet')).toBeNull());
    await openMeal('m2');
    expect(textOf(screen.getByTestId('kitchen-sheet-title'))).toBe('Post-gym shake');
    expect(screen.getByTestId('kitchen-sheet-close').props.accessibilityState).not.toEqual(expect.objectContaining({ disabled: true }));
    expect(mockPatch.mock.calls.map((c) => c[0])).toEqual(['/me/foods/saved-meals/m1']);
  });

  it('11. delete: one DELETE for that meal; a 2xx and a 404 both remove the row, close the sheet and speak "Deleted {name}."', async () => {
    await mount();
    await openMeal('m1');
    mockDelete.mockImplementation(() => { server[LIST] = MEALS().filter((m) => m.id !== 'm1'); return ok({ deleted: true }); });
    await fireEvent.press(screen.getByTestId('kitchen-delete'));
    await tap('Delete Usual breakfast?', 'Delete');
    await waitFor(() => expect(screen.queryByTestId('kitchen-sheet')).toBeNull());
    expect(mockDelete.mock.calls).toEqual([[`${LIST}/m1`]]);
    expect(rows()).not.toContain('kitchen-meal-m1');
    expect(announced().filter((w) => w === 'Deleted Usual breakfast.')).toHaveLength(1);
    await openMeal('m3');
    // Gone already (a resend after a lost answer): the server answers 404 and its list no longer holds it.
    mockDelete.mockImplementation(() => { server[LIST] = (server[LIST] as Array<{ id: string }>).filter((m) => m.id !== 'm3');
      return Promise.reject(refusal(404, 'Saved meal not found')); });
    await fireEvent.press(screen.getByTestId('kitchen-delete'));
    await tap('Delete Friday wrap?', 'Delete');
    await waitFor(() => expect(screen.queryByTestId('kitchen-sheet')).toBeNull());
    expect(rows()).not.toContain('kitchen-meal-m3');
    expect(announced()).toContain('Deleted Friday wrap.');
  });

  it('11b. a 500 or no answer shows KS-13 and the row stays, the sheet open; offline shows its line and sends nothing', async () => {
    await mount();
    await openMeal('m2');
    mockDelete.mockImplementationOnce(() => Promise.reject(refusal(500))).mockImplementationOnce(lost);
    for (let i = 0; i < 2; i += 1) {
      await fireEvent.press(screen.getByTestId('kitchen-delete'));
      await tap('Delete Post-gym shake?', 'Delete');
      await waitFor(() => expect(lastAlert()[0]).toBe("Couldn't delete Post-gym shake"));
      expect(lastAlert()[1]).toBe('It is still saved. Check the connection and try again.');
      expect(lastAlert()[2].map((b) => b.text)).toEqual(['OK']);
      expect(rows()).toContain('kitchen-meal-m2');
      expect(screen.getByTestId('kitchen-add')).toBeTruthy();
    }
    expect(mockDelete).toHaveBeenCalledTimes(2);
    (NetInfo as unknown as { __setState: (s: object) => void }).__setState({ isConnected: false, isInternetReachable: false });
    await fireEvent.press(screen.getByTestId('kitchen-delete'));
    await tap('Delete Post-gym shake?', 'Delete');
    await waitFor(() => expect(lastAlert()[1]).toBe('Deleting a saved meal needs a connection. It is still saved.'));
    expect(mockDelete).toHaveBeenCalledTimes(2);
  });

  it('11c. a meal with no foods left still shows Rename and Delete, and deletes; deleting the last meal shows the empty group with the way in', async () => {
    server[LIST] = [saved('m6', 'Gone lunch', [])];
    await mount();
    const sheet = await openMeal('m6');
    expect(within(sheet).queryByTestId('kitchen-add')).toBeNull();
    expect(within(sheet).getByTestId('kitchen-rename')).toBeTruthy();
    mockDelete.mockImplementation(() => { server[LIST] = []; return ok({ deleted: true }); });
    await fireEvent.press(within(sheet).getByTestId('kitchen-delete'));
    await tap('Delete Gone lunch?', 'Delete');
    await waitFor(() => expect(screen.queryByTestId('kitchen-sheet')).toBeNull());
    expect(mockDelete.mock.calls).toEqual([[`${LIST}/m6`]]);
    expect(await screen.findByTestId('kitchen-empty')).toBeTruthy();
    expect(within(screen.getByTestId('kitchen-meals')).getByTestId('kitchen-save-way')).toBeTruthy();
  });

  it('12. the id: a refresh that re-orders the list under the open sheet changes nothing; rename and delete send the opened meal', async () => {
    const client = await mount();
    await openMeal('m2');
    server[LIST] = [saved('m7', 'From the other phone'), ...MEALS().reverse()];
    await act(async () => { await client.refetchQueries({ queryKey: ['me', 'foods', 'saved-meals'] }); });
    await waitFor(() => expect(rows()[0]).toBe('kitchen-meal-m7'));
    mockDelete.mockImplementation(() => Promise.reject(refusal(500)));
    await fireEvent.press(screen.getByTestId('kitchen-delete'));
    await tap('Delete Post-gym shake?', 'Delete');
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    expect(mockDelete.mock.calls[0][0]).toBe(`${LIST}/m2`);
    await fireEvent.press(screen.getByTestId('kitchen-rename'));
    await fireEvent.changeText(screen.getByTestId('rename-name'), 'Shake');
    mockPatch.mockImplementation(() => ok(saved('m2', 'Shake')));
    await fireEvent.press(screen.getByTestId('rename-submit'));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch.mock.calls[0][0]).toBe(`${LIST}/m2`);
  });
});
