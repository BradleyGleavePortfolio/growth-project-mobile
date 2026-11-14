/**
 * MEAL-PHOTO-M (cases 1, 2 and 10's sheet half): "Photo of a meal" in the Add sheet's column 2, as C2 Style C C_add draws
 * it (context a9434a53 planning/MOCKUP3/C2/style-c/C_add_ios390_100.png; markup C_add.html :121-122 .c-big2 and its first
 * tile's camera, path "M4 8h3l2-2.5h6L17 8h3v11H4z" with a circle at 12,13.5 r 3.5), the chooser on the app's ActionMenu
 * (iOS draws its own action sheet), and the kept photo let go when the sheet closes. Android keeps base's row: its
 * picker copies EXIF location into the re-encoded file (expo-image-picker 56.0.25 CompressionImageExporter.kt:38), so the
 * Android part is stopped (R3). Made-up files only.
 */
import React from 'react';
import { ActionSheetIOS, Dimensions, Platform, StyleSheet } from 'react-native';
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
const mockCameraPermission = jest.fn();
const mockCamera = jest.fn();
const mockLibrary = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: (...a: unknown[]) => mockCameraPermission(...a),
  launchCameraAsync: (...a: unknown[]) => mockCamera(...a),
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
import { lightTokens } from '../../../theme/tokens';
import { submitSearchLogOnline } from '../../../utils/log/logSubmit';
import type { MealType } from '../../../types';
import type { SearchResult } from '../../../utils/log/types';

type Node = { type: string; props: Record<string, any>; children: Array<Node | string>; parent: Node | null;
  queryAll: (match: (n: Node) => boolean) => Node[] };
const flat = (n: unknown) => (StyleSheet.flatten((n as Node).props.style) ?? {}) as Record<string, unknown>;
const kids = (n: unknown) => (n as Node).children.filter((c): c is Node => typeof c === 'object');
const svgsIn = (n: unknown, kind = 'Svg') => (n as Node).queryAll((x) => x.props.svgKind === kind);

const FILE = 'file:///cache/ImagePicker/made-up-meal.jpg';
const oats: SearchResult = { id: 'oats', name: 'Rolled oats', calories: 379, protein: 13, carbs: 68, fat: 6.5,
  nutrient_basis: 'PER_100G', serving_size_grams: 40 } as SearchResult;
const handlers = {
  onClose: jest.fn(), onSearchChange: jest.fn(), onClearSearch: jest.fn(), onRetrySearch: jest.fn(), onRecentTabChange: jest.fn(),
  onSelectFood: jest.fn(), onEnterManualMode: jest.fn(), onExitManualMode: jest.fn(), onManualFieldChange: jest.fn(),
  onManualLog: jest.fn(),
};
const base = {
  ...handlers, visible: true, activeMealType: 'lunch' as MealType, searchQuery: '', searching: false, showSlowMessage: false,
  searchError: null, searchResults: [], didYouMean: [], recentTab: 'recent' as const, recentFoods: [oats], frequentFoods: [],
  manualMode: false, manualFields: { foodName: '', calories: '', protein: '', carbs: '', fat: '', quantity: '1', unit: 'serving' },
};
type Over = Partial<React.ComponentProps<typeof FoodSearchModal>>;
const show = (over: Over = {}) => render(<FoodSearchModal {...base} {...over} />);
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); }); };

const realOS = Platform.OS;
const setOS = (os: 'ios' | 'android') => Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
let sheet: jest.SpyInstance;
let choose: (i: number) => void;
let dims: jest.SpyInstance | null = null;
const size = (fontScale: number, width = 390) => {
  dims = jest.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 844, scale: 3, fontScale });
};

beforeEach(() => {
  jest.clearAllMocks();
  setOS('ios');
  choose = () => undefined;
  sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_o, cb) => { choose = cb; });
  mockCameraPermission.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
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
  dims?.mockRestore();
  dims = null;
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => realOS });
});

