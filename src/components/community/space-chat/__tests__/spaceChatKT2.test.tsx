/**
 * SPLIT-938C (agent 200): the KT-2 proofs of the space chat data layer (planning/KNOWN_TRAPS.md KT-2: a blocked,
 * banned, removed or departed person). memberContentAccess.test.tsx registers useSpaceChat, spaceChatOutbox,
 * useSpaceVoiceOutbox and spaceChatApi with these titles. The real hook, outbox and isNoAccess run; only the space's
 * wire calls, the device cache, the connection and the sign-in binding are doubled.
 */
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('../../../../storage/mmkv', () => ({
  cacheStorage: {
    getStringAsync: jest.fn(async () => undefined),
    getAllKeys: jest.fn(async () => []),
    set: jest.fn(),
    delete: jest.fn(),
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: jest.fn(() => jest.fn()) },
}));
jest.mock('../../../../services/accountBinding', () => ({
  captureAccountBinding: jest.fn(async () => ({ subject: 'viewer', epoch: 1 })),
  bindingIsCurrent: jest.fn(() => true),
  isAccountChangedError: jest.fn(() => false),
  boundRequestSignal: jest.fn(() => ({ signal: undefined, done: () => undefined })),
}));
jest.mock('../../../../services/sessionFence', () => ({
  sessionGeneration: () => 1,
  sessionWritesSettled: async () => undefined,
}));
jest.mock('../../../../hooks/useCommunity', () => ({
  useCommunityMe: () => ({ dataUpdatedAt: 0 }),
  communityKeys: { cohorts: () => ['community', 'cohorts'], me: () => ['community', 'me'] },
}));
jest.mock('../../../../hooks/useCoachCommunity', () => ({ coachCommunityKeys: { cohorts: () => ['coach-community', 'cohorts'] } }));
jest.mock('../../../../api/communityVoiceApi', () => ({ communityVoiceApi: { remove: jest.fn(async () => undefined) } }));
const mockVoiceItems: { id: string; status: string; authorId: string; input: { cohortId?: string } }[] = [];
const mockVoiceSend = jest.fn();
jest.mock('../../../../hooks/useVoiceOutbox', () => ({
  useVoiceOutbox: () => ({ items: mockVoiceItems, send: mockVoiceSend, retry: jest.fn(), discard: jest.fn() }),
}));
jest.mock('../spaceChatApi', () => {
  const actual = jest.requireActual('../spaceChatApi');
  return {
    ...actual,
    spaceChatApi: {
      list: jest.fn(),
      send: jest.fn(),
      remove: jest.fn(async () => undefined),
      getRead: jest.fn(async () => ({ last_read_at: null, last_read_message_id: null })),
      markRead: jest.fn(async () => undefined),
    },
  };
});

import { isNoAccess, spaceChatApi, type SpaceMessage } from '../spaceChatApi';
import { useSpaceChat } from '../useSpaceChat';
import { useSpaceVoiceOutbox } from '../useSpaceVoiceOutbox';

const api = spaceChatApi as unknown as { list: jest.Mock; send: jest.Mock };
const msg = (id: string, author: string, extra: Partial<SpaceMessage> = {}): SpaceMessage => ({
  id, cohort_id: 'space-1', sender_user_id: author, body: `words of ${author}`, kind: 'text',
  created_at: `2026-11-05T18:0${id.slice(-1)}:00Z`, sender: { id: author, name: author === 'ana' ? 'Ana' : 'Ben', is_coach: false },
  ...extra,
});

let qc: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.list.mockReset();
  api.send.mockReset();
  mockVoiceItems.length = 0;
  mockVoiceSend.mockReset();
});
afterEach(() => qc.clear());

