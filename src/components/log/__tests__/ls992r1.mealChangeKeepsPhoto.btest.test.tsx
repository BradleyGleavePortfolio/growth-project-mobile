/**
 * LS-992R1 B2 (B-TEST, fails at ca5d980df21933431546a2a66d49b7f81dd9f9c3): the meal changed in the sheet after the photo.
 *
 * On the Style C day every Add with no plan link opens the sheet with the meal choice row, on a guessed meal
 * (LogScreen.tsx:780 `openAddFood(meal, link, !link, manual)`, :846 `onMealChange`). The photo is tagged with the meal
 * showing at the pick (FoodSearchModal.tsx:238 -> mealPhoto.ts:131). A client who takes the photo, then moves the choice
 * to the right meal and logs the food gets no attach (mealPhoto.ts:155 compares the pick's meal with the save's), the
 * photo is let go when the sheet closes, and no word is shown. Nothing on the sheet says which meal the photo is for.
 *
 * Held here: the food the client then logs from that same open sheet takes the photo. Made-up files and keys only.
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
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), put: (...a: unknown[]) => mockPut(...a) },
  foodApi: { create: jest.fn() },
  logApi: { logFood: (...a: unknown[]) => mockLogFood(...a) },
}));
jest.mock('../../../services/foodLogQueue', () => ({ enqueue: jest.fn() }));
jest.mock('../../../store/clientStore', () => ({ useClientStore: { getState: () => ({ selectedDate: '2026-11-13' }) } }));

import FoodSearchModal from '../FoodSearchModal';
import { submitSearchLogOnline } from '../../../utils/log/logSubmit';
import type { MealType } from '../../../types';
import type { SearchResult } from '../../../utils/log/types';

const FILE = 'file:///cache/ImagePicker/made-up-meal.jpg';
const oats: SearchResult = { id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
  nutrient_basis: 'PER_100G', serving_size_grams: 40 } as SearchResult;
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

const realOS = Platform.OS;
let sheet: jest.SpyInstance;
let alert: jest.SpyInstance;
let choose: (i: number) => void;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
  choose = () => undefined;
  sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_o, cb) => { choose = cb; });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockLibrary.mockResolvedValue({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
  mockInfo.mockResolvedValue({ exists: true, size: 2_000_000, uri: FILE, isDirectory: false, modificationTime: 1 });
  mockPost.mockResolvedValue({ status: 201, data: { upload_url: 'https://storage.example.test/up?token=made-up', key: 'meal/made-up/k1.jpg',
    expires_at: new Date(Date.now() + 600_000).toISOString() } });
  mockUpload.mockResolvedValue({ status: 200, headers: {}, body: '' });
  mockDelete.mockResolvedValue(undefined);
  mockPut.mockResolvedValue({ status: 200, data: { entry_id: 'entry-1', photo: null } });
  mockLogFood.mockResolvedValue({ status: 201, data: { id: 'entry-1' } });
});
afterEach(() => {
  sheet.mockRestore();
  alert.mockRestore();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

it('LS-992R1 B2: a photo taken before the client moves the meal choice goes with the food then logged from that sheet', async () => {
  const view = await render(<FoodSearchModal {...base} />);

  // The client takes the photo while the sheet's guessed meal (Lunch) shows.
  await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
  await act(async () => { choose(1); });
  await settle();
  expect(mockUpload).toHaveBeenCalledTimes(1);

  // Then moves the meal choice to Dinner: LogScreen's setActiveMealType re-renders the sheet on the new meal.
  await fireEvent.press(within(screen.getByTestId('food-search-meals')).getByRole('radio', { name: 'Dinner' }));
  expect(onMealChange).toHaveBeenCalledWith('dinner');
  await view.rerender(<FoodSearchModal {...base} activeMealType="dinner" />);
  await settle();

  // And logs a food: the save carries the sheet's meal at the tap (LogScreen.tsx:347).
  await submitSearchLogOnline({ food: oats, date: '2026-11-13', mealType: 'dinner', multiplier: 1 });
  await settle();
  await view.rerender(<FoodSearchModal {...base} activeMealType="dinner" visible={false} />);
  await settle();

  expect(mockLogFood).toHaveBeenCalledTimes(1);
  expect(mockPut).toHaveBeenCalledWith('/log/food/entry-1/photo', { key: 'meal/made-up/k1.jpg', width: 1200, height: 900 });
  expect(alert).not.toHaveBeenCalled();
});
