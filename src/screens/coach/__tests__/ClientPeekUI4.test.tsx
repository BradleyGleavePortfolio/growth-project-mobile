/**
 * UI-4 peek sheet (client-peek-sheet mockup). Every button opens today's real screen, no slice reads as not
 * shared (#SHARE-SIMPLE), and Payments shows only while coach_payment_actions is on.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockSummary = jest.fn();
const mockCheckIns = jest.fn();
const mockWeek = jest.fn();
let mockFlags: Record<string, boolean> = {};
let mockTarget: { isSuccess: boolean; data: unknown } = { isSuccess: false, data: null };
jest.mock('../../../services/api', () => ({
  coachApi: { getClientSummary: (...a: unknown[]) => mockSummary(...a), getClientCheckIns: (...a: unknown[]) => mockCheckIns(...a), getClientWeek: (...a: unknown[]) => mockWeek(...a) },
}));
let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }) }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: mockFlags }) }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForClient: () => mockTarget }));
jest.mock('../../../theme/ThemeProvider', () => {
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
const mockText = (t: string) => React.createElement(jest.requireActual('react-native').Text, null, t);
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: { name: string }) => mockText(`icon:${p.name}`) }));
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../ui', () => ({ Overline: jest.requireActual('react-native').Text, useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../ui/states/QuietStates', () => ({
  QuietLoading: () => mockText('Loading'),
  QuietError: (p: { message: string; onRetry: () => void }) =>
    jest.requireActual('react').createElement(jest.requireActual('react-native').Pressable, { onPress: p.onRetry, testID: 'peek-retry' }, mockText(p.message)),
}));

import ClientPeekSheet from '../lookup/ClientPeekSheet';
import { peekSlices } from '../../../utils/coach/clientPeek';
import { workoutWeek } from '../client-detail/thisWeek';
import type { RosterClient } from '../../../utils/coach/clientRoster';

const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const client = (logged = true) => ({
  id: 'c1', firstName: 'Maya', lastName: 'Brooks', email: 'c1@example.com', status: 'active', createdAt: '2026-08-14T10:00:00.000Z',
  activity: { lastActiveOn: logged ? day(0) : null, checkInsToReview: logged ? 2 : 0 },
}) as unknown as RosterClient;
const now = new Date().toISOString();
// CLIENT-FILE-DAYS-M: the Workouts slice reads the client file's week (ClientPeekWeek196 has its cases).
const WORKOUT = '1 of 2 done';
const week = (n: number) => ({ data: { week_start: '2026-11-02', today: '2026-11-02', shared: true, assignments: [
  { day: '2026-11-02', completed_at: now, skipped_at: null }, { day: '2026-11-04', completed_at: null, skipped_at: null },
].slice(0, n) } });
const summary = (empty = false) => ({
  data: {
    client_name: 'Maya Brooks', profile: null,
    today: { entries: empty ? [] : [{ id: 'e1' }], total_calories: 1420, total_protein_g: 96 },
    recent_workouts: empty ? [] : [{ id: 'w1', workout_name: 'Full body A', created_at: now }],
    weight_logs: [],
  },
});
const onOpen = jest.fn();
const onNudge = jest.fn();
const onClose = jest.fn();

async function mount(c = client()) {
  await render(<ClientPeekSheet client={c} onClose={onClose} onOpen={onOpen} onNudge={onNudge} />);
  await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags = {};
  mockFontScale = 1;
  mockTarget = { isSuccess: true, data: { calories_kcal: 1900, protein_g: 140, carbs_g: 200, fats_g: 60 } };
  mockSummary.mockResolvedValue(summary());
  mockWeek.mockResolvedValue(week(2));
  mockCheckIns.mockResolvedValue({ data: [{ id: 'k1', date: `${day(0)}T00:00:00.000Z`, energy: 2, notes: 'knee tight' }] });
});

describe('UI-4 peek sheet', () => {
  // PEEK-K1-M (C_peek): no status line; Check-ins reads K1-S-19 "{n} to review"; Food reads kcal alone.
  it('matches the mockup: header, four rows and no weigh-in yet', async () => {
    await mount();
    expect(mockCheckIns).toHaveBeenCalledWith('c1', { limit: 1 });
    expect(screen.getByText('Maya Brooks')).toBeTruthy();
    expect(screen.getByText('Active, joined Aug 14')).toBeTruthy();
    expect(screen.queryByText(/Logged today/)).toBeNull();
    expect(screen.getByText('2 to review')).toBeTruthy();
    expect(screen.getByText('1,420 of 1,900\u00a0kcal')).toBeTruthy();
    expect(screen.getByText(WORKOUT)).toBeTruthy();
    expect(mockWeek).toHaveBeenCalledWith('c1');
    expect(screen.getByText('Nothing logged yet')).toBeTruthy();
    expect(screen.queryByText(/Not shared/)).toBeNull();
    expect(screen.queryByText('icon:lock-closed-outline')).toBeNull();
    expect(screen.getByText('Message Maya')).toBeTruthy();
    expect(screen.getByText('Send nudge')).toBeTruthy();
    expect(screen.queryByTestId('peek-chip-Payments')).toBeNull();
  });

  it('every button opens today\'s real screen', async () => {
    const maya = client();
    await mount(maya);
    const taps: Array<[string, unknown]> = [
      ['peek-review', { screen: 'ClientDetail', tab: 'timeline' }],
      ['peek-message', { screen: 'chat' }], // the lookup opens it through openInboxChat
      ['peek-chip-Food log', { screen: 'ClientDetail', tab: 'logs' }],
      ['peek-chip-Workouts', { screen: 'ClientDetail', tab: 'workouts' }],
      ['peek-chip-Full profile', { screen: 'ClientDetail' }],
    ];
    for (const [id, target] of taps) {
      await fireEvent.press(screen.getByTestId(id));
      expect(onOpen).toHaveBeenLastCalledWith(maya, target);
    }
    // Meal plan is drawn but display only (owner #197-E6): not a button, and pressing it opens nothing.
    expect(screen.getByTestId('peek-chip-Meal plan').props.accessibilityRole).toBe('text');
    expect(screen.getByTestId('peek-chip-Meal plan').props.onPress).toBeUndefined();
    await fireEvent.press(screen.getByTestId('peek-nudge'));
    expect(onNudge).toHaveBeenCalledWith(maya);
    await fireEvent.press(screen.getByTestId('peek-close'));
    await fireEvent.press(screen.getByTestId('peek-scrim', { includeHiddenElements: true })); // screen readers use Close (the sheet is the modal view)
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // PEEK-K1-M: C_peek draws the two side by side at every size, 130% included. FIX-933 (LO-933 B2, newer than
  // LO-847 B2's equal halves, which were graded on the UI-4 mockup before #196-E8): each is as wide as its words.
  it.each([
    ['default text', 1, 'Maya', 'row'],
    ['130% text', 1.3, 'Maya', 'row'],
    ['a long first name', 1, 'Maximiliana-Jo', 'row'],
  ])('Message and Send nudge stay two buttons in one row, sized to their words, at %s (LO-933 B2)', async (_case, scale, first, direction) => {
    mockFontScale = scale as number;
    await mount({ ...client(), firstName: first } as RosterClient);
    const row = StyleSheet.flatten(screen.getByTestId('peek-buttons').props.style);
    expect(row.flexDirection).toBe(direction);
    expect(row.flexWrap).toBeUndefined(); // never a content-sized wrap
    // Each slot starts at its words' width (basis auto) and takes an equal share of what is left; never a zero-basis
    // half. When short of room, Message gives way first; Send nudge never passes half the row (C_peek android360 130%).
    const slots = screen.getAllByTestId('peek-slot');
    expect(slots).toHaveLength(2);
    expect(StyleSheet.flatten(slots[0].props.style)).toMatchObject({ flexGrow: 1, flexShrink: 1, flexBasis: 'auto' });
    expect(StyleSheet.flatten(slots[1].props.style)).toMatchObject({ flexGrow: 1, flexShrink: 0, flexBasis: 'auto', maxWidth: '50%' });
    for (const slot of slots) expect(StyleSheet.flatten(slot.props.style).flex).toBeUndefined();
    expect(screen.getByText(`Message ${first}`)).toBeTruthy();
  });

  it('Payments shows only while coach_payment_actions is on, and opens ClientPayments', async () => {
    mockFlags = { coach_payment_actions: true };
    const maya = client();
    await mount(maya);
    await fireEvent.press(screen.getByTestId('peek-chip-Payments'));
    expect(onOpen).toHaveBeenLastCalledWith(maya, { screen: 'ClientPayments' });
  });

  it('a client who logged nothing: every slice says so, no status line and no Review', async () => {
    mockSummary.mockResolvedValue(summary(true));
    mockCheckIns.mockResolvedValue({ data: [] });
    mockWeek.mockResolvedValue(week(0));
    await mount(client(false));
    expect(screen.getAllByText('Nothing logged yet')).toHaveLength(3);
    expect(screen.getByText('Nothing planned this week')).toBeTruthy(); // Workouts reads the file's words (FIX739-W1)
    expect(screen.queryByText(/waiting for you/)).toBeNull();
    expect(screen.queryByTestId('peek-review')).toBeNull();
  });

  it('slices with nothing in them read "Nothing logged yet", never empty', async () => {
    mockSummary.mockResolvedValue(summary(true));
    mockCheckIns.mockResolvedValue({ data: [] });
    mockWeek.mockResolvedValue(week(0));
    await mount();
    expect(screen.getAllByText('Nothing logged yet')).toHaveLength(2);
    expect(screen.getByText('2 to review')).toBeTruthy(); // PEEK-K1-M: the roster's count, K1-S-19, still reads
    expect(screen.getByText('Nothing planned this week')).toBeTruthy();
  });

  it('a failed load shows the quiet error, and Try again loads it', async () => {
    mockSummary.mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(screen.getByText('Could not load this client. Please try again.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('peek-retry'));
    await waitFor(() => expect(screen.getByText(WORKOUT)).toBeTruthy());
  });

  it("one client's answer never shows under another client's name, early or late", async () => {
    const later = () => {
      let settle!: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
      const p = new Promise((resolve, reject) => { settle = { resolve, reject }; });
      return { p, ...settle };
    };
    const theo = { ...client(false), id: 'c2', firstName: 'Theo', lastName: 'Grant' } as unknown as RosterClient;
    const theoSummary = summary();
    theoSummary.data.today.total_calories = 2210;
    // Nothing waiting to review, so the Check-ins row shows each client's own latest check-in.
    // FIX-933: the app's words and the client's note are drawn apart (only the note may be cut).
    const MAYA = ['Today: energy 2 of 5', 'knee tight', '1,420 of 1,900\u00a0kcal'];
    const THEO = ['Today: energy 4 of 5', 'felt strong', '2,210 of 1,900\u00a0kcal'];
    mockCheckIns.mockImplementation((id: string) => Promise.resolve({
      data: [id === 'c2' ? { id: 'k2', date: `${day(0)}T00:00:00.000Z`, energy: 4, notes: 'felt strong' } : { id: 'k1', date: `${day(0)}T00:00:00.000Z`, energy: 2, notes: 'knee tight' }],
    }));
    const sheet = (c: RosterClient | null) => <ClientPeekSheet client={c} onClose={onClose} onOpen={onOpen} onNudge={onNudge} />;
    const showsOnly = (mine: string[], other: string[]) => {
      for (const t of mine) expect(screen.getByText(t)).toBeTruthy();
      for (const t of other) expect(screen.queryByText(t)).toBeNull();
    };
    const { rerender } = await render(sheet(client(false)));
    await waitFor(() => showsOnly(MAYA, THEO));

    // Maya has loaded; the coach closes her and opens Theo while his read is still on its way.
    const theoRead = later();
    mockSummary.mockImplementation((id: string) => (id === 'c2' ? theoRead.p : Promise.resolve(summary())));
    await rerender(sheet(null));
    await rerender(sheet(theo));
    expect(screen.getByText('Theo Grant')).toBeTruthy();
    expect(screen.getByText('Loading')).toBeTruthy();
    showsOnly([], MAYA);
    await act(async () => { theoRead.resolve(theoSummary); });
    await waitFor(() => showsOnly(THEO, MAYA));

    // Maya's slow read lands after the coach has moved on to Theo, as an answer and as a failure.
    for (const late of ['answer', 'failure'] as const) {
      const mayaRead = later();
      mockSummary.mockImplementation((id: string) => (id === 'c1' ? mayaRead.p : Promise.resolve(theoSummary)));
      await rerender(sheet(null));
      await rerender(sheet(client(false)));
      await rerender(sheet(null));
      await rerender(sheet(theo));
      await waitFor(() => showsOnly(THEO, MAYA));
      await act(async () => { if (late === 'answer') mayaRead.resolve(summary()); else mayaRead.reject(new Error('offline')); });
      showsOnly(THEO, MAYA);
      expect(screen.queryByText('Could not load this client. Please try again.')).toBeNull();
    }
  });

  it("every chip is a 44 pt touch target around the mockup's 36 pt pill", async () => {
    mockFlags = { coach_payment_actions: true };
    await mount();
    for (const label of ['Food log', 'Meal plan', 'Workouts', 'Payments', 'Full profile']) {
      expect(StyleSheet.flatten(screen.getByTestId(`peek-chip-${label}`).props.style).minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('reads weigh-ins and targets the way the mockup words them', () => {
    const s = summary().data;
    const slices = peekSlices(client(), { ...s, weight_logs: [{ weight_lbs: 182.44, date: day(0) }] }, [], workoutWeek(week(0).data), null);
    expect(slices.weighIn.text).toBe('Today: 182.4\u00a0lb');
    expect(slices.food.text).toBe('1,420\u00a0kcal'); // no target: no "of"; units never wrap apart; C_peek draws no protein
    expect(slices.checkIn).toEqual({ text: '2 to review', hasOne: true, note: null }); // K1-S-19 from the roster
    expect(peekSlices(client(false), s, [], workoutWeek(week(0).data), null).checkIn).toEqual({ text: 'Nothing logged yet', hasOne: false, note: null });
  });
});
