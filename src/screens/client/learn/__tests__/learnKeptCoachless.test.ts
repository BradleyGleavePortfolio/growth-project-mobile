// LEARN-KEPT (#LEARN-COACHLESS op 1): lessons a client completed stay readable after the coach deleted their account.
// With a user id and no coach, useLearn still reads GET /lessons, and Learn has content only when a lesson is kept.
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api, { coachApi, lessonsApi } from '../../../../services/api';
import { useLearn } from '../learnData';

let mockUser: { id: string; coach_id?: string | null } | null = { id: 'me', coach_id: null };
jest.mock('../../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => mockUser }));
jest.mock('../../../../lib/userCache', () => ({ readUserCacheSync: () => null }));
jest.mock('../../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  coachApi: { getMyGuidelines: jest.fn() },
  lessonsApi: { getAll: jest.fn() },
}));

const getAll = jest.mocked(lessonsApi.getAll);
const kept = { id: 'l1', title: 'Protein, simply', description: 'Short read.', completions: [{ id: 'x1' }] };

function run() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useLearn(), { wrapper });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'me', coach_id: null };
});

describe('Learn for a client with no coach (kept lessons)', () => {
  it('still reads GET /lessons, returns the kept lesson and has content; coach and guidelines stay unread', async () => {
    getAll.mockResolvedValue({ data: [kept] } as never);
    const { result } = await run();
    await waitFor(() => expect(result.current.lessons).toHaveLength(1));
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(result.current.lessons[0]).toMatchObject({ id: 'l1', title: 'Protein, simply', done: true });
    expect(result.current.hasContent).toBe(true);
    expect(result.current.known).toBe(true);
    expect(coachApi.getMyGuidelines).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('has no content when nothing is kept', async () => {
    getAll.mockResolvedValue({ data: [] } as never);
    const { result } = await run();
    await waitFor(() => expect(result.current.known).toBe(true));
    expect(getAll).toHaveBeenCalledTimes(1);
    expect(result.current.lessons).toEqual([]);
    expect(result.current.hasContent).toBe(false);
    expect(coachApi.getMyGuidelines).not.toHaveBeenCalled();
  });

  it('asks for nothing before the client is known', async () => {
    mockUser = null;
    const { result } = await run();
    await result.current.refetch();
    expect(getAll).not.toHaveBeenCalled();
    expect(result.current.hasContent).toBe(false);
  });

  it('refetch asks for lessons again and still skips the coach reads', async () => {
    getAll.mockResolvedValue({ data: [] } as never);
    const { result } = await run();
    await waitFor(() => expect(result.current.known).toBe(true));
    getAll.mockResolvedValue({ data: [kept] } as never);
    await result.current.refetch();
    await waitFor(() => expect(result.current.hasContent).toBe(true));
    expect(getAll).toHaveBeenCalledTimes(2);
    expect(coachApi.getMyGuidelines).not.toHaveBeenCalled();
  });
});
