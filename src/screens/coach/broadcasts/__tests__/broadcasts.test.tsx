/**
 * M-BCAST-123 coach broadcasts: the API client (server gate, payload,
 * Idempotency-Key), the composer story (send "Gym closed Monday" to all
 * clients now; a weekly Sunday check-in), the list sections with cancel, and
 * the Messages entry hidden while the server flag is off.
 */
import React from 'react';
import { Alert } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));
jest.mock('@react-native-community/datetimepicker', () => ({ __esModule: true, default: () => null }));
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const R = jest.requireActual('react');
      R.useEffect(() => cb(), [cb]);
    },
  };
});

import { broadcastsAvailable, type Broadcast } from '../../../../api/broadcastsApi';
import BroadcastComposerScreen, { composerProblem } from '../BroadcastComposerScreen';
import CoachBroadcastsScreen from '../CoachBroadcastsScreen';
import { BroadcastsEntry } from '../BroadcastsEntry';
import { describeRepeat, recurrenceFor, sectionOf, segmentFor } from '../broadcastFormat';

const http = { get: mockGet, post: mockPost };
const off = { isAxiosError: true, response: { status: 503, data: { code: 'broadcasts.disabled', message: 'Broadcasts are not available on your account yet.' } } };

const OPTIONS = {
  roster_size: 3,
  packages: [{ id: 'aaaaaaaa-1111', name: 'Monthly coaching', billing_type: 'recurring' }],
  programs: [],
  tags: [{ tag: 'travel', client_count: 1 }],
  risk_buckets: ['red', 'amber', 'green', 'unknown'],
};

function bc(over: Partial<Broadcast> & { id: string }): Broadcast {
  return {
    status: 'scheduled',
    body: 'Hello',
    segment: { match: 'all', rules: [] },
    timezone: 'America/New_York',
    send_at: null,
    recurrence: null,
    next_run_at: '2026-10-11T13:00:00.000Z',
    occurrences_sent: 0,
    last_run_at: null,
    failure_code: null,
    created_at: '2026-10-05T10:00:00.000Z',
    ...over,
  };
}

const clients: QueryClient[] = [];
function renderQ(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** Press the confirm button of the last Alert.alert call. */
function confirmAlert(label: string) {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const call = calls[calls.length - 1];
  const buttons = call?.[2] as Array<{ text: string; onPress?: () => void }>;
  buttons.find((b) => b.text === label)?.onPress?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  http.get.mockImplementation(async (url: string) => {
    if (url === '/coach/broadcasts/segment-options') return { data: OPTIONS };
    return { data: { items: [], next_cursor: null } };
  });
  http.post.mockImplementation(async (url: string, payload: Record<string, unknown>) => {
    if (url === '/coach/broadcasts/preview') return { data: { recipient_count: 3, excluded_blocked_count: 0, roster_size: 3, sample: [] } };
    return { data: { ...bc({ id: 'b-new' }), body: payload.body } };
  });
});
afterEach(async () => {
  await cleanup();
  for (const qc of clients.splice(0)) qc.clear();
});

describe('broadcastsApi', () => {
  it('reports broadcasts off on 503 broadcasts.disabled and on a bare 404, on otherwise', async () => {
    http.get.mockRejectedValueOnce(off);
    await expect(broadcastsAvailable()).resolves.toBe(false);
    http.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { message: 'Cannot GET /coach/broadcasts' } } });
    await expect(broadcastsAvailable()).resolves.toBe(false);
    await expect(broadcastsAvailable()).resolves.toBe(true);
    http.get.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: {} } });
    await expect(broadcastsAvailable()).rejects.toBeTruthy();
  });
});

