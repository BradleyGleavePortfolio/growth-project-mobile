/**
 * PEEK-K1-M (owner #196-E8, K1 Style C, C_peek): the peek's four one-line rows in order (label left, value
 * right, no icons), no "Logged today" line, Message {first} and Send nudge side by side at every size, and the
 * chips in C_peek's order, each opening what K1 index.md rule 2 says (Meal plan has no screen today).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

const mockSummary = jest.fn();
const mockCheckIns = jest.fn();
const mockWeek = jest.fn();
let mockFlags: Record<string, boolean> = {};
let mockFontScale = 1;
let mockWidth = 390;
jest.mock('../../../services/api', () => ({
  coachApi: { getClientSummary: (...a: unknown[]) => mockSummary(...a), getClientCheckIns: (...a: unknown[]) => mockCheckIns(...a), getClientWeek: (...a: unknown[]) => mockWeek(...a) },
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: mockWidth, height: 800, scale: 3, fontScale: mockFontScale }) }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: mockFlags }) }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForClient: () => ({ isSuccess: true, data: { calories_kcal: 1900, protein_g: 140, carbs_g: 200, fats_g: 60 } }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const flat = new Proxy({}, { get: () => '#000000' });
  const anyColor = new Proxy({}, { get: (_t, k) => (k === 'surface' || k === 'data' ? flat : '#000000') });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
const mockText = (t: string) => React.createElement(jest.requireActual('react-native').Text, null, t);
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: { name: string }) => mockText(`icon:${p.name}`) }));
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../ui', () => ({ Overline: jest.requireActual('react-native').Text, useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../ui/states/QuietStates', () => ({ QuietLoading: () => mockText('Loading'), QuietError: (p: { message: string }) => mockText(p.message) }));

import ClientPeekSheet from '../lookup/ClientPeekSheet';
import type { RosterClient } from '../../../utils/coach/clientRoster';

const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const client = (first = 'Jordan', toReview = 1) => ({
  id: 'c1', firstName: first, lastName: 'Reyes', email: 'c1@example.com', status: 'active', createdAt: '2026-08-14T10:00:00.000Z',
  activity: { lastActiveOn: day(0), checkInsToReview: toReview },
}) as unknown as RosterClient;
const at = (d: string, done = false) => ({ day: d, completed_at: done ? `${d}T18:00:00.000Z` : null, skipped_at: null });
const onOpen = jest.fn();
const onNudge = jest.fn();

async function mount(c = client()) {
  await render(<ClientPeekSheet client={c} onClose={jest.fn()} onOpen={onOpen} onNudge={onNudge} />);
  await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
}
const rowIds = () => screen.getAllByTestId(/^peek-slice-/).map((r) => r.props.testID);
const value = (key: string) => screen.getByTestId(`peek-value-${key}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags = {};
  mockFontScale = 1;
  mockWidth = 390;
  mockSummary.mockResolvedValue({ data: { profile: null, today: { entries: [{ id: 'e1' }], total_calories: 920, total_protein_g: 64 }, weight_logs: [{ weight_lbs: 181.6, date: day(-1) }] } });
  mockCheckIns.mockResolvedValue({ data: [{ id: 'k1', date: `${day(0)}T00:00:00.000Z`, energy: 3, notes: 'knee tight' }] });
  mockWeek.mockResolvedValue({ data: { week_start: '2026-11-02', today: '2026-11-04', shared: true, assignments: [at('2026-11-02', true), at('2026-11-03'), at('2026-11-05'), at('2026-11-07')] } });
});

describe('C_peek rows (PEEK-K1-M)', () => {
  it('Check-ins, Food, Workouts, Weigh-ins in order, one line each, label left and value right, no icons', async () => {
    await mount();
    expect(rowIds()).toEqual(['peek-slice-checkins', 'peek-slice-food', 'peek-slice-workouts', 'peek-slice-weighins']);
    const want: Array<[string, string, string]> = [
      ['checkins', 'Check-ins', '1 to review'],
      ['food', 'Food', '920 of 1,900\u00a0kcal'],
      ['workouts', 'Workouts', 'Missed Tue'],
      ['weighins', 'Weigh-ins', 'Yesterday: 181.6\u00a0lb'],
    ];
    for (const [key, label, text] of want) {
      const row = screen.getByTestId(`peek-slice-${key}`);
      expect(StyleSheet.flatten(row.props.style).flexDirection).toBe('row');
      expect(within(row).getByText(label)).toBeTruthy(); // the label first, the value after it
      expect(row.props.children[0].props.children).toBe(label);
      expect(value(key).props.children).toBe(text);
      // One line at every drawn size (renders); a short value may wrap on a 320 pt phone at 130%, never lose words.
      expect(value(key).props.numberOfLines).toBe(2);
      expect(StyleSheet.flatten(value(key).props.style).textAlign).toBe('right');
    }
    expect(screen.queryAllByText(/^icon:(clipboard|restaurant|barbell|scale)/)).toHaveLength(0);
    expect(screen.getByText('Review')).toBeTruthy();
  });

  it('with none waiting, the latest check-in (free text) keeps to one line', async () => {
    await mount(client('Jordan', 0));
    expect(value('checkins').props.children).toBe('Today: energy 3 of 5, knee tight');
    expect(value('checkins').props.numberOfLines).toBe(1);
  });

  // PEEK-K1-M2: only the client's own free text is cut; the app's words wrap like every other row (320 pt, 130%).
  it.each([
    ['nothing logged', [], 'Nothing logged yet'],
    ['a check-in without a note', [{ id: 'k2', date: '2026-11-03T00:00:00.000Z', energy: 4, notes: '' }], 'energy 4 of 5'],
  ])('with none waiting and %s, Check-ins wraps like the other rows, never cut', async (_case, rows, text) => {
    mockCheckIns.mockResolvedValue({ data: rows });
    await mount(client('Jordan', 0));
    expect(value('checkins').props.children).toEqual(expect.stringContaining(text));
    expect(value('checkins').props.numberOfLines).toBe(2);
  });

  it('the "Logged today" line is gone (C_peek draws it at no state)', async () => {
    await mount();
    expect(screen.queryByText(/Logged today|waiting for you/)).toBeNull();
  });

  it('Review opens what it opens today: the check-in on the file\'s Timeline', async () => {
    const c = client();
    await mount(c);
    await fireEvent.press(screen.getByTestId('peek-review'));
    expect(onOpen).toHaveBeenLastCalledWith(c, { screen: 'ClientDetail', tab: 'timeline' });
  });
});

describe('C_peek buttons (PEEK-K1-M)', () => {
  it.each([
    ['ios 390, 100%', 390, 1, 'Jordan'],
    ['ios 390, 130%', 390, 1.3, 'Jordan'],
    ['android 360, 100%', 360, 1, 'Jordan'],
    ['android 360, 130%', 360, 1.3, 'Jordan'],
    ['a long first name at 130%', 360, 1.3, 'Maximiliana-Jo'],
  ])('Message {first} and Send nudge sit side by side, equal halves, at %s', async (_case, width, scale, first) => {
    mockWidth = width as number;
    mockFontScale = scale as number;
    await mount(client(first as string));
    const row = StyleSheet.flatten(screen.getByTestId('peek-buttons').props.style);
    expect(row.flexDirection).toBe('row');
    expect(row.flexWrap).toBeUndefined();
    const slots = screen.getAllByTestId('peek-slot');
    expect(slots).toHaveLength(2);
    for (const slot of slots) expect(StyleSheet.flatten(slot.props.style).flex).toBe(1);
    for (const id of ['peek-message', 'peek-nudge']) expect(StyleSheet.flatten(screen.getByTestId(id).props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByText(`Message ${first}`).props.numberOfLines).toBeUndefined(); // a long name wraps in its half, never cut
  });
});

describe('C_peek chips (PEEK-K1-M)', () => {
  it.each([
    ['Payments on', true, ['Food log', 'Workouts', 'Payments', 'Full profile']],
    ['Payments off', false, ['Food log', 'Workouts', 'Full profile']],
  ])('%s: the chips in C_peek order (no Meal plan: no screen opens it today), each a 44 pt target', async (_case, on, labels) => {
    mockFlags = { coach_payment_actions: on as boolean };
    await mount();
    expect(screen.getAllByTestId(/^peek-chip-/).map((c) => c.props.testID)).toEqual((labels as string[]).map((l) => `peek-chip-${l}`));
    for (const l of labels as string[]) expect(StyleSheet.flatten(screen.getByTestId(`peek-chip-${l}`).props.style).minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.queryByTestId('peek-chip-Meal plan')).toBeNull();
  });

  it('each chip opens what K1 rule 2 says', async () => {
    mockFlags = { coach_payment_actions: true };
    const c = client();
    await mount(c);
    const want: Array<[string, unknown]> = [
      ['Food log', { screen: 'ClientDetail', tab: 'logs' }],
      ['Workouts', { screen: 'ClientDetail', tab: 'workouts' }],
      ['Payments', { screen: 'ClientPayments' }],
      ['Full profile', { screen: 'ClientDetail' }],
    ];
    for (const [label, target] of want) {
      await fireEvent.press(screen.getByTestId(`peek-chip-${label}`));
      expect(onOpen).toHaveBeenLastCalledWith(c, target);
    }
  });
});
