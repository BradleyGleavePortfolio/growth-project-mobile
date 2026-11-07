/**
 * LS-953 B1: a failed turn's Try again remains on screen after another question.
 * Every such retry must replay that turn's key, not the latest question's slot.
 * The real hook and Roman API run; only the HTTP transport and session open are mocked.
 */
import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../../../services/api', () => ({ __esModule: true, default: {} }));
jest.mock('../../../../services/secureStorage', () => ({
  secureStorage: { getItem: jest.fn(async () => 'test-token') },
}));
jest.mock('../../../../ui/haptics/haptics.service', () => ({
  HapticService: { error: jest.fn(), success: jest.fn() },
}));
jest.mock('../../../../api/romanApi', () => ({
  ...jest.requireActual('../../../../api/romanApi'),
  openOrResumeSession: async () => ({ id: 'sess-1', surface: 'client', messageCount: 0 }),
}));

import { useCopilotAsk } from '../useCopilotAsk';

const realFetch = global.fetch;
const DONE = 'data: {"type":"done","text":"Your week is ready.","messageId":"reply-1","interrupted":false}\n\n';
const fetchMock = jest.fn();
const ok = () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  text: async () => DONE,
}) as unknown as Response;
const noAnswer = () => Promise.reject(new TypeError('Network request failed'));
const requests = () => fetchMock.mock.calls.map(([, init]: [string, RequestInit]) => ({
  body: JSON.parse(String(init.body)) as { content: string },
  key: (init.headers as Record<string, string>)['Idempotency-Key'],
}));

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => { global.fetch = realFetch; });

it.each(['success', 'failure'] as const)(
  'retry of an earlier failed Copilot turn keeps its key after another question has a %s',
  async (later) => {
    fetchMock.mockImplementationOnce(noAnswer);
    if (later === 'success') fetchMock.mockResolvedValueOnce(ok());
    else fetchMock.mockImplementationOnce(noAnswer);
    fetchMock.mockResolvedValueOnce(ok());

    const { result } = await renderHook(() => useCopilotAsk());
    await act(async () => { await result.current.ask('How was my week?'); });
    const earlier = result.current.turns[0];
    expect(earlier.error?.kind).toBe('offline');

    await act(async () => { await result.current.ask('What is next week?'); });
    expect(result.current.turns[0].error?.kind).toBe('offline');
    await act(async () => { await result.current.ask(earlier.question, earlier.id); });

    const [first, other, retry] = requests();
    expect(requests()).toHaveLength(3);
    expect(first.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(other.key).not.toBe(first.key);
    expect(retry.body).toEqual(first.body);
    expect(retry.key).toBe(first.key);
  },
);

it('LS-953R2 evidence: failed turns created in one millisecond stay distinct and retry their own keys', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(1794030000000);
  try {
    fetchMock.mockImplementationOnce(noAnswer).mockImplementationOnce(noAnswer).mockResolvedValueOnce(ok());
    const { result } = await renderHook(() => useCopilotAsk());
    await act(async () => { await result.current.ask('How was my week?'); });
    const first = result.current.turns[0];
    await act(async () => { await result.current.ask('What is next week?'); });
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[1].id).not.toBe(first.id);
    await act(async () => { await result.current.ask(first.question, first.id); });
    const [a, b, retry] = requests();
    expect(b.key).not.toBe(a.key);
    expect(retry.key).toBe(a.key);
    expect(result.current.turns[0].answer?.text).toBe('Your week is ready.');
    expect(result.current.turns[1].answer).toBeNull();
  } finally {
    clock.mockRestore();
  }
});
