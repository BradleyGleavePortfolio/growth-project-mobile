/**
 * LS-952R3: a normal 45-client queue can contain a workout and nudge per client.
 * Exercise the real API wrapper and shared hook against the production array
 * contract (default limit 50). No draft is blocked, moved, or otherwise hidden.
 */
import React from 'react';
import { Text } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGet = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockGet(...args) },
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
  useIsFocused: () => true,
}));
import { RomanDraftsHero } from '../inboxStyleB';
import { usePendingAiDrafts } from '../../../hooks/usePendingAiDrafts';
import { useBlockedUsersStore } from '../../../store/blockedUsersStore';
import { useClosedClientsStore } from '../../../store/closedClientsStore';
import { _setMockModeForTesting } from '../../../api/coachAiExecutionApi';

const rows = Array.from({ length: 45 }, (_, i) => [
  { id: `n-${i}`, subject_user_id: `client-${i}`, capability: 'draft.send_notification', status: 'pending', payload: {} },
  { id: `w-${i}`, subject_user_id: `client-${i}`, capability: 'draft.assign_workout', status: 'pending', payload: {} },
]).flat();

function QueueProbe() {
  const query = usePendingAiDrafts();
  return <Text testID="listed-drafts">{query.data?.drafts.map((d) => d.id).join(',') ?? ''}</Text>;
}

it('B1: all 90 ordinary drafts for 45 clients are counted and reachable, not only the newest 50', async () => {
  _setMockModeForTesting('off');
  useBlockedUsersStore.setState({ userId: 'coach-1', hydrated: true, blocked: [] });
  useClosedClientsStore.setState({ bySource: {} });
  mockGet.mockImplementation(async (_path, options) => {
    const params = options?.params ?? {};
    const limit = Number(params.limit ?? 50);
    // Support the existing server's paged queue too, so this test does not prescribe a fix.
    if (params.order === 'oldest') {
      const start = params.after ? rows.findIndex((r) => r.id === params.after) + 1 : 0;
      const items = rows.slice(start, start + limit);
      return { data: { items, total: rows.length, next_cursor: start + items.length < rows.length ? items.at(-1)?.id : null } };
    }
    return { data: rows.slice(0, Math.min(limit, 200)) };
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await render(
    <QueryClientProvider client={qc}><RomanDraftsHero /><QueueProbe /></QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    await waitFor(() => expect(view.getByTestId('listed-drafts').props.children).not.toBe(''));
    const actual = view.getByTestId('listed-drafts').props.children.split(',');
    // The control proves the live transport answered and the first page was consumed.
    expect(actual).toContain('n-0');
    expect(actual).toContain('w-24');
    expect(actual).toHaveLength(90);
    expect(view.getByText('Roman has 90 drafts ready')).toBeTruthy();
    expect(actual).toContain('w-44');
  } finally {
    await view.unmount();
    qc.clear();
    useBlockedUsersStore.setState({ userId: null, hydrated: false, blocked: [] });
  }
});
