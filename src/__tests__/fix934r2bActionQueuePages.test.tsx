/** FIX-934R2B: the Home/list destination shares every-page, retry and dismissal behavior. */
import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ActionQueueScreen from '../screens/coach/command-center/ActionQueueScreen';
import type { ActionQueueItem } from '../services/commandCenterApi';

const mockQueue = jest.fn();
const mockDismiss = jest.fn();
let mockLoaded: ActionQueueItem[] = [];
let mockRefresh: () => void;
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const R = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent, refreshControl }: any) => {
      mockLoaded = data;
      mockRefresh = refreshControl.props.onRefresh;
      return R.createElement(R.Fragment, null, ListHeaderComponent,
        data.length ? data.map((item: ActionQueueItem, index: number) =>
          R.createElement(R.Fragment, { key: item.alert_id }, renderItem({ item, index }))) : ListEmptyComponent);
    },
  };
});
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  commandCenterApi: {
    getActionQueue: (...args: unknown[]) => mockQueue(...args),
    dismissAlert: (...args: unknown[]) => mockDismiss(...args),
  },
}));
jest.mock('../components/command-center/AlertRow', () => ({
  __esModule: true,
  default: ({ clientName, onPress, onDismiss }: any) => {
    const R = jest.requireActual('react');
    const { View, Pressable, Text } = jest.requireActual('react-native');
    return R.createElement(View, null,
      R.createElement(Pressable, { testID: `open-${clientName}`, onPress },
        R.createElement(Text, null, clientName)),
      R.createElement(Pressable, { testID: `dismiss-${clientName}`, onPress: onDismiss }));
  },
}));
jest.mock('../components/command-center/MockDataBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/roman/adjust/RomanAdjustmentsSection', () => ({ __esModule: true, default: () => null }));

const rows = (type = 'missed_checkins'): ActionQueueItem[] => Array.from({ length: 101 }, (_, n) => ({
  alert_id: `a${n}`, alert_type: n === 100 ? type : 'missed_checkins',
  client_id: `c${n}`, client_name: `Client${n}`, message: 'An alert is waiting.',
  dismissed_at: null, created_at: new Date(Date.UTC(2026, 10, 5, 12) - n * 60000).toISOString(),
}));
const paged = (all: ActionQueueItem[]) => async (params?: { limit?: number; before?: string }) => ({
  data: {
    items: all.filter(item => !params?.before || item.created_at < params.before).slice(0, params?.limit ?? 50),
    total_pending: all.length,
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQueue.mockReset();
  mockDismiss.mockReset();
  mockLoaded = [];
});

it.each(['missed_checkins', 'roman_urgent_reply'])('loads the older %s row and preserves its existing destination', async type => {
  const all = rows(type);
  mockQueue.mockImplementation(paged(all));
  const onSelectClient = jest.fn();
  const onOpenSafetyAlert = jest.fn();
  const v = await render(<ActionQueueScreen onSelectClient={onSelectClient} onOpenSafetyAlert={onOpenSafetyAlert} />);
  await waitFor(() => expect(mockLoaded).toHaveLength(101));
  expect(mockQueue.mock.calls).toEqual([[{ limit: 100 }], [{ limit: 100, before: all[99].created_at }]]);
  expect(v.getByText('101 actions waiting')).toBeTruthy();
  await fireEvent.press(v.getByTestId('open-Client100'));
  if (type === 'missed_checkins') {
    expect(onSelectClient).toHaveBeenCalledWith('c100', 'Client100');
    expect(onOpenSafetyAlert).not.toHaveBeenCalled();
  } else {
    expect(onOpenSafetyAlert).toHaveBeenCalledWith(all[100]);
    expect(onSelectClient).not.toHaveBeenCalled();
  }
});

it.each([0, 1])('a failed page %i never publishes a partial initial queue and retry rereads all pages', async failedPage => {
  const all = rows();
  const answer = paged(all);
  mockQueue.mockImplementation(async params => {
    if (Boolean(params?.before) === Boolean(failedPage)) throw new Error('offline');
    return answer(params);
  });
  const v = await render(<ActionQueueScreen />);
  await waitFor(() => expect(v.getByTestId('command-center-action-queue-error')).toBeTruthy());
  expect(mockLoaded).toHaveLength(0);
  mockQueue.mockImplementation(answer);
  await fireEvent.press(v.getByText('Try again'));
  await waitFor(() => expect(mockLoaded).toHaveLength(101));
  expect(v.getByText('101 actions waiting')).toBeTruthy();
});

it.each(['success', 'failure'])('dismissal of a later-page row preserves %s behavior', async result => {
  const all = rows();
  mockQueue.mockImplementation(paged(all));
  const notice = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  if (result === 'success') mockDismiss.mockResolvedValue({ data: { ok: true } });
  else mockDismiss.mockRejectedValue(new Error('offline'));
  const v = await render(<ActionQueueScreen />);
  await waitFor(() => expect(mockLoaded).toHaveLength(101));
  await fireEvent.press(v.getByTestId('dismiss-Client100'));
  await waitFor(() => expect(mockDismiss).toHaveBeenCalledWith('a100'));
  if (result === 'success') {
    await waitFor(() => expect(mockLoaded).toHaveLength(100));
    expect(mockLoaded.map(item => item.alert_id)).not.toContain('a100');
    expect(v.getByText('100 actions waiting')).toBeTruthy();
  } else {
    await waitFor(() => expect(mockQueue).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(mockLoaded).toHaveLength(101));
    expect(notice).toHaveBeenCalled();
  }
  notice.mockRestore();
});

it.each(['success', 'failure'])('pull refresh rereads every page on %s and retains last good rows on failure', async result => {
  const all = rows();
  const answer = paged(all);
  mockQueue.mockImplementation(answer);
  const v = await render(<ActionQueueScreen />);
  await waitFor(() => expect(mockLoaded).toHaveLength(101));
  if (result === 'failure') mockQueue.mockImplementation(async params => {
    if (params?.before) throw new Error('offline');
    return answer(params);
  });
  await act(async () => mockRefresh());
  await waitFor(() => expect(mockQueue).toHaveBeenCalledTimes(4));
  expect(mockLoaded).toHaveLength(101);
  expect(v.getByText('101 actions waiting')).toBeTruthy();
});

it('keeps the verified empty state and excludes dismissed rows from list and waiting count', async () => {
  mockQueue.mockResolvedValue({ data: { items: [{ ...rows()[0], dismissed_at: '2026-11-05T15:00:00Z' }], total_pending: 1 } });
  const v = await render(<ActionQueueScreen />);
  await waitFor(() => expect(v.getByText('No pending actions')).toBeTruthy());
  expect(mockLoaded).toHaveLength(0);
  expect(v.queryByText('1 action waiting')).toBeNull();
});