describe('KT-2: the space chat data layer', () => {
  it('KT-2: a block drops the rows of the blocked author, and every quote of them, from the kept list at once', async () => {
    api.list.mockResolvedValue({
      messages: [
        msg('m2', 'ben', { parent_message_id: 'm1', parent: { id: 'm1', gone: false, kind: 'text', sender_name: 'Ana', snippet: 'words of ana' } }),
        msg('m1', 'ana'),
      ],
      next_before: null,
    });
    const { result } = await renderHook(() => useSpaceChat('space-1', 'viewer', false), { wrapper });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await act(async () => result.current.dropAuthor('ana'));
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toEqual(['m2']));
    expect(result.current.messages[0].parent).toEqual({ id: 'm1', gone: true });
    expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('words of ana');
  });

  it('KT-2: a read refused with 403 (a ban, a departure, another workspace) closes the space and leaves nothing readable', async () => {
    api.list.mockRejectedValue({ status: 403, code: 'community.cohort.no_access' });
    const { result } = await renderHook(() => useSpaceChat('space-1', 'viewer', false), { wrapper });
    await waitFor(() => expect(result.current.noAccess).toBe(true));
    expect(result.current.messages).toEqual([]);
    expect(result.current.readable('m1')).toBeUndefined();
  });

  // FIX-942 (LS-942 B2): mid-visit, a reply and the sheet held and the messages still in the cache, a fresh read
  // refused closes all three: each guard alone (isGone, held, readable) is what this asserts.
  it.each([{ status: 403 }, { status: 404 }])('KT-2: a read refused with $status mid-visit (a ban, a departure, another workspace) ends reply mode and the sheet and leaves the cached messages unreadable', async ({ status }) => {
    api.list.mockResolvedValueOnce({ messages: [msg('m1', 'ben')], next_before: null });
    const { result } = await renderHook(() => useSpaceChat('space-1', 'viewer', false), { wrapper });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => {
      result.current.setReply({ id: 'm1', body: 'words of ben', authorLabel: 'Ben', authorId: 'ben' });
      result.current.setHeld('m1');
    });
    expect([result.current.reply?.id, result.current.held?.id, result.current.readable('m1')?.id]).toEqual(['m1', 'm1', 'm1']);
    api.list.mockRejectedValue({ status, code: 'community.cohort.no_access' });
    await act(async () => { await result.current.list.refetch(); });
    await waitFor(() => expect(result.current.noAccess).toBe(true));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.reply).toBeNull();
    expect(result.current.held).toBeUndefined();
    expect(result.current.readable('m1')).toBeUndefined();
  });

  // FIX-942 (LO-942 C2): a quote of a message the phone never held (an older page, not read yet) goes by who wrote it.
  it('KT-2: a block also ends reply mode on, and empties a waiting reply to, a message of the blocked author the phone never held', async () => {
    api.list.mockResolvedValue({ messages: [msg('m2', 'ben'), msg('m1', 'ana')], next_before: 'older' });
    const { result } = await renderHook(() => useSpaceChat('space-1', 'viewer', false), { wrapper });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    const older = { id: 'm0', body: 'older words of ana', authorLabel: 'Ana', authorId: 'ana' };
    await act(async () => {
      result.current.send('a reply to ana', older);
      result.current.setReply(older);
    });
    expect(result.current.reply?.id).toBe('m0');
    await act(async () => result.current.dropAuthor('ana'));
    await waitFor(() => expect(result.current.reply).toBeNull());
    const waiting = result.current.pending.find((r) => r.body === 'a reply to ana');
    expect(waiting?.reply).toEqual({ id: 'm0', body: '', authorLabel: '', gone: true });
    await act(async () => result.current.removeLocal(waiting?.localId ?? ''));
  });

  it('KT-2: a text refused with 403 fails as closed (never sent again) and closes the space', async () => {
    api.list.mockResolvedValue({ messages: [msg('m1', 'ben')], next_before: null });
    api.send.mockRejectedValue({ status: 403, code: 'community.cohort.no_access' });
    const { result } = await renderHook(() => useSpaceChat('space-1', 'viewer', true), { wrapper });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await act(async () => result.current.send('still here?'));
    await waitFor(() => expect(result.current.pending[0]).toEqual(expect.objectContaining({ state: 'failed', reason: 'closed' })));
    await waitFor(() => expect(result.current.noAccess).toBe(true));
    expect(api.send).toHaveBeenCalledTimes(1);
  });

  it('KT-2: 403 and 404 are no access; any other failure is not', () => {
    expect(isNoAccess({ status: 403 })).toBe(true);
    expect(isNoAccess({ status: 404 })).toBe(true);
    expect(isNoAccess({ status: 500 })).toBe(false);
    expect(isNoAccess(new Error('offline'))).toBe(false);
  });

  it('KT-2: the space voice outbox holds only my notes for this space, and sends into this space only', async () => {
    mockVoiceItems.push(
      { id: 'local-1-1', status: 'queued', authorId: 'viewer', input: { cohortId: 'space-1' } },
      { id: 'local-2-1', status: 'queued', authorId: 'someone-else', input: { cohortId: 'space-1' } },
      { id: 'local-3-1', status: 'queued', authorId: 'viewer', input: { cohortId: 'space-2' } },
    );
    const { result } = await renderHook(() => useSpaceVoiceOutbox('ws-1', 'viewer', 'space-1'), { wrapper });
    expect(result.current.rows.map((r) => r.v.id)).toEqual(['local-1-1']);
    const recording = { uri: 'file:///note.m4a' } as never;
    result.current.send(recording);
    expect(mockVoiceSend).toHaveBeenCalledWith(recording, { cohortId: 'space-1' });
  });
});
