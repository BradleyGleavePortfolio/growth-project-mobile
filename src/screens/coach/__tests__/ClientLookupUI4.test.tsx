/**
 * UI-4 (V1_1_UI_SPEC) — coach client lookup behind featureFlags.coachClientLookup. Every tap lands on a real
 * screen; a client the roster no longer returns (moved, owner 4) never shows, even from Opened recently.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { ScrollView } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockGetClients = jest.fn();
const mockUnread = jest.fn();
const mockSendNudge = jest.fn();
const mockCache = new Map<string, string>();
const mockHaptic = { success: jest.fn(), error: jest.fn(), warning: jest.fn() };
jest.mock('../../../services/api', () => ({
  coachApi: { getClients: (...a: unknown[]) => mockGetClients(...a), getUnreadCounts: () => mockUnread(), sendNudge: (...a: unknown[]) => mockSendNudge(...a) },
}));
jest.mock('../../../storage/mmkv', () => ({
  cacheStorage: { getStringAsync: async (k: string) => mockCache.get(k), set: async (k: string, v: string) => void mockCache.set(k, v) },
}));
jest.mock('../../../ui/haptics/haptics.service', () => ({ get HapticService() { return mockHaptic; } }));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-1', role: 'coach' }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const anyColor = new Proxy({}, { get: () => '#000000' });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
const mockText = (t: string) => React.createElement(jest.requireActual('react-native').Text, null, t);
jest.mock('../../../ui', () => ({ Overline: jest.requireActual('react-native').Text, useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../ui/states/QuietStates', () => ({ QuietLoading: () => mockText('Loading clients'), QuietError: (p: { message: string }) => mockText(p.message) }));
jest.mock('../../../ui/empty-states', () => ({ EmptyStateNoResults: () => mockText('No results') }));

import ClientLookupScreen from '../lookup/ClientLookupScreen';
import { useCoachStore } from '../../../store/coachStore';
import { featureFlags } from '../../../config/featureFlags';
import { dayWord, groupByLetter, lastLoggedWord, lookupReason, needsYouSentence, parseLookupQuery, recentFromRoster } from '../../../utils/coach/clientLookup';
import type { RosterClient } from '../../../utils/coach/clientRoster';

const pad = (n: number) => String(n).padStart(2, '0');
const day = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
type Act = { shared?: boolean; last?: string | null; review?: number; workout?: string };
const wire = (id: string, name: string, a: Act = {}, joined = day(-60)) => ({
  id, name, email: `${id}@example.com`, created_at: `${joined}T10:00:00.000Z`,
  activity: { shared: a.shared ?? true, last_active_on: a.last ?? null, check_ins_to_review: a.review ?? 0, last_workout_on: a.workout ?? null },
});
const navigate = jest.fn();
const nav = { navigate, addListener: () => () => undefined } as never;

async function mount(rows: ReturnType<typeof wire>[], unread: Record<string, number> = {}) {
  mockGetClients.mockImplementation(async (status: string) => ({ data: status === 'archived' ? [wire('z1', 'Zed Old')] : rows }));
  mockUnread.mockResolvedValue({ data: { total: 0, by_client: unread } });
  await render(<ClientLookupScreen navigation={nav} />);
  await waitFor(() => expect(screen.getByTestId('lookup-count')).toBeTruthy());
}

const UNDER_15 = [wire('c1', 'Maya Brooks', { last: day(0), review: 2 }), wire('c2', 'Theo Grant', { last: day(0), workout: day(0) }), wire('c3', 'Priya Nair', {}, day(-2))];
const NAMES = ['Ana Lopez', 'Ava Price', 'Ben Carter', 'Bianca Shah', 'Chloe Dunn', 'Dev Patel', 'Elena Ruiz', 'Finn Walsh',
  'Grace Kim', 'Maya Brooks', 'Omar Haddad', 'Priya Nair', 'Sam Okafor', 'Theo Grant', 'Uma Reyes'];
const MANY = NAMES.map((n, i) => wire(`m${i}`, n, n === 'Ben Carter' ? { last: day(-5) } : n === 'Ava Price' ? { shared: false } : { last: day(-1) }));

beforeEach(() => { jest.clearAllMocks(); mockCache.clear(); useCoachStore.getState().reset(); });

describe('UI-4 helpers', () => {
  it('reads typed filter words and writes the Needs you sentence with number words', () => {
    expect(parseLookupQuery(' Review  messages ')).toEqual({ filters: ['review', 'messages'], text: '' });
    expect(needsYouSentence(2, 1)).toBe('Two need you today. One is steady.');
    expect(needsYouSentence(1, 0)).toBe('One needs you today.');
    expect(needsYouSentence(0, 3)).toBe('Three are steady.');
  });
  it('never shows an empty value: not shared names the client, nothing logged says so', () => {
    const c = (a: Act) => ({ id: 'x', firstName: 'Ava', lastName: 'Price', email: '', createdAt: day(-30), activity: { shared: a.shared ?? true, lastActiveOn: a.last ?? null, checkInsToReview: 0 } }) as unknown as RosterClient;
    expect(lastLoggedWord(c({ shared: false }))).toBe('Not shared by Ava');
    expect(lookupReason(c({ shared: false }), {}, 'recent').text).toBe('Not shared by Ava');
    expect(lastLoggedWord(c({}))).toBe('Nothing logged yet');
    expect(lookupReason(c({ last: day(-1) }), { x: 3 }, 'recent')).toEqual({ text: '3 new messages', action: 'reply', ok: false });
    expect(dayWord(day(0))).toBe('Today');
    expect(dayWord(day(-1))).toBe('Yesterday');
  });
  it('groups A to Z and keeps only recent ids the roster still returns (moved clients drop out)', () => {
    const roster = [{ id: 'a', firstName: 'Ana', lastName: 'L' }, { id: 'b', firstName: 'Ben', lastName: 'C' }] as RosterClient[];
    expect(groupByLetter(roster).map((g) => g.letter)).toEqual(['A', 'B']);
    expect(recentFromRoster(['moved', 'b'], roster).map((c) => c.id)).toEqual(['b']);
  });
  it('ships OFF: default false and not switched on in any eas.json profile', () => {
    expect(featureFlags.coachClientLookup).toBe(false);
    const eas = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'eas.json'), 'utf8');
    expect(eas).not.toMatch(/EXPO_PUBLIC_FF_COACH_CLIENT_LOOKUP/);
  });
});

describe('UI-4 Needs you (under 15 clients)', () => {
  it('matches the mockup: count, sentence, Review / Say hello, and the steady row', async () => {
    await mount(UNDER_15);
    expect(screen.getByText('3 active clients')).toBeTruthy();
    expect(screen.getByText('Two need you today. One is steady.')).toBeTruthy();
    expect(screen.getByText('2 check-ins to review')).toBeTruthy();
    expect(screen.getByText('Logged today, workout done')).toBeTruthy();
    expect(screen.getByText('New, no logs yet')).toBeTruthy();
    expect(screen.getByText('Add your next client')).toBeTruthy();
    expect(screen.queryByTestId('lookup-search')).toBeNull();
  });
  it('every button opens a real screen', async () => {
    await mount(UNDER_15);
    await fireEvent.press(screen.getByTestId('lookup-act-c1'));
    expect(navigate).toHaveBeenLastCalledWith('ClientDetail', { clientId: 'c1', clientName: 'Maya Brooks' });
    await fireEvent.press(screen.getByTestId('lookup-act-c3'));
    expect(navigate).toHaveBeenLastCalledWith('ClientMessages', { clientId: 'c3', clientName: 'Priya Nair' });
    await fireEvent.press(screen.getByTestId('lookup-row-c2'));
    expect(navigate).toHaveBeenLastCalledWith('ClientDetail', { clientId: 'c2', clientName: 'Theo Grant' });
    await fireEvent.press(screen.getByTestId('lookup-share-code'));
    expect(navigate).toHaveBeenLastCalledWith('InviteCodes');
    await fireEvent.press(screen.getByTestId('lookup-invite'));
    expect(navigate).toHaveBeenLastCalledWith('InviteCodes');
    await fireEvent.press(screen.getByTestId('lookup-archived-link'));
    await waitFor(() => expect(screen.getByText('1 archived client')).toBeTruthy());
  });
});

describe('UI-4 Search first (15 or more)', () => {
  it('shows the search, chips with counts, A to Z sections and the tip', async () => {
    await mount(MANY, { m3: 2 });
    expect(screen.getByText('15 active clients')).toBeTruthy();
    expect(screen.getByTestId('lookup-search').props.placeholder).toBe('Name, email or a filter');
    expect(screen.getByTestId('lookup-chip-messages').props.accessibilityLabel).toBe('New messages, 1');
    expect(screen.getByTestId('lookup-chip-notSharing').props.accessibilityLabel).toBe('Not sharing, 1');
    expect(screen.getByTestId('lookup-chip-quiet').props.accessibilityLabel).toBe('Quiet 3+ days, 1');
    expect(screen.getByText('Not shared by Ava')).toBeTruthy();
    expect(screen.getByTestId('lookup-letter-A')).toBeTruthy();
    expect(screen.getByText(/filters combine with typing/)).toBeTruthy();
  });
  it('"quiet ben" finds Ben Carter, and a chip narrows the list', async () => {
    await mount(MANY);
    await fireEvent.changeText(screen.getByTestId('lookup-search'), 'quiet ben');
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.getByText('Ben Carter')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('lookup-search'), '');
    await fireEvent.press(screen.getByTestId('lookup-chip-notSharing'));
    expect(screen.getByText('1 result')).toBeTruthy();
    expect(screen.getByText('Ava Price')).toBeTruthy();
  });
  it('message and bell open the thread and the nudge form; a sent nudge gives the success haptic', async () => {
    mockSendNudge.mockResolvedValue({});
    await mount(MANY);
    await fireEvent.changeText(screen.getByTestId('lookup-search'), 'ben');
    await fireEvent.press(screen.getByTestId('lookup-message-m2'));
    expect(navigate).toHaveBeenLastCalledWith('ClientMessages', { clientId: 'm2', clientName: 'Ben Carter' });
    await fireEvent.press(screen.getByTestId('lookup-nudge-m2'));
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Great job today'), 'Checking in');
    await fireEvent.changeText(screen.getByPlaceholderText('Write a short message...'), 'How is the week going');
    await fireEvent.press(screen.getByLabelText('Send nudge'));
    expect(mockSendNudge).toHaveBeenCalledWith('m2', { title: 'Checking in', body: 'How is the week going' });
    expect(mockHaptic.success).toHaveBeenCalled();
  });
  it('Opened recently lists only clients still on the roster, and opening one records it', async () => {
    mockCache.set('coach_lookup_recent:coach-1', JSON.stringify(['moved-away', 'm9']));
    await mount(MANY);
    await waitFor(() => expect(screen.getByText('Opened recently')).toBeTruthy());
    expect(screen.getAllByText('Maya Brooks').length).toBe(2);
    expect(screen.queryByTestId('lookup-row-moved-away')).toBeNull();
    await fireEvent.press(screen.getByTestId('lookup-az-m0'));
    expect(navigate).toHaveBeenLastCalledWith('ClientDetail', { clientId: 'm0', clientName: 'Ana Lopez' });
    await waitFor(() => expect(JSON.parse(mockCache.get('coach_lookup_recent:coach-1') ?? '[]')).toEqual(['m0', 'moved-away', 'm9']));
  });
  it('the side index appears once Everyone is near the top and scrolls to a letter', async () => {
    await mount(MANY);
    await fireEvent(screen.getByTestId('lookup-everyone'), 'layout', { nativeEvent: { layout: { y: 600, height: 20 } } });
    await fireEvent(screen.getByTestId('lookup-letter-B'), 'layout', { nativeEvent: { layout: { y: 140, height: 120 } } });
    expect(screen.queryByTestId('lookup-index')).toBeNull(); // not over the header, search or chips
    await fireEvent.scroll(screen.getByTestId('lookup-scroll'), { nativeEvent: { contentOffset: { y: 600 } } });
    const scrollTo = (ScrollView.prototype as unknown as { scrollTo: jest.Mock }).scrollTo;
    await fireEvent.press(screen.getByTestId('lookup-index-B'));
    expect(scrollTo).toHaveBeenCalled();
  });
});
