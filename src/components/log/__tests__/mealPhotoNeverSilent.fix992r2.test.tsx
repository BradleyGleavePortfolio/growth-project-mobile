/**
 * FIX-992R2 (LO-992R1 B1, LS-992R1 B1, B2 and C3, one class, [R24]): a meal photo the client took is never let go
 * without her knowing. It goes with the first food saved from the open Add sheet on every online save path, or, when
 * the sheet closes with it unused, she is told in one line ("Photo not saved — add a food to keep it", operator ruling
 * (a), approved (operator, #203-E15)). One row per save path of the search-backed list in the PR body (Class-first path
 * list). Harness: LS-992R1 B2's (ls992r1.mealChangeKeepsPhoto.btest.test.tsx). Made-up files, links and keys only.
 */
import React from 'react';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

jest.mock('@expo/vector-icons', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { Ionicons: (p: Record<string, unknown>) => R.createElement(View, { ...p, iconName: p.name }) };
});
jest.mock('../../../ui', () => ({ ...jest.requireActual('../../../ui'), useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native-svg', () => {
  const R = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  const part = (kind: string) => (p: Record<string, unknown>) => R.createElement(View, { ...p, svgKind: kind });
  return { __esModule: true, default: part('Svg'), Svg: part('Svg'), Path: part('Path'), Ellipse: part('Ellipse'), Circle: part('Circle') };
});
const mockLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: (...a: unknown[]) => mockLibrary(...a),
  UIImagePickerPreferredAssetRepresentationMode: { Automatic: 'automatic', Compatible: 'compatible', Current: 'current' },
}));
const mockInfo = jest.fn();
const mockDelete = jest.fn();
const mockUpload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  getInfoAsync: (...a: unknown[]) => mockInfo(...a),
  deleteAsync: (...a: unknown[]) => mockDelete(...a),
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
}));
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockLogFood = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), put: (...a: unknown[]) => mockPut(...a) },
  foodApi: { create: (...a: unknown[]) => mockCreate(...a) },
  logApi: { logFood: (...a: unknown[]) => mockLogFood(...a) },
}));
const mockEnqueue = jest.fn();
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: (...a: unknown[]) => mockEnqueue(...a) }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: { getState: () => ({ selectedDate: '2026-11-13' }) } }));

import FoodSearchModal from '../FoodSearchModal';
import { submitManualLogOffline, submitManualLogOnlineWithId, submitSearchLogOffline, submitSearchLogOnline } from '../../../utils/log/logSubmit';
import { queuePastMeal, repeatPastMeal } from '../../../utils/log/quickLog';
import { dropMealPhoto } from '../../../utils/log/mealPhoto';
import { MEAL_SECTIONS } from '../../../utils/log/types';
import { authEvents } from '../../../utils/authEvents';
import type { MealType } from '../../../types';
import type { SearchResult } from '../../../utils/log/types';

const DAY = '2026-11-13';
const FILE = 'file:///cache/ImagePicker/made-up-meal.jpg';
const KEY = 'meal/made-up/k1.jpg';
const UNUSED = 'Photo not saved — add a food to keep it';
const oats: SearchResult = { id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
  nutrient_basis: 'PER_100G', serving_size_grams: 40 } as SearchResult;
const pick = (over: Record<string, unknown> = {}) => ({ food: oats, date: DAY, mealType: 'lunch' as MealType, multiplier: 1, ...over });
const soup = (over: Record<string, unknown> = {}) => ({ foodName: 'Soup', calories: '210', protein: '9', carbs: '20', fat: '8',
  quantity: '1', unit: 'serving', date: DAY, mealType: 'lunch' as MealType, ...over });
const yesterday = {
  date: '2026-11-12',
  calories: 520,
  entries: [
    { foodItemId: 'made-up-rice', name: 'Rice', calories: 260, quantityMultiplier: 2 },
    { foodItemId: 'made-up-chicken', name: 'Chicken', calories: 260, quantityMultiplier: 1.5 },
  ],
};
const offline = () => ({ message: 'Network Error', code: 'ERR_NETWORK' });
const onMealChange = jest.fn();
const base = {
  onClose: jest.fn(), onSearchChange: jest.fn(), onClearSearch: jest.fn(), onRetrySearch: jest.fn(), onRecentTabChange: jest.fn(),
  onSelectFood: jest.fn(), onEnterManualMode: jest.fn(), onExitManualMode: jest.fn(), onManualFieldChange: jest.fn(),
  onManualLog: jest.fn(), onMealChange,
  visible: true, activeMealType: 'lunch' as MealType, searchQuery: '', searching: false, showSlowMessage: false,
  searchError: null, searchResults: [], didYouMean: [], recentTab: 'recent' as const, recentFoods: [oats], frequentFoods: [],
  manualMode: false, manualFields: { foodName: '', calories: '', protein: '', carbs: '', fat: '', quantity: '1', unit: 'serving' },
};
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };
const attachCalls = () => mockPut.mock.calls.filter(([url]) => /^\/log\/food\/.+\/photo$/.test(String(url)));

