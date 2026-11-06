/**
 * FIX-940 (LO-T2B on m#940, comment 6668167471): the client file's and the risk screen's one nudge gate.
 * C1: while the pair is unknown (the read is out, it failed, or the block list is not read yet) the gate says nothing
 * about the server, so a refusal remembered this session (the chat's or the peek's) stays; only the server's answer
 * that the pair is open clears it (the chat's own rule). B1: close(err) is true only for a refusal that means closed;
 * an ordinary failure leaves the pair open and nothing remembered.
 */
import { act, renderHook } from '@testing-library/react-native';

const mockUnread = jest.fn();
let mockBlockedIds: string[] = [];
let mockBlockKnown = true;
jest.mock('../../../services/api', () => ({ coachApi: { getUnreadCounts: () => mockUnread() } }));
jest.mock('../home-v11/blockList', () => ({
  useCoachBlockList: () => ({ known: mockBlockKnown, blockedIds: mockBlockedIds }),
}));
jest.mock('../../../hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ id: 'coach-940' }) }));
jest.mock('../../../ui/haptics/haptics.service', () => ({ HapticService: { selection: jest.fn(), warning: jest.fn() } }));

import { useNudgeGate } from '../client-detail/useNudgeGate';
import { closedRefusals } from '../../../components/messaging/closedRefusal';

const ID = 'client-940';
const settle = () => act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
const answer = (closed: string[]) => () => Promise.resolve({ data: { total: 0, by_client: {}, closed_client_ids: closed } });
// The backend's answer to a nudge across a block either way (nudges.service assertPairOpen -> 403 messaging.blocked).
const blockedRefusal = () => Object.assign(new Error('Request failed with status code 403'), {
  response: { status: 403, data: { statusCode: 403, error: 'messaging.blocked', code: 'messaging.blocked' } },
});
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

beforeEach(() => {
  closedRefusals.clearAll();
  mockUnread.mockReset();
  mockBlockedIds = [];
  mockBlockKnown = true;
});

const UNKNOWN = [
  { name: 'the read is still out', read: () => new Promise(() => {}), known: true },
  { name: 'the read failed (offline)', read: () => Promise.reject(networkError()), known: true },
  { name: 'the block list is not read yet', read: answer([]), known: false },
];

describe('C1: an unknown pair keeps a refusal remembered this session', () => {
  it.each(UNKNOWN)('$name: still closed, no nudge, the refusal kept', async ({ read, known }) => {
    closedRefusals.add(ID); // the chat or the peek was refused earlier this session
    mockUnread.mockImplementation(read);
    mockBlockKnown = known;
    const { result } = await renderHook(() => useNudgeGate(ID));
    await settle();
    expect(result.current.pair).toBeNull();
    expect(result.current.open).toBe(false);
    expect(result.current.closed).toBe(true);
    expect(closedRefusals.has(ID)).toBe(true);
  });

  it('the server answers closed: still closed, the refusal kept', async () => {
    closedRefusals.add(ID);
    mockUnread.mockImplementation(answer([ID]));
    const { result } = await renderHook(() => useNudgeGate(ID));
    await settle();
    expect(result.current.pair).toBe('them');
    expect(result.current.closed).toBe(true);
    expect(closedRefusals.has(ID)).toBe(true);
  });

  it('control: the server answers open: the chat\'s rule clears the refusal and the nudge comes back', async () => {
    closedRefusals.add(ID);
    mockUnread.mockImplementation(answer([]));
    const { result } = await renderHook(() => useNudgeGate(ID));
    await settle();
    expect(result.current.pair).toBe('open');
    expect(result.current.open).toBe(true);
    expect(closedRefusals.has(ID)).toBe(false);
  });
});

describe('B1: close(err) on a failed nudge', () => {
  it.each([
    { name: '403 messaging.blocked', err: blockedRefusal, closes: true },
    { name: 'a network error', err: networkError, closes: false },
    { name: 'a 500', err: () => Object.assign(new Error('x'), { response: { status: 500, data: {} } }), closes: false },
  ])('$name: closes $closes', async ({ err, closes }) => {
    mockUnread.mockImplementation(answer([]));
    const { result } = await renderHook(() => useNudgeGate(ID));
    await settle();
    expect(result.current.open).toBe(true);
    let said = false;
    await act(async () => { said = result.current.close(err()); });
    expect(said).toBe(closes);
    expect(result.current.open).toBe(!closes);
    expect(result.current.closed).toBe(closes);
    expect(closedRefusals.has(ID)).toBe(closes);
    if (closes) expect(result.current.by).toBe('them'); // BAM-2b: in a coaching pair a block that is not mine is theirs
  });
});
