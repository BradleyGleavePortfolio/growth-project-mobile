/**
 * FR-880: the notification bell count (useClientUnreadCount) reads again at once on a block or an unblock, not on
 * the next 30 s tick; off screen (enabled false) it reads nothing.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockFetch = jest.fn();
jest.mock('../../services/notificationsApi', () => ({ fetchUnreadCount: () => mockFetch() }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn() } }));

import { useClientUnreadCount } from '../useClientUnreadCount';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';

const ANA = { id: 'coach-1', displayName: 'Ana', blockedAt: '2026-10-24T00:00:00Z' };

beforeEach(() => {
  mockFetch.mockReset();
  useBlockedUsersStore.setState({ blocked: [] });
});

it('a block and an unblock read the count again at once', async () => {
  mockFetch.mockResolvedValue(4);
  const { result } = await renderHook(() => useClientUnreadCount());
  await waitFor(() => expect(result.current).toBe(4));
  expect(mockFetch).toHaveBeenCalledTimes(1);
  mockFetch.mockResolvedValue(1);
  await act(async () => useBlockedUsersStore.setState({ blocked: [ANA] }));
  await waitFor(() => expect(result.current).toBe(1));
  expect(mockFetch).toHaveBeenCalledTimes(2);
  mockFetch.mockResolvedValue(4);
  await act(async () => useBlockedUsersStore.setState({ blocked: [] }));
  await waitFor(() => expect(result.current).toBe(4));
  expect(mockFetch).toHaveBeenCalledTimes(3);
});

it('while paused (off screen) a block reads nothing', async () => {
  mockFetch.mockResolvedValue(2);
  await renderHook(() => useClientUnreadCount(false));
  await act(async () => useBlockedUsersStore.setState({ blocked: [ANA] }));
  expect(mockFetch).not.toHaveBeenCalled();
});
