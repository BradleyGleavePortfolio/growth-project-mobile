/**
 * UI-4 peek sheet (client-peek-sheet mockup). Every button opens today's real screen, a slice the client
 * does not share reads "Not shared by <first name>", and Payments shows only while coach_payment_actions is on.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockSummary = jest.fn();
const mockCheckIns = jest.fn();
let mockFlags: Record<string, boolean> = {};
let mockTarget: { isSuccess: boolean; data: unknown } = { isSuccess: false, data: null };
jest.mock('../../../services/api', () => ({
  coachApi: { getClientSummary: (...a: unknown[]) => mockSummary(...a), getClientCheckIns: (...a: unknown[]) => mockCheckIns(...a) },
}));
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
import type { RosterClient } from '../../../utils/coach/clientRoster';

const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const client = (shared = true) => ({
  id: 'c1', firstName: 'Maya', lastName: 'Brooks', email: 'c1@example.com', status: 'active', createdAt: '2026-08-14T10:00:00.000Z',
  activity: { shared, lastActiveOn: shared ? day(0) : null, checkInsToReview: shared ? 2 : null },
}) as unknown as RosterClient;
const now = new Date().toISOString();
const assignment = (coach: string, done: boolean) => ({ scheduled_for: `${day(0)}T12:00:00`, assigned_by_coach_id: coach, completed_at: done ? now : null });
const summary = (consent: Record<string, boolean> = {}, empty = false) => ({
  data: {
    client_name: 'Maya Brooks', profile: null,
    today: { entries: empty ? [] : [{ id: 'e1' }], total_calories: 1420, total_protein_g: 96 },
    recent_workouts: empty ? [] : [{ id: 'w1', workout_name: 'Full body A', created_at: now }],
    // Only this coach's assignments count; an earlier coach's never show.
    recent_assignments: [assignment('coach-1', true), assignment('coach-1', false), assignment('earlier-coach', true)],
    weight_logs: [],
    consent: { workouts: true, food_macros: true, body_metrics: false, habits_progress: true, ...consent },
  },
});
const onOpen = jest.fn();
const onNudge = jest.fn();
const onClose = jest.fn();

async function mount(c = client()) {
  await render(<ClientPeekSheet client={c} coachId="coach-1" onClose={onClose} onOpen={onOpen} onNudge={onNudge} />);
  await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags = {};
  mockTarget = { isSuccess: true, data: { calories_kcal: 1900, protein_g: 140, carbs_g: 200, fats_g: 60 } };
  mockSummary.mockResolvedValue(summary());
  mockCheckIns.mockResolvedValue({ data: [{ id: 'k1', date: `${day(0)}T00:00:00.000Z`, energy: 2, notes: 'knee tight' }] });
});

describe('UI-4 peek sheet', () => {
  it('matches the mockup: header, status line, four slices and Weigh-ins not shared', async () => {
    await mount();
    expect(mockCheckIns).toHaveBeenCalledWith('c1', { limit: 1 });
    expect(screen.getByText('Maya Brooks')).toBeTruthy();
    expect(screen.getByText('Active, joined Aug 14')).toBeTruthy();
    expect(screen.getByText('Logged today. 2 check-ins waiting for you.')).toBeTruthy();
    expect(screen.getByText('Today: energy 2 of 5, knee tight')).toBeTruthy();
    expect(screen.getByText('1,420 of 1,900 kcal, protein 96 g')).toBeTruthy();
    expect(screen.getByText('Full body A today, 1 of 2')).toBeTruthy();
    expect(screen.getByText('Not shared by Maya')).toBeTruthy();
    expect(screen.getByText('icon:lock-closed-outline')).toBeTruthy();
    expect(screen.getByText('Message Maya')).toBeTruthy();
    expect(screen.getByText('Send nudge')).toBeTruthy();
    expect(screen.queryByTestId('peek-chip-Payments')).toBeNull();
  });

  it('every button opens today\'s real screen', async () => {
    const maya = client();
    await mount(maya);
    const taps: Array<[string, unknown]> = [
      ['peek-review', { screen: 'ClientDetail', tab: 'timeline' }],
      ['peek-message', { screen: 'ClientMessages' }],
      ['peek-chip-Food log', { screen: 'ClientDetail', tab: 'logs' }],
      ['peek-chip-Meal plan', { screen: 'ClientDetail', tab: 'mealplan' }],
      ['peek-chip-Workouts', { screen: 'ClientDetail', tab: 'workouts' }],
      ['peek-chip-Full profile', { screen: 'ClientDetail' }],
    ];
    for (const [id, target] of taps) {
      await fireEvent.press(screen.getByTestId(id));
      expect(onOpen).toHaveBeenLastCalledWith(maya, target);
    }
    await fireEvent.press(screen.getByTestId('peek-nudge'));
    expect(onNudge).toHaveBeenCalledWith(maya);
    await fireEvent.press(screen.getByTestId('peek-close'));
    await fireEvent.press(screen.getByTestId('peek-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('Payments shows only while coach_payment_actions is on, and opens ClientPayments', async () => {
    mockFlags = { coach_payment_actions: true };
    const maya = client();
    await mount(maya);
    await fireEvent.press(screen.getByTestId('peek-chip-Payments'));
    expect(onOpen).toHaveBeenLastCalledWith(maya, { screen: 'ClientPayments' });
  });

  it('a client who shares nothing: every slice names her, no status line and no Review', async () => {
    mockSummary.mockResolvedValue(summary({ workouts: false, food_macros: false, body_metrics: false, habits_progress: false }));
    mockCheckIns.mockResolvedValue({ data: [] });
    await mount(client(false));
    expect(screen.getAllByText('Not shared by Maya')).toHaveLength(4);
    expect(screen.queryByText(/waiting for you/)).toBeNull();
    expect(screen.queryByTestId('peek-review')).toBeNull();
  });

  it('shared slices with nothing in them read "Nothing logged yet", never empty', async () => {
    mockSummary.mockResolvedValue(summary({ body_metrics: true }, true));
    mockCheckIns.mockResolvedValue({ data: [] });
    await mount();
    expect(screen.getAllByText('Nothing logged yet')).toHaveLength(4);
  });

  it('a failed load shows the quiet error, and Try again loads it', async () => {
    mockSummary.mockRejectedValueOnce(new Error('offline'));
    await mount();
    expect(screen.getByText('Could not load this client. Please try again.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('peek-retry'));
    await waitFor(() => expect(screen.getByText('Full body A today, 1 of 2')).toBeTruthy());
  });

  it('reads weigh-ins and targets the way the mockup words them', () => {
    const s = summary({ body_metrics: true }).data;
    const slices = peekSlices(client(), { ...s, weight_logs: [{ weight_lbs: 182.44, date: day(0) }] }, [], 'coach-1', null);
    expect(slices.weighIn.text).toBe('182.4 lb today');
    expect(slices.food.text).toBe('1,420 kcal, protein 96 g'); // no target: no "of"
    expect(slices.checkIn).toEqual({ text: 'Nothing logged yet', shared: true, hasOne: false });
  });
});