describe('broadcastFormat', () => {
  it('builds the segment and the weekly Sunday rule the backend expects', () => {
    expect(segmentFor({ kind: 'all', values: [] })).toEqual({ match: 'all', rules: [] });
    expect(segmentFor({ kind: 'tag', values: ['travel'] })).toEqual({ match: 'all', rules: [{ field: 'tag', op: 'in', values: ['travel'] }] });
    const weekly = recurrenceFor({ kind: 'weekly', localTime: '09:00', weekdays: [0], monthDay: 1 });
    expect(weekly).toEqual({ freq: 'weekly', interval: 1, local_time: '09:00', by_weekday: [0] });
    expect(describeRepeat({ freq: 'weekly', interval: 1, local_time: '09:00', by_weekday: [0] })).toMatch(/^Every Sunday at 9:00\sAM$/);
    expect(recurrenceFor({ kind: 'none', localTime: '09:00', weekdays: [], monthDay: 1 })).toBeNull();
  });

  it('names the first problem with the form', () => {
    const now = new Date('2026-10-05T12:00:00.000Z');
    const base = { body: 'Hi', audience: { kind: 'all' as const, values: [] }, later: false, sendAt: null, repeat: { kind: 'none' as const, localTime: '09:00', weekdays: [], monthDay: 1 }, now };
    expect(composerProblem({ ...base, body: '  ' })).toBe('Write the message first.');
    expect(composerProblem({ ...base, audience: { kind: 'tag', values: [] } })).toBe('Pick at least one tag for the audience.');
    expect(composerProblem({ ...base, later: true, sendAt: new Date('2026-10-05T11:00:00.000Z') })).toBe('Pick a time later than now, or choose Send now.');
    expect(composerProblem({ ...base, repeat: { ...base.repeat, kind: 'weekly' } })).toBe('Pick at least one day of the week.');
    expect(composerProblem(base)).toBeNull();
  });
});

