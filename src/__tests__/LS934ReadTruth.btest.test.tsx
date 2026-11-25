/** Independent reviewer regression probes, not product changes. */
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCoachHomeV11 } from '../screens/coach/home-v11/useCoachHomeV11';
import type { CoachHomeSources } from '../screens/coach/command-center/coachHomeSources';

const mockDrafts = { data: { drafts: [] }, isError: false, isFetching: false, refetch: jest.fn(async () => undefined) };
jest.mock('../hooks/usePendingAiDrafts', () => ({ usePendingAiDrafts: () => mockDrafts }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'review-coach' }) }));
jest.mock('../hooks/useClientUnreadCount', () => ({ useClientUnreadCount: () => 0 }));
jest.mock('../screens/coach/home-v11/blockList', () => ({
  needsYouReason: jest.fn(),
  useCoachBlockList: () => ({ blockedIds: [], known: true, loading: false, error: null, refresh: jest.fn() }),
}));
const mockStore = { clients: [], filterStatus: 'active', loadError: null, loadClients: jest.fn(async () => undefined) };
jest.mock('../store/coachStore', () => {
  const useCoachStore = (select: (s: typeof mockStore) => unknown) => select(mockStore);
  useCoachStore.getState = () => mockStore;
  return { useCoachStore };
});
jest.mock('../config/featureFlags', () => ({
  featureFlags: { archivedCoachReadSurfaces: true, clientPathCopilot: true, useRealApi: true },
}));
jest.mock('../services/commandCenterApi', () => ({
  ...jest.requireActual('../services/commandCenterApi'), commandCenterApi: {},
}));
jest.mock('../services/api', () => ({
  __esModule: true, default: { get: jest.fn() },
  coachApi: { getUnreadCounts: async () => ({ data: { by_client: {} } }) },
}));
jest.mock('../api/copilotApi', () => ({ copilotApi: { pathChangeDrafts: jest.fn() } }));

function sources(overrides: Partial<CoachHomeSources> = {}): CoachHomeSources {
  return {
    atRisk: async () => [], ltv: async () => null as never,
    monthSoFar: async () => ({ totals: { netCents: 0, chargeCount: 0 }, currency: 'usd', changeCents: null }) as never,
    nextPayout: async () => null,
    actionQueue: async () => [], pathChangeDrafts: async () => [],
    ...overrides,
  };
}
const overview = async () => ({ overview: { roster_count: 1 }, home: null, source: 'legacy' }) as never;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;
}
const flush = async () => { await act(async () => { for (let i = 0; i < 14; i += 1) await Promise.resolve(); }); };

describe('LS-934 path draft read truth', () => {
  it('does not report verified zero drafts while path changes are still loading', async () => {
    const api = sources({ pathChangeDrafts: () => new Promise(() => undefined) });
    const h = await renderHook(() => useCoachHomeV11(api, overview, true), { wrapper });
    await flush();
    expect(h.result.current.data.draftsState).toBe('loading');
  });
  it('exposes a failed path read rather than reporting verified zero drafts', async () => {
    const api = sources({ pathChangeDrafts: async () => { throw new Error('offline'); } });
    const h = await renderHook(() => useCoachHomeV11(api, overview, true), { wrapper });
    await flush();
    expect(h.result.current.data.draftsState).toBe('error');
  });
  it('retries path changes with the visible drafts retry action', async () => {
    const path = jest.fn(async () => { throw new Error('offline'); });
    const api = sources({ pathChangeDrafts: path });
    const h = await renderHook(() => useCoachHomeV11(api, overview, true), { wrapper });
    await flush();
    await act(async () => { await h.result.current.retryDrafts(); });
    expect(path).toHaveBeenCalledTimes(2);
  });
});

describe('LS-934 queue re-read truth', () => {
  it('retains known alerts but reports a failed refresh', async () => {
    const alert = { alert_id: 'safe', alert_type: 'roman_crisis_reply' as const, client_id: 'a', client_name: 'Avery', message: 'Safety', dismissed_at: null, created_at: '2026-11-05T10:00:00Z' };
    const read = jest.fn().mockResolvedValueOnce([alert]).mockRejectedValue(new Error('offline'));
    const api = sources({ actionQueue: read });
    const h = await renderHook(() => useCoachHomeV11(api, overview, true), { wrapper });
    await flush();
    expect(h.result.current.data.areas.safety).toHaveLength(1);
    await act(async () => { await h.result.current.reload(); });
    await flush();
    expect(h.result.current.data.areas.safety).toHaveLength(1);
    expect(h.result.current.data.alertsState).toBe('error');
  });
});
