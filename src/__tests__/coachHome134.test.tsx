// COACH-HOME-134 (agent 134): the coach Home to coach-home-solo. Hero, retention and payout only when real; most urgent client
// first with a monogram (no photo upload exists); calm with no clients; Screen insets at 360x800 and 390x844; token radii.
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { layout } from '../theme/tokens';
import type { MoneySummary } from '../api/coachMoneyApi';
import type { CoachHomeSources } from '../screens/coach/command-center/coachHomeSources';
import { commandCenterApi } from '../services/commandCenterApi';
import OverviewScreen from '../screens/coach/command-center/OverviewScreen';
import CommandCenterScreen from '../screens/coach/command-center/CommandCenterScreen';
import { clientsNarrative, heroAmount, paceLine, retentionPct } from '../screens/coach/command-center/coachHomeCopy';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  __USING_MOCK_DATA: false,
  commandCenterApi: { getOverview: jest.fn(), getLtvMetrics: () => new Promise(() => {}) },
}));
jest.mock('../components/command-center/CoachLtvDashboard', () => () => null);
jest.mock('../screens/coach/command-center/CoachHomeCards', () => () => null);
jest.mock('../screens/coach/command-center/coachHomeSources', () => ({
  coachHomeSources: { monthSoFar: () => new Promise(() => {}), nextPayout: async () => null, ltv: async () => null, atRisk: async () => [] },
}));

const overview = (over: Record<string, number> = {}) => ({
  data: { roster_size: 12, active_today: 8, check_in_rate_7day: 0.6, open_alerts: 2, at_risk_count: 3, win_streak_count: 5, unread_messages: 1, pending_actions: 0, ...over },
});
const summary = (netCents: number, chargeCount: number, changeCents: number | null) =>
  ({ currency: 'usd', currencies: ['usd'], totals: { netCents, chargeCount }, changeCents } as unknown as MoneySummary);
const entry = (id: string, name: string) => ({ user_id: id, display_name: name, bucket: 'red' as const, risk_score: null, last_active_at: null, top_factor: 'Missed 2 workouts this week', days_since_checkin: 3 });
type Ltv = Awaited<ReturnType<CoachHomeSources['ltv']>>;
const ltv = (churn: number, ago: number, active = 12) => ({ active_client_count: active, churn_rate_pct: churn, mrr_30d_ago_cents: ago } as unknown as Ltv);
const sources = (over: Partial<CoachHomeSources> = {}): CoachHomeSources => ({
  monthSoFar: async () => summary(1428000, 31, 62000), nextPayout: async () => null, ltv: async () => ltv(0, 0, 0), atRisk: async () => [], ...over,
});
beforeEach(() => (commandCenterApi.getOverview as jest.Mock).mockResolvedValue(overview()));

it('copy: clients in a sentence, a whole-unit hero, pace from day 7, retention only from real churn', () => {
  expect([clientsNarrative(12, 3), clientsNarrative(12, 1), clientsNarrative(2, 0), clientsNarrative(1, 1), clientsNarrative(47, 0)]).toEqual(
    ['Three need you; nine are steady.', 'One needs you; eleven are steady.', 'Both are steady.', 'One needs you today.', 'All 47 are steady.'],
  );
  expect([heroAmount(1428040, 'usd'), heroAmount(4250, 'usd')]).toEqual(['$14,280', '$42.50']);
  expect([paceLine(1428000, 'usd', new Date(2026, 5, 10)), paceLine(1428000, 'usd', new Date(2026, 5, 3))]).toEqual(['10 days in, on pace for $42,840', '3 days in']);
  expect([retentionPct(null), retentionPct(ltv(0, 0)), retentionPct(ltv(0, 50000, 0)), retentionPct(ltv(6.2, 50000))]).toEqual([null, null, null, '94%']);
});

describe('the hero: a real month-so-far figure, or one calm line', () => {
  it('shows the serif hero, the change and the pace when the month has sales', async () => {
    const screen = await render(<OverviewScreen sources={sources()} />);
    const hero = await screen.findByTestId('coach-home-hero-amount');
    expect(screen.getByText('$14,280')).toBe(hero);
    expect(StyleSheet.flatten(hero.props.style).fontFamily).toBe('CormorantGaramond_400Regular');
    expect(screen.getByText(/^Up \$620 on this point in /)).toBeTruthy();
    expect(screen.getByText(/^\d+ days? in/)).toBeTruthy();
  });
  it('says "No earnings yet this month." with no number when nothing sold; a sub-coach reads who takes payments', async () => {
    const empty = await render(<OverviewScreen sources={sources({ monthSoFar: async () => summary(0, 0, null) })} />);
    expect(await empty.findByText('No earnings yet this month.')).toBeTruthy();
    expect(empty.queryByTestId('coach-home-hero-amount')).toBeNull();
    const blocked = { response: { status: 403, data: { code: 'sub_coach_billing_blocked' } } };
    const sub = await render(<OverviewScreen sources={sources({ monthSoFar: () => Promise.reject(blocked) })} />);
    expect(await sub.findByText("Payments run through your head coach's practice.")).toBeTruthy();
  });
});

