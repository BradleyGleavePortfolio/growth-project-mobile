/** A failed alert read holds completeness, not independently verified client rows. */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NeedsYouList from '../screens/coach/lookup/NeedsYouList';
import type { NeedsAreas, NeedsClientRow } from '../utils/coach/needsYou';
import type { RosterClient } from '../utils/coach/clientRoster';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/HapticPressable', () => jest.requireActual('react-native').Pressable);
jest.mock('../ui', () => ({ useScreenInsets: () => ({ top: 0, bottom: 0 }) }));

const noop = () => undefined;
it.each(['quiet', 'fresh', 'routine'] as const)('alert failure retains the verified %s row without claiming a complete total', async (key) => {
  const client = {
    id: 'v1', firstName: 'Maya', lastName: 'Lee', status: 'active',
    createdAt: '2026-06-09T10:00:00Z', activity: { lastActiveOn: '2026-10-28', checkInsToReview: 0 },
  } as RosterClient;
  const row: NeedsClientRow = {
    client,
    reason: key === 'quiet' ? { text: 'Last logged 8 days ago', action: 'nudge', ok: false }
      : key === 'fresh' ? { text: 'New, no logs yet', action: 'hello', ok: false }
        : { text: '1 new message', action: 'reply', ok: false },
  };
  const areas: NeedsAreas = {
    safety: [], alerts: [], quiet: [], fresh: [], routine: [], attention: key === 'routine' ? 0 : 1,
    routineCount: key === 'routine' ? 1 : 0, total: 1, [key]: [row],
  };
  const open = jest.fn();
  const retry = jest.fn();
  const v = await render(<NeedsYouList areas={areas} rosterCount={1} loading={false} error={null} alertsFailed
    refreshing={false} now={new Date('2026-11-05T12:00:00Z')} onBack={noop} onRefresh={noop}
    onRetry={retry} onOpenSafety={noop} onOpenAlert={noop} onOpenClient={open} onAction={noop} />);
  expect(v.getByTestId('needs-title').props.children).toBe('Needs you');
  expect(v.queryByTestId('needs-search')).toBeNull();
  expect(v.queryByTestId('needs-switch-attention')).toBeNull();
  expect(v.getByTestId('needs-alerts-error')).toBeTruthy();
  expect(v.getByTestId('needs-act-v1')).toBeTruthy();
  const ids: string[] = [];
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(collect);
    else if (node && typeof node === 'object') {
      const element = node as { props?: { testID?: unknown }; children?: unknown[] };
      if (typeof element.props?.testID === 'string') ids.push(element.props.testID);
      element.children?.forEach(collect);
    }
  };
  collect(v.toJSON());
  expect(ids.indexOf('needs-alerts-error')).toBeLessThan(ids.indexOf('needs-act-v1'));
  await fireEvent.press(v.getByText('Maya Lee'));
  expect(open).toHaveBeenCalledWith(client);
  await fireEvent.press(v.getByText('Try again'));
  expect(retry).toHaveBeenCalled();
});
