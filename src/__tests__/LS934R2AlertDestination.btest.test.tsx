/** LS-934R2: per-alert Needs you taps must reach older ordinary alerts, not only a different first page. */
import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import ActionQueueScreen from '../screens/coach/command-center/ActionQueueScreen';

const mockQueue = jest.fn();
let mockLoaded: { alert_id: string }[] = [];
jest.mock('react-native/Libraries/Lists/FlatList', () => {
  const R = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ data, renderItem }: { data: { alert_id: string }[]; renderItem: (p: unknown) => React.ReactNode }) => {
      mockLoaded = data;
      return R.createElement(R.Fragment, null, data.map((item, index) =>
        R.createElement(R.Fragment, { key: item.alert_id }, renderItem({ item, index }))));
    },
  };
});
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'),
  commandCenterApi: { getActionQueue: (...a: unknown[]) => mockQueue(...a), dismissAlert: jest.fn() },
}));
jest.mock('../components/command-center/AlertRow', () => ({
  __esModule: true,
  default: ({ clientName }: { clientName: string }) => {
    const R = jest.requireActual('react');
    const { Text } = jest.requireActual('react-native');
    return R.createElement(Text, { testID: `row-${clientName}` }, clientName);
  },
}));
jest.mock('../components/command-center/MockDataBanner', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/roman/adjust/RomanAdjustmentsSection', () => ({ __esModule: true, default: () => null }));

const all = Array.from({ length: 51 }, (_, n) => ({
  alert_id: `a${n}`, alert_type: 'high_churn_risk', client_id: `c${n}`,
  client_name: `Client${n}`, message: 'An ordinary alert.', dismissed_at: null,
  created_at: new Date(Date.UTC(2026, 10, 5, 12, 0, 0) - n * 60000).toISOString(),
}));

it('B3: Actions, the new per-alert list destination, must include the selected older ordinary alert', async () => {
  mockQueue.mockImplementation(async (params?: { limit?: number; before?: string }) => ({
    data: {
      items: params?.before ? all.slice(50) : all.slice(0, params?.limit ?? 50),
      total_pending: all.length,
    },
  }));
  const v = await render(<ActionQueueScreen />);
  await waitFor(() => expect(v.queryByTestId('row-Client0')).toBeTruthy());
  // Check loaded data, not row mounting: virtualization must not produce a false failure.
  expect(mockLoaded.map((item) => item.alert_id)).toContain('a50');
});
