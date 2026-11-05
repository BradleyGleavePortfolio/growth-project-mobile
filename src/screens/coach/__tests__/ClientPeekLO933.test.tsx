/**
 * LO-933 (Opus lens, m#933 @ 6a24c889): B-TESTs. Each fails at the reviewed head.
 * B1: with none waiting, only the client's own note may be cut; the app's own words (the day and "energy {n} of 5")
 * must never sit in a one-line Text.
 */
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react-native';

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
const client = (toReview = 0) => ({
  id: 'c1', firstName: 'Jordan', lastName: 'Reyes', email: 'c1@example.com', status: 'active', createdAt: '2026-08-14T10:00:00.000Z',
  activity: { lastActiveOn: day(0), checkInsToReview: toReview },
}) as unknown as RosterClient;

async function mount(c = client()) {
  await render(<ClientPeekSheet client={c} onClose={jest.fn()} onOpen={jest.fn()} onNudge={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags = {};
  mockFontScale = 1.3;
  mockWidth = 320;
  mockSummary.mockResolvedValue({ data: { profile: null, today: { entries: [{ id: 'e1' }], total_calories: 920 }, weight_logs: [{ weight_lbs: 181.6, date: day(-1) }] } });
  mockCheckIns.mockResolvedValue({ data: [{ id: 'k1', date: `${day(-1)}T00:00:00.000Z`, energy: 4, notes: 'Slept well, legs a bit sore after Monday' }] });
  mockWeek.mockResolvedValue({ data: { week_start: '2026-11-02', today: '2026-11-04', shared: true, assignments: [] } });
});

describe('LO-933 B1: the Check-ins cut takes only the client note', () => {
  it('with none waiting, the day and energy words are never in a one-line Text (only the note may cut)', async () => {
    await mount(client(0));
    const row = screen.getByTestId('peek-slice-checkins');
    const appWords = within(row).queryAllByText(/Yesterday|energy 4 of 5/);
    expect(appWords.length).toBeGreaterThan(0);
    for (const t of appWords) expect(t.props.numberOfLines).not.toBe(1);
    // The note itself is still on screen (cut or not), every word of it.
    expect(within(row).queryAllByText(/Slept well, legs a bit sore after Monday/).length).toBeGreaterThan(0);
  });
});