const realOS = Platform.OS;
let sheet: jest.SpyInstance;
let alert: jest.SpyInstance;
let choose: (i: number) => void;

beforeEach(() => {
  dropMealPhoto(); // a clean slate: nothing kept from the case before
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
  choose = () => undefined;
  sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_o, cb) => { choose = cb; });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
  mockInfo.mockResolvedValue({ exists: true, size: 2_000_000, uri: FILE, isDirectory: false, modificationTime: 1 });
  mockPost.mockResolvedValue({ status: 201, data: { upload_url: 'https://storage.example.test/up?token=made-up', key: KEY,
    expires_at: new Date(Date.now() + 600_000).toISOString() } });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  mockPut.mockResolvedValue({ status: 200, data: { entry_id: 'entry-1', photo: null } });
  let n = 0;
  mockLogFood.mockImplementation(async () => { n += 1; return { status: 201, data: { id: `entry-${n}` } }; });
  mockCreate.mockResolvedValue({ data: { id: 'food-1' } });
  mockEnqueue.mockResolvedValue(undefined);
});
afterEach(() => {
  sheet.mockRestore();
  alert.mockRestore();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

/** The sheet open on Lunch, and a library photo taken from its tile, uploaded and kept. */
async function sheetWithPhoto() {
  const view = await render(<FoodSearchModal {...base} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
  await act(async () => { choose(1); });
  await settle();
  expect(mockUpload).toHaveBeenCalledTimes(1);
  let meal: MealType = 'lunch';
  return {
    /** The client taps another meal on the sheet's meal row; LogScreen's setActiveMealType re-renders the sheet on it. */
    moveMeal: async (to: MealType) => {
      const label = MEAL_SECTIONS.find((m) => m.type === to)?.label;
      await fireEvent.press(within(screen.getByTestId('food-search-meals')).getByRole('radio', { name: label }));
      expect(onMealChange).toHaveBeenLastCalledWith(to);
      meal = to;
      await view.rerender(<FoodSearchModal {...base} activeMealType={meal} />);
      await settle();
    },
    close: async () => {
      await view.rerender(<FoodSearchModal {...base} activeMealType={meal} visible={false} />);
      await settle();
    },
  };
}
type Sheet = Awaited<ReturnType<typeof sheetWithPhoto>>;

// [path, how the client gets there, the entry that takes the photo or 'told' when no food can take it]
const PATHS: Array<[string, (s: Sheet) => Promise<unknown>, string]> = [
  ['a search, Recent or Frequent pick (LogScreen.tsx:381)', () => submitSearchLogOnline(pick()), 'entry-1'],
  ['Quick add (LogScreen.tsx:429)', () => submitManualLogOnlineWithId(soup()), 'entry-1'],
  ['Repeat, "Add all" (LogScreen.tsx:499, quickLog.ts repeatPastMeal; LO-992R1 B1, LS-992R1 B1)',
    () => repeatPastMeal(yesterday, DAY, 'lunch'), 'entry-1'],
  ['Repeat whose first food fails: the meal\'s first saved food', () => {
    mockLogFood.mockRejectedValueOnce(offline()).mockResolvedValueOnce({ status: 201, data: { id: 'entry-chicken' } });
    return repeatPastMeal(yesterday, DAY, 'lunch');
  }, 'entry-chicken'],
  ['the meal choice moved after the photo, then a pick (the sheet\'s meal row; LS-992R1 B2)', async (s) => {
    await s.moveMeal('dinner');
    return submitSearchLogOnline(pick({ mealType: 'dinner' }));
  }, 'entry-1'],
  ['the meal choice moved after the photo, then Quick add', async (s) => {
    await s.moveMeal('snack');
    return submitManualLogOnlineWithId(soup({ mealType: 'snack' }));
  }, 'entry-1'],
  ['the meal choice moved after the photo, then Repeat', async (s) => {
    await s.moveMeal('breakfast');
    return repeatPastMeal(yesterday, DAY, 'breakfast');
  }, 'entry-1'],
  ['the sheet closes with no food added (LS-992R1 C3)', async () => undefined, 'told'],
  ['an offline pick (queued, R6), then the sheet closes', () => submitSearchLogOffline(pick()), 'told'],
  ['an offline Quick add (queued), then the sheet closes', () => submitManualLogOffline(soup()), 'told'],
  ['an offline Repeat (queuePastMeal), then the sheet closes', () => queuePastMeal(yesterday, DAY, 'lunch'), 'told'],
  ['a save to the next day (the sheet left open past midnight), then the sheet closes',
    () => submitSearchLogOnline(pick({ date: '2026-11-14' })), 'told'],
  ['an online save answered with no id, then the sheet closes', () => {
    mockLogFood.mockResolvedValueOnce({ status: 201, data: {} });
    return submitSearchLogOnline(pick());
  }, 'told'],
  ['a food save that failed, then the sheet closes', async () => {
    mockLogFood.mockRejectedValueOnce(offline());
    await expect(submitSearchLogOnline(pick())).rejects.toEqual(offline());
  }, 'told'],
  ['a Repeat whose every food failed, then the sheet closes', async () => {
    mockLogFood.mockRejectedValue(offline());
    await expect(repeatPastMeal(yesterday, DAY, 'lunch')).resolves.toEqual({ added: 0, failedNames: ['Rice', 'Chicken'] });
  }, 'told'],
];

describe('FIX-992R2: a photo she took goes with the first food saved, or she is told in one line', () => {
  it.each(PATHS)('%s', async (_path, act_, outcome) => {
    const s = await sheetWithPhoto();
    await act_(s);
    await settle();
    if (outcome === 'told') {
      expect(attachCalls()).toEqual([]);
    } else {
      expect(attachCalls()).toEqual([[`/log/food/${outcome}/photo`, { key: KEY, width: 1200, height: 900 }]]);
    }
    await s.close();
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    expect(alert.mock.calls).toEqual(outcome === 'told' ? [[UNUSED]] : []);
  });

  it('the sheet closes while the photo still uploads: told once, and nothing more when the upload ends', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mockUpload.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    const view = await render(<FoodSearchModal {...base} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(1); });
    await settle();
    await view.rerender(<FoodSearchModal {...base} visible={false} />);
    await settle();
    await act(async () => { finish({ status: 200, headers: {}, body: '' }); });
    await settle();
    expect(alert.mock.calls).toEqual([[UNUSED]]);
    await submitSearchLogOnline(pick());
    await settle();
    expect(attachCalls()).toEqual([]);
  });

  it('the sheet closes while the picker is still up: told once when the photo comes back, and nothing is uploaded', async () => {
    let give: (v: unknown) => void = () => undefined;
    mockLibrary.mockImplementationOnce(() => new Promise((r) => { give = r; }));
    const view = await render(<FoodSearchModal {...base} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(1); });
    await view.rerender(<FoodSearchModal {...base} visible={false} />);
    await settle();
    expect(alert).not.toHaveBeenCalled();
    await act(async () => { give({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] }); });
    await settle();
    expect(alert.mock.calls).toEqual([[UNUSED]]);
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
  });

  it('a pick cancelled after the sheet closed says nothing (no photo was taken)', async () => {
    let give: (v: unknown) => void = () => undefined;
    mockLibrary.mockImplementationOnce(() => new Promise((r) => { give = r; }));
    const view = await render(<FoodSearchModal {...base} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(1); });
    await view.rerender(<FoodSearchModal {...base} visible={false} />);
    await act(async () => { give({ canceled: true, assets: null }); });
    await settle();
    expect(alert).not.toHaveBeenCalled();
  });

  it('a photo taken whose attach is refused: its own words (MP-W10) once, and no second line at the close', async () => {
    mockPut.mockRejectedValueOnce({ response: { status: 422, data: { code: 'log.photo.has_location' } } });
    const s = await sheetWithPhoto();
    await submitSearchLogOnline(pick());
    await settle();
    await s.close();
    expect(alert.mock.calls).toEqual([['Photo not saved', 'Your food was added, but its photo was not saved.']]);
  });

  it('a sign-out while a photo is kept lets it go with no line: no client is signed in to read it (C, edge)', async () => {
    await sheetWithPhoto();
    await act(async () => { authEvents.emit('logout'); });
    await settle();
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    expect(alert).not.toHaveBeenCalled();
  });
});