describe('case 1: the tile in column 2', () => {
  it.each([[1], [1.3]])('at %sx text: Quick add in column 1, Photo of a meal in column 2, column 3 empty, three equal columns', async (scale) => {
    size(scale);
    await show();
    const cells = kids(screen.getByTestId('food-tools'));
    expect(cells).toHaveLength(3);
    // R1: past 100% the 2:1:1 rule would leave "Photo" 40 pt at 320 pt, so the row keeps the drawing's own columns.
    expect(cells.map((c) => flat(c).flex)).toEqual([1, 1, 1]);
    expect(screen.getByRole('button', { name: 'Quick add, enter a food manually' }).parent).toBe(cells[0]);
    const tile = screen.getByRole('button', { name: 'Photo of a meal' });
    expect(tile.parent).toBe(cells[1]);
    expect(cells[2].children).toHaveLength(0);
  });

  it('the tile copies Quick add\'s exactly, with the drawn camera at 24 above the words', async () => {
    await show();
    const quick = screen.getByRole('button', { name: 'Quick add, enter a food manually' });
    const tile = screen.getByRole('button', { name: 'Photo of a meal' });
    expect(flat(tile)).toEqual(flat(quick));
    const [glyph, words] = kids(tile);
    expect(glyph.props).toMatchObject({ svgKind: 'Svg', width: 24, height: 24, stroke: lightTokens.accentText, strokeWidth: 1.6 });
    expect(svgsIn(glyph, 'Path').map((p) => p.props.d)).toEqual(['M4 8h3l2-2.5h6L17 8h3v11H4z']);
    expect(svgsIn(glyph, 'Circle').map((c) => [c.props.cx, c.props.cy, c.props.r])).toEqual([['12', '13.5', '3.5']]);
    expect(words).toHaveTextContent('Photo of a meal');
    expect(flat(words)).toEqual(flat(kids(quick)[1]));
    expect(tile.props.accessibilityHint).toBe('Take or choose a photo to keep with the next food you add');
  });

  it('while searching no tool row shows, as at base', async () => {
    await show({ searchQuery: 'oat' });
    expect(screen.queryByTestId('food-tools')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Photo of a meal' })).toBeNull();
  });

  it.each([[1], [1.3]])('Android at %sx keeps base\'s row: no photo tile, the R3 stop', async (scale) => {
    setOS('android');
    size(scale, 360);
    await show();
    const cells = kids(screen.getByTestId('food-tools'));
    expect(cells.map((c) => flat(c).flex)).toEqual(scale > 1 ? [2, 1, 1] : [1, 1, 1]);
    expect(cells.slice(1).map((c) => c.children.length)).toEqual([0, 0]);
    expect(screen.queryByRole('button', { name: 'Photo of a meal' })).toBeNull();
  });
});

describe('case 2: the chooser', () => {
  it('shows "Take photo" and "Choose from library" with Cancel', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(sheet.mock.calls[0][0].options).toEqual(['Take photo', 'Choose from library', 'Cancel']);
    expect(sheet.mock.calls[0][0].cancelButtonIndex).toBe(2);
  });

  it('"Take photo" asks for the camera and opens it once', async () => {
    mockCamera.mockResolvedValueOnce({ canceled: true, assets: null });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(0); });
    await settle();
    expect(mockCameraPermission).toHaveBeenCalledTimes(1);
    expect(mockCamera).toHaveBeenCalledTimes(1);
    expect(mockLibrary).not.toHaveBeenCalled();
  });

  it('"Choose from library" opens the photo picker once, then uploads the pick', async () => {
    mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(1); });
    await settle();
    expect(mockLibrary).toHaveBeenCalledTimes(1);
    expect(mockCamera).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledWith('/log/food/photo/upload-url', { mime: 'image/jpeg', size_bytes: 2_000_000 });
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('Cancel starts nothing and keeps nothing', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(2); });
    await settle();
    expect(mockCamera).not.toHaveBeenCalled();
    expect(mockLibrary).not.toHaveBeenCalled();
    expect(mockPost).not.toHaveBeenCalled();
    await submitSearchLogOnline({ food: oats, date: '2026-11-13', mealType: 'lunch', multiplier: 1 });
    await settle();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('while a pick or upload runs, a second tap starts nothing (KT-3)', async () => {
    let finish: (v: unknown) => void = () => undefined;
    mockUpload.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(1); });
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    expect(sheet).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ status: 200, headers: {}, body: '' }); });
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    expect(sheet).toHaveBeenCalledTimes(2);
  });
});

describe('case 10: the sheet that kept the photo closes', () => {
  it('the kept photo is let go and its file deleted; a food logged after attaches nothing', async () => {
    mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
    const view = await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(1); });
    await settle();
    expect(mockDelete).not.toHaveBeenCalled();
    await view.rerender(<FoodSearchModal {...base} visible={false} />);
    await settle();
    expect(mockDelete).toHaveBeenCalledWith(FILE, { idempotent: true });
    await view.rerender(<FoodSearchModal {...base} visible />);
    await submitSearchLogOnline({ food: oats, date: '2026-11-13', mealType: 'lunch', multiplier: 1 });
    await settle();
    expect(mockLogFood).toHaveBeenCalledTimes(1);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('with the sheet open the photo goes with the first food logged to its meal', async () => {
    mockLibrary.mockResolvedValueOnce({ canceled: false, assets: [{ uri: FILE, width: 1200, height: 900, mimeType: 'image/jpeg' }] });
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Photo of a meal' }));
    await act(async () => { choose(1); });
    await settle();
    await submitSearchLogOnline({ food: oats, date: '2026-11-13', mealType: 'lunch', multiplier: 1 });
    await settle();
    expect(mockPut).toHaveBeenCalledWith('/log/food/entry-1/photo', { key: 'meal/made-up/k1.jpg', width: 1200, height: 900 });
    expect(within(screen.getByTestId('food-tools')).getByText('Photo of a meal')).toBeTruthy();
  });
});
