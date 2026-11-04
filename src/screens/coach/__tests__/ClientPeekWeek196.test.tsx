/**
 * CLIENT-FILE-DAYS-M (K1 Style C, C_peek): the peek sheet reads the same week as the client file
 * (GET /coach/clients/:id/week through thisWeek.ts), draws the file's week ring with "{n} of {m} done"
 * (K1-S-38) and puts "Missed {day}" (K1-S-39) on the Workouts row.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';

const mockSummary = jest.fn();
const mockCheckIns = jest.fn();
const mockWeek = jest.fn();
jest.mock('../../../services/api', () => ({
  coachApi: {
    getClientSummary: (...a: unknown[]) => mockSummary(...a),
    getClientCheckIns: (...a: unknown[]) => mockCheckIns(...a),
    getClientWeek: (...a: unknown[]) => mockWeek(...a),
  },
}));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }) }));
jest.mock('../../../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ flags: {} }) }));
jest.mock('../../../hooks/useMacros', () => ({ useCurrentMacrosForClient: () => ({ isSuccess: false, data: null }) }));
jest.mock('../../../theme/ThemeProvider', () => {
  const flat = new Proxy({}, { get: () => '#000000' });
  const anyColor = new Proxy({}, { get: (_t, k) => (k === 'surface' || k === 'data' ? flat : '#000000') });
  return { useTheme: () => ({ colors: anyColor, semanticColors: anyColor }) };
});
const mockText = (t: string) => React.createElement(jest.requireActual('react-native').Text, null, t);
jest.mock('@expo/vector-icons', () => ({ Ionicons: (p: { name: string }) => mockText(`icon:${p.name}`) }));
jest.mock('../../../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../../../ui', () => ({ Overline: jest.requireActual('react-native').Text, useScreenInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../../ui/states/QuietStates', () => ({
  QuietLoading: () => mockText('Loading'),
  QuietError: (p: { message: string }) => mockText(p.message),
}));

import ClientPeekSheet from '../lookup/ClientPeekSheet';
import type { RosterClient } from '../../../utils/coach/clientRoster';

const client = (id = 'c1') => ({
  id, firstName: 'Jordan', lastName: 'Reyes', email: `${id}@example.com`, status: 'active', createdAt: '2026-08-14T10:00:00.000Z',
  activity: { lastActiveOn: null, checkInsToReview: 0 },
}) as unknown as RosterClient;
const at = (day: string, done = false) => ({ id: `a-${day}`, day, scheduled_for: `${day}T12:00:00.000Z`, completed_at: done ? `${day}T18:00:00.000Z` : null, skipped_at: null });
const week = (week_start: string, today: string, assignments: ReturnType<typeof at>[], shared = true) => ({ data: { week_start, today, shared, assignments } });
const summary = (recent_assignments: unknown[] = []) => ({
  data: { client_name: 'Jordan Reyes', profile: null, today: { entries: [] }, recent_workouts: [], recent_assignments, weight_logs: [] },
});

async function mount(c = client()) {
  await render(<ClientPeekSheet client={c} onClose={jest.fn()} onOpen={jest.fn()} onNudge={jest.fn()} />);
  await waitFor(() => expect(screen.queryByText('Loading')).toBeNull());
}
const ringLabel = () => screen.getByTestId('peek-week-ring').props.accessibilityLabel;
const workoutsRow = () => screen.getByTestId('peek-slice-workouts').props.accessibilityLabel;

beforeEach(() => {
  jest.clearAllMocks();
  mockSummary.mockResolvedValue(summary());
  mockCheckIns.mockResolvedValue({ data: [] });
});

describe("the peek's week (K1 Style C, C_peek)", () => {
  it('four sessions this week, one done: the ring and "1 of 4 done"', async () => {
    mockWeek.mockResolvedValue(week('2026-11-02', '2026-11-02', [at('2026-11-02', true), at('2026-11-04'), at('2026-11-06'), at('2026-11-08')]));
    await mount();
    expect(mockWeek).toHaveBeenCalledWith('c1');
    expect(ringLabel()).toBe('1 of 4 done'); // the ring's screen reader label is K1-S-38, as on the file
    expect(screen.getByText('1 of 4')).toBeTruthy();
    expect(screen.getByText('done')).toBeTruthy();
    expect(workoutsRow()).toBe('Workouts, 1 of 4 done');
  });

  it('a session missed on Tuesday reads "Missed Tue" on the Workouts row', async () => {
    mockWeek.mockResolvedValue(week('2026-11-02', '2026-11-04', [at('2026-11-02', true), at('2026-11-03'), at('2026-11-05'), at('2026-11-07')]));
    await mount();
    expect(screen.getByText('Missed Tue')).toBeTruthy();
    expect(workoutsRow()).toBe('Workouts, Missed Tue');
    expect(ringLabel()).toBe('1 of 4 done');
  });

  it.each([['nothing planned', true], ['the week not shared', false]])('%s: "Nothing planned this week" and no ring', async (_case, shared) => {
    mockWeek.mockResolvedValue(week('2026-11-02', '2026-11-04', [], shared as boolean));
    await mount();
    expect(screen.getByText('Nothing planned this week')).toBeTruthy();
    expect(screen.queryByTestId('peek-week-ring')).toBeNull();
    expect(screen.getByText('JR')).toBeTruthy(); // the initials stay where the ring would be
  });

  it("another coach's assignments are left out: the week is the server's, never the summary's rows", async () => {
    // The summary still lists an earlier coach's done session today and this coach's own rows; neither is counted.
    mockSummary.mockResolvedValue(summary([
      { scheduled_for: '2026-11-04T12:00:00.000Z', assigned_by_coach_id: 'earlier-coach', completed_at: '2026-11-04T18:00:00.000Z' },
      { scheduled_for: '2026-11-04T12:00:00.000Z', assigned_by_coach_id: 'coach-1', completed_at: null },
    ]));
    mockWeek.mockResolvedValue(week('2026-11-02', '2026-11-04', [at('2026-11-02', true), at('2026-11-05'), at('2026-11-06'), at('2026-11-07')]));
    await mount();
    expect(ringLabel()).toBe('1 of 4 done');
    expect(workoutsRow()).toBe('Workouts, 1 of 4 done');
  });

  it("another coach's client: the week is not theirs to read, so the peek shows the quiet error and no ring", async () => {
    mockWeek.mockRejectedValue(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }));
    await mount(client('c9'));
    expect(screen.getByText('Could not load this client. Please try again.')).toBeTruthy();
    expect(screen.queryByTestId('peek-week-ring')).toBeNull();
    expect(screen.queryByTestId('peek-slice-workouts')).toBeNull();
  });

  it("a week across a zone change is the client's week: Monday to Sunday by the client's own days", async () => {
    // The clocks went back on Sunday Nov 1 where the client lives; the server sends that week in the client's zone.
    mockWeek.mockResolvedValue(week('2026-10-26', '2026-11-01', [at('2026-10-26', true), at('2026-10-28'), at('2026-11-01')]));
    await mount();
    expect(ringLabel()).toBe('1 of 3 done');
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(workoutsRow()).toBe('Workouts, Missed Wed');
  });
});
