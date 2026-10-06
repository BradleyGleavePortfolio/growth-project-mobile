/**
 * Sol B-326-3 / Opus C-326-1: the backend stores the user turn before it opens
 * the stream. A failure after HTTP 200 (an in-stream consent refusal, an
 * in-stream egress block, ROMAN_UNAVAILABLE, a cut stream) must keep the turn
 * and re-read the thread from the server, never roll it back, so nothing ever
 * appends it a second time on its own. A pre-check refusal (HTTP 403, nothing
 * stored) still rolls back and keeps the draft, as before.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useRomanChat } from '../useRomanChat';
import { RomanApiError, type RomanMessage } from '../../../api/romanApi';

const mockOpen = jest.fn();
const mockList = jest.fn();
const mockSend = jest.fn();

jest.mock('../../../api/romanApi', () => {
  const actual = jest.requireActual('../../../api/romanApi');
  return {
    ...actual,
    openOrResumeSession: (...a: unknown[]) => mockOpen(...a),
    listMessages: (...a: unknown[]) => mockList(...a),
    sendMessage: (...a: unknown[]) => mockSend(...a),
    deleteSession: jest.fn(),
  };
});
jest.mock('../../../utils/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const SESSION = { id: 's1', surface: 'client', messageCount: 0 };
const STORED: RomanMessage = {
  id: 'm-server-1',
  role: 'user',
  content: 'how do I deload',
  interrupted: false,
  createdAt: '2026-10-02T10:00:00.000Z',
};

beforeEach(() => {
  mockOpen.mockReset().mockResolvedValue(SESSION);
  mockList.mockReset().mockResolvedValue({ messages: [], nextCursor: null });
  mockSend.mockReset();
});

async function ready() {
  const hook = await renderHook(() => useRomanChat('client'));
  await waitFor(() => expect(hook.result.current.phase).toBe('ready'));
  return hook;
}

describe('useRomanChat — the turn was stored before the stream failed', () => {
  it('in-stream consent refusal: keeps the turn, re-reads the thread, outcome stored-no-reply, one send only', async () => {
    const { result } = await ready();
    mockSend.mockRejectedValueOnce(
      new RomanApiError('aiRefused', 'x', undefined, { kind: 'consent_required' }, true),
    );
    mockList.mockResolvedValueOnce({ messages: [STORED], nextCursor: null });
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.send('how do I deload');
    });
    expect(outcome).toBe('stored-no-reply');
    expect(result.current.messages.map((m) => m.id)).toEqual(['m-server-1']);
    expect(result.current.sendError).toMatchObject({ kind: 'aiRefused', turnStored: true });
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('the re-read fails: the optimistic turn stays visible (never rolled back)', async () => {
    const { result } = await ready();
    mockSend.mockRejectedValueOnce(new RomanApiError('unavailable', 'x', undefined, undefined, true));
    mockList.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await result.current.send('still here');
    });
    expect(result.current.messages.map((m) => m.content)).toEqual(['still here']);
    expect(result.current.sendError).toMatchObject({ turnStored: true });
  });

  it('pre-check refusal (HTTP 403, nothing stored): rolls back as before', async () => {
    const { result } = await ready();
    mockSend.mockRejectedValueOnce(new RomanApiError('aiRefused', 'x', undefined, { kind: 'consent_required' }));
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.send('not stored');
    });
    expect(outcome).toBe('send-failed');
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sendError?.turnStored).toBeUndefined();
  });
});
