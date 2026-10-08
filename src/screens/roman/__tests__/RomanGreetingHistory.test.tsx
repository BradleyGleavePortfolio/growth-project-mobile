import { renderHook, waitFor } from '@testing-library/react-native';
import { useRomanChat } from '../useRomanChat';

const mockOpen = jest.fn();
const mockMessages = jest.fn();
const mockHistory = jest.fn();
const binding = { subject: 'sub:client-1', epoch: 1 };
jest.mock('../../../api/romanApi', () => ({
  ...jest.requireActual('../../../api/romanApi'),
  openOrResumeSession: (...args: unknown[]) => mockOpen(...args),
  listMessages: (...args: unknown[]) => mockMessages(...args),
}));
jest.mock('../../../api/romanChatsApi', () => ({
  romanChatsApi: { list: (...args: unknown[]) => mockHistory(...args) },
}));
jest.mock('../../../services/accountBinding', () => ({
  captureAccountBinding: async () => ({ subject: 'sub:client-1', epoch: 1 }),
}));
jest.mock('../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockOpen.mockResolvedValue({ id: 'today', surface: 'client', messageCount: 0 });
  mockMessages.mockResolvedValue({ messages: [], nextCursor: null });
});

it('introduces Roman only when the account has no earlier chats, checked before opening today', async () => {
  mockHistory.mockResolvedValue({ ok: true, value: { sessions: [], nextCursor: null } });
  const hook = await renderHook(() => useRomanChat('client'));
  await waitFor(() => expect(hook.result.current.phase).toBe('ready'));
  expect(hook.result.current.isFirstOpen).toBe(true);
  expect(mockHistory).toHaveBeenCalledWith(binding, { limit: 1 });
  expect(mockHistory.mock.invocationCallOrder[0]).toBeLessThan(mockOpen.mock.invocationCallOrder[0]);
});

it('a returning client gets the returning greeting even when today has no messages', async () => {
  mockHistory.mockResolvedValue({
    ok: true, value: { sessions: [{ id: 'yesterday', messageCount: 2 }], nextCursor: null },
  });
  const hook = await renderHook(() => useRomanChat('client'));
  await waitFor(() => expect(hook.result.current.phase).toBe('ready'));
  expect(hook.result.current.isFirstOpen).toBe(false);
});

it.each(['offline', 'busy'] as const)(
  '%s history: do not guess that this is a first meeting or block chat',
  async (reason) => {
    mockHistory.mockResolvedValue({ ok: false, failure: { reason } });
    const hook = await renderHook(() => useRomanChat('client'));
    await waitFor(() => expect(hook.result.current.phase).toBe('ready'));
    expect(hook.result.current.isFirstOpen).toBe(false);
    expect(mockOpen).toHaveBeenCalledWith('client');
  },
);