describe("the stat row and today's clients", () => {
  it('adds retention and the next payout only when real; otherwise Clients and Check-ins, no invented figure', async () => {
    const plain = await render(<OverviewScreen sources={sources()} />);
    expect(within(await plain.findByTestId('coach-home-stats')).getByText('60%')).toBeTruthy();
    expect([plain.queryByTestId('coach-home-retention'), plain.queryByTestId('coach-home-next-payout')]).toEqual([null, null]);
    const payout = { id: 'po', amountCents: 384000, currency: 'usd', status: 'pending' as const, rawStatus: 'pending', arrivalDate: null, failureMessage: null };
    const screen = await render(<OverviewScreen sources={sources({ ltv: async () => ltv(6.2, 50000), nextPayout: async () => payout })} />);
    expect(await screen.findByText('94%')).toBeTruthy();
    expect(within(screen.getByTestId('coach-home-next-payout')).getByText('$3,840')).toBeTruthy();
    expect(within(screen.getByTestId('command-center-kpi-checkin-rate')).getByText('60%')).toBeTruthy();
  });
  it('puts the most urgent client first with a monogram, and opens the messages or the file', async () => {
    const onSelectClient = jest.fn();
    const onOpenThread = jest.fn();
    const items = [entry('c-1', 'Jessica Miller'), entry('c-2', 'Caleb Anderson'), entry('c-3', 'Avery Nguyen')];
    const screen = await render(<OverviewScreen sources={sources({ atRisk: async () => items })} onSelectClient={onSelectClient} onOpenThread={onOpenThread} />);
    expect(await screen.findByText('Three need you; nine are steady.')).toBeTruthy();
    const card = await screen.findByTestId('coach-home-urgent');
    const monogram = within(card).getByLabelText('Jessica Miller');
    expect([monogram.props.accessibilityRole, monogram.type]).toEqual(['image', 'View']); // a monogram, never a photo placeholder
    expect(within(card).getByText('JM')).toBeTruthy();
    await fireEvent.press(within(card).getByTestId('coach-home-urgent-message'));
    expect(onOpenThread).toHaveBeenCalledWith('c-1', 'Jessica Miller');
    await fireEvent.press(screen.getByTestId('coach-home-client-c-2'));
    expect(onSelectClient).toHaveBeenCalledWith('c-2', 'Caleb Anderson');
    expect(screen.getByTestId('coach-home-client-c-3')).toBeTruthy();
  });
  it('a new coach with no clients reads calm and complete', async () => {
    const zero = { roster_size: 0, active_today: 0, at_risk_count: 0, open_alerts: 0, unread_messages: 0, win_streak_count: 0, check_in_rate_7day: 0 };
    (commandCenterApi.getOverview as jest.Mock).mockResolvedValue(overview(zero));
    const onOpenClients = jest.fn();
    const screen = await render(<OverviewScreen sources={sources({ monthSoFar: async () => summary(0, 0, null) })} onOpenClients={onOpenClients} />);
    expect(await screen.findByText('No clients yet.')).toBeTruthy();
    expect(screen.getByText('No earnings yet this month.')).toBeTruthy();
    expect(screen.queryByTestId('coach-home-stats')).toBeNull();
    expect(screen.queryByTestId('command-center-kpi-at-risk')).toBeNull();
    expect(screen.queryByText(/^(0|0%|—)$/)).toBeNull();
    await fireEvent.press(screen.getByTestId('coach-home-go-clients'));
    expect(onOpenClients).toHaveBeenCalled();
  });
});

it.each([
  ['Android 360x800', { x: 0, y: 0, width: 360, height: 800 }, { top: 24, bottom: 16, left: 0, right: 0 }],
  ['iPhone 390x844', { x: 0, y: 0, width: 390, height: 844 }, { top: 47, bottom: 34, left: 0, right: 0 }],
])('on %s the coach Home sits insets.top + 12 under the status bar, tabs and hero in place', async (_n, frame, insets) => {
  const screen = await render(<SafeAreaProvider initialMetrics={{ frame, insets }}><CommandCenterScreen /></SafeAreaProvider>);
  expect(StyleSheet.flatten(screen.getByTestId('command-center-root').props.style).paddingTop).toBe(insets.top + layout.statusBarGap);
  expect(screen.getByTestId('command-center-tab-overview')).toBeTruthy();
  expect(await screen.findByTestId('coach-home-hero')).toBeTruthy();
});

it.each([
  'screens/coach/command-center/OverviewScreen.tsx', 'screens/coach/command-center/CommandCenterScreen.tsx', 'screens/coach/command-center/CoachHomeSections.tsx',
])('%s has no literal radius and no SafeAreaView from react-native (source)', (f) => {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  expect(src.match(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*\d+/g)).toBeNull();
  expect(src).not.toMatch(/SafeAreaView[^\n]*from 'react-native'/);
});
