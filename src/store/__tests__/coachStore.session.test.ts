/**
 * The shared roster store's sign-out fence. The coach Home (useCoachHomeV11), Clients, Messages and Programs all
 * read useCoachStore, and the Home starts a roster read the moment a coach lands. A read started for one coach must
 * never write into the store after sign-out (reset), so the next coach on the same device never sees the previous
 * coach's clients or error, even when the next coach's own read fails.
 */
import { useCoachStore } from '../coachStore';

const mockGetClients = jest.fn();
jest.mock('../../services/api', () => ({
  coachApi: { getClients: (...args: unknown[]) => mockGetClients(...args) },
}));
jest.mock('../../utils/logger', () => ({ logger: { error: jest.fn() } }));

const store = useCoachStore.getState;
const page = (id: string, name: string) => ({ data: [{ id, name }] });

describe('coachStore sign-out fence', () => {
  beforeEach(() => {
    mockGetClients.mockReset();
    store().reset();
  });

  it("a previous coach's late roster never reaches the next coach's store when the next read fails", async () => {
    let answerA: (v: unknown) => void = () => undefined;
    mockGetClients
      .mockImplementationOnce(() => new Promise((ok) => { answerA = ok; }))
      .mockRejectedValueOnce(new Error('offline'));
    // Coach A's read is still out when A signs out; coach B's first read fails.
    const lateA = store().loadClients('coach-a', 'active', { silent: true });
    store().reset();
    await store().loadClients('coach-b', 'active', { silent: true });
    answerA(page('a-client-1', 'Client A'));
    await lateA;
    expect(store().clients).toEqual([]);
    expect(store().loadError).not.toBeNull();
  });

  it("a previous coach's late roster never replaces the next coach's loaded roster", async () => {
    let answerA: (v: unknown) => void = () => undefined;
    mockGetClients
      .mockImplementationOnce(() => new Promise((ok) => { answerA = ok; }))
      .mockResolvedValueOnce(page('b-client-1', 'Client B'));
    const lateA = store().loadClients('coach-a');
    store().reset();
    await store().loadClients('coach-b');
    answerA(page('a-client-1', 'Client A'));
    await lateA;
    expect(store().clients.map((c) => c.id)).toEqual(['b-client-1']);
  });

  it("a previous coach's late failure does not mark the next coach's loaded roster as failed", async () => {
    let failA: (e: unknown) => void = () => undefined;
    mockGetClients
      .mockImplementationOnce(() => new Promise((_ok, no) => { failA = no; }))
      .mockResolvedValueOnce(page('b-client-1', 'Client B'));
    const lateA = store().loadClients('coach-a');
    store().reset();
    await store().loadClients('coach-b');
    failA(new Error('offline'));
    await lateA;
    expect(store()).toMatchObject({ loadError: null, isLoading: false });
    expect(store().clients.map((c) => c.id)).toEqual(['b-client-1']);
  });

  it('a read with no sign-out in between still writes its roster (control)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    mockGetClients.mockImplementationOnce(() => new Promise((ok) => { answer = ok; }));
    const read = store().loadClients('coach-a');
    answer(page('a-client-1', 'Client A'));
    await read;
    expect(store()).toMatchObject({ loadError: null, isLoading: false });
    expect(store().clients.map((c) => c.id)).toEqual(['a-client-1']);
  });
});