describe('BroadcastComposerScreen', () => {
  it('sends "Gym closed Monday" to all clients now with an Idempotency-Key', async () => {
    const r = await renderQ(<BroadcastComposerScreen />);
    await waitFor(() => expect(r.getByTestId('composer-count').props.children).toBe('Goes to 3 of 3 clients.'));
    await fireEvent.changeText(r.getByTestId('composer-body'), 'Gym closed Monday, do the home plan');
    await fireEvent.press(r.getByTestId('composer-send'));
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('Send to 3 clients now?');
    confirmAlert('Send');
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    const create = http.post.mock.calls.find((c) => c[0] === '/coach/broadcasts');
    expect(create?.[1]).toEqual(expect.objectContaining({
      body: 'Gym closed Monday, do the home plan',
      segment: { match: 'all', rules: [] },
      send_at: null,
      recurrence: null,
      status: 'scheduled',
      timezone: expect.any(String),
    }));
    expect(create?.[2].headers['Idempotency-Key']).toMatch(/^bc-/);
  });

  it('schedules a weekly Sunday check-in for clients with a tag', async () => {
    const r = await renderQ(<BroadcastComposerScreen />);
    await waitFor(() => expect(r.getByTestId('composer-audience-tag')).toBeTruthy());
    await fireEvent.changeText(r.getByTestId('composer-body'), 'Sunday check-in: how did the week go, {first_name}?');
    await fireEvent.press(r.getByTestId('composer-audience-tag'));
    await fireEvent.press(r.getByTestId('composer-value-travel'));
    await fireEvent.press(r.getByTestId('composer-repeat-weekly'));
    const today = new Date().getDay();
    if (today !== 0) {
      await fireEvent.press(r.getByTestId(`composer-weekday-${today}`));
      await fireEvent.press(r.getByTestId('composer-weekday-0'));
    }
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/coach/broadcasts/preview', { segment: { match: 'all', rules: [{ field: 'tag', op: 'in', values: ['travel'] }] } }));
    await fireEvent.press(r.getByTestId('composer-send'));
    confirmAlert('Start');
    await waitFor(() => expect(mockGoBack).toHaveBeenCalled());
    const create = http.post.mock.calls.find((c) => c[0] === '/coach/broadcasts');
    expect(create?.[1].recurrence).toEqual({ freq: 'weekly', interval: 1, local_time: '09:00', by_weekday: [0] });
    expect(create?.[1].segment).toEqual({ match: 'all', rules: [{ field: 'tag', op: 'in', values: ['travel'] }] });
  });

  it('shows the server refusal sentence and stays open', async () => {
    http.post.mockImplementation(async (url: string) => {
      if (url === '/coach/broadcasts/preview') return { data: { recipient_count: 3, excluded_blocked_count: 0, roster_size: 3 } };
      throw { isAxiosError: true, response: { status: 422, data: { code: 'broadcast.active_limit', message: 'You have reached 50 scheduled broadcasts. Cancel or finish one before scheduling another.' } } };
    });
    const r = await renderQ(<BroadcastComposerScreen />);
    await waitFor(() => expect(r.getByTestId('composer-count').props.children).toBe('Goes to 3 of 3 clients.'));
    await fireEvent.changeText(r.getByTestId('composer-body'), 'Hello');
    await fireEvent.press(r.getByTestId('composer-send'));
    confirmAlert('Send');
    await waitFor(() => expect(r.getByTestId('composer-error').props.children).toBe('You have reached 50 scheduled broadcasts. Cancel or finish one before scheduling another.'));
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('says broadcasts are not available when the server flag is off', async () => {
    http.get.mockRejectedValue(off);
    const r = await renderQ(<BroadcastComposerScreen />);
    await waitFor(() => expect(r.getByTestId('composer-off')).toBeTruthy());
  });
});

describe('CoachBroadcastsScreen', () => {
  const items = [
    bc({ id: 'one-off', body: 'Gym closed Monday' }),
    bc({ id: 'weekly', body: 'Sunday check-in', recurrence: { freq: 'weekly', interval: 1, local_time: '09:00', by_weekday: [0], anchor_date: '2026-10-05' } }),
    bc({ id: 'done', status: 'sent', body: 'Welcome', last_run_at: '2026-10-01T10:00:00.000Z', stats: { total: 3, delivered: 3, pending: 0, deferred: 0, skipped_blocked: 0, skipped_ineligible: 0, failed: 0, read: 2 } }),
  ];

  it('groups scheduled, recurring and sent, and cancels a scheduled one after confirming', async () => {
    expect(items.map(sectionOf)).toEqual(['scheduled', 'recurring', 'sent']);
    http.get.mockResolvedValue({ data: { items, next_cursor: null } });
    http.post.mockResolvedValue({ data: { ...items[0], status: 'canceled' } });
    const r = await renderQ(<CoachBroadcastsScreen />);
    await waitFor(() => expect(r.getByTestId('broadcast-row-one-off')).toBeTruthy());
    expect(r.queryByTestId('broadcast-row-weekly')).toBeNull();
    await fireEvent.press(r.getByTestId('broadcasts-tab-recurring'));
    expect(r.getByTestId('broadcast-timing-weekly').props.children).toMatch(/^Every Sunday at 9:00\sAM\. Next: /);
    await fireEvent.press(r.getByTestId('broadcasts-tab-sent'));
    expect(r.getByText('3 delivered, 2 read')).toBeTruthy();
    await fireEvent.press(r.getByTestId('broadcasts-tab-scheduled'));
    await fireEvent.press(r.getByTestId('broadcast-cancel-one-off'));
    expect(http.post).not.toHaveBeenCalled();
    confirmAlert('Cancel broadcast');
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/coach/broadcasts/one-off/cancel'));
  });

  it('opens the composer from New broadcast', async () => {
    const r = await renderQ(<CoachBroadcastsScreen />);
    await waitFor(() => expect(r.getByTestId('broadcasts-empty')).toBeTruthy());
    await fireEvent.press(r.getByTestId('broadcasts-new'));
    expect(mockNavigate).toHaveBeenCalledWith('CoachBroadcastComposer');
  });
});

describe('BroadcastsEntry', () => {
  it('is hidden while the server flag is off', async () => {
    http.get.mockRejectedValue(off);
    const r = await renderQ(<BroadcastsEntry />);
    await waitFor(() => expect(http.get).toHaveBeenCalledWith('/coach/broadcasts', { params: { limit: 1 } }));
    expect(r.queryByTestId('messages-broadcasts-entry')).toBeNull();
  });

  it('opens the broadcasts list when the server offers them', async () => {
    const r = await renderQ(<BroadcastsEntry />);
    await waitFor(() => expect(r.getByTestId('messages-broadcasts-entry')).toBeTruthy());
    await fireEvent.press(r.getByTestId('messages-broadcasts-entry'));
    expect(mockNavigate).toHaveBeenCalledWith('ClientsStack', { screen: 'CoachBroadcasts', initial: false });
  });
});
