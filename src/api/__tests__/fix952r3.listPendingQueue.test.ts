/**
 * FIX-952R3 (LS-952R3 B1, the class): the shared drafts read is the whole queue. It follows the paged queue
 * (GET /ai/gateway/drafts?order=oldest, backend ai-approval.service.ts pageQueue) to its end, through pages the server
 * filtered short, newest first as before; it fails rather than hand back part of the queue; an older server's plain list
 * is used as it comes.
 */
const mockGet = jest.fn();
jest.mock('../../services/api', () => ({ __esModule: true, default: { get: (...args: unknown[]) => mockGet(...args) } }));

import { _setMockModeForTesting, coachAiExecutionApi } from '../coachAiExecutionApi';

type Params = { status?: string; order?: string; limit?: string; after?: string };
const row = (i: number) => ({ id: `d-${i}`, subject_user_id: `client-${i % 45}`, capability: 'draft.send_notification', status: 'pending', payload: {} });

/** The server's paged queue over `rows`, oldest first; `keep` drops rows after the page is cut, as keepOnRoster does. */
function pagedQueue(rows: ReturnType<typeof row>[], keep: (r: ReturnType<typeof row>) => boolean = () => true) {
  return async (_path: string, options?: { params?: Params }) => {
    const p = options?.params ?? {};
    if (p.order !== 'oldest') return { data: rows.slice(-50).reverse() };
    const limit = Number(p.limit ?? 50);
    const start = p.after ? rows.findIndex((r) => r.id === p.after) + 1 : 0;
    const items = rows.slice(start, start + limit);
    const next = start + limit < rows.length ? items[items.length - 1].id : null;
    return { data: { items: items.filter(keep), total: rows.length, next_cursor: next } };
  };
}

beforeEach(() => {
  _setMockModeForTesting('off');
  mockGet.mockReset();
});

it('reads every page of a 450-draft queue, pages the server filtered short included, newest first', async () => {
  const rows = Array.from({ length: 450 }, (_, i) => row(i));
  mockGet.mockImplementation(pagedQueue(rows, (r) => r.subject_user_id !== 'client-7'));
  const { drafts } = await coachAiExecutionApi.listPending();
  const kept = rows.filter((r) => r.subject_user_id !== 'client-7');
  expect(drafts.map((d) => d.id)).toEqual(kept.map((r) => r.id).reverse());
  expect(mockGet).toHaveBeenCalledTimes(3);
  expect(mockGet).toHaveBeenNthCalledWith(1, '/ai/gateway/drafts', { params: { status: 'pending', order: 'oldest', limit: '200' } });
  expect(mockGet).toHaveBeenNthCalledWith(2, '/ai/gateway/drafts', { params: { status: 'pending', order: 'oldest', limit: '200', after: 'd-199' } });
});

it('keeps reading when a whole page was filtered out by the server', async () => {
  const rows = Array.from({ length: 401 }, (_, i) => row(i));
  mockGet.mockImplementation(pagedQueue(rows, (r) => Number(r.id.slice(2)) >= 200));
  const { drafts } = await coachAiExecutionApi.listPending();
  expect(drafts).toHaveLength(201);
  expect(drafts[0].id).toBe('d-400');
});

it.each([
  ['a cursor that does not move', async () => ({ data: { items: [row(1)], total: 9, next_cursor: 'd-1' } })],
  ['a later page that is not a page', async (_p: string, o?: { params?: Params }) => (o?.params?.after ? { data: [row(2)] } : { data: { items: [row(1)], total: 2, next_cursor: 'd-1' } })],
  ['a queue that never ends', async (_p: string, o?: { params?: Params }) => ({ data: { items: [row(1)], total: 1e6, next_cursor: `c-${o?.params?.after ?? ''}x` } })],
] as const)('fails on %s, never hands back part of the queue', async (_case, impl) => {
  mockGet.mockImplementation(impl);
  await expect(coachAiExecutionApi.listPending()).rejects.toThrow();
});

it('a failed page fails the read', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => row(i));
  const queue = pagedQueue(rows);
  mockGet.mockImplementation(async (path: string, o?: { params?: Params }) => {
    if (o?.params?.after) throw Object.assign(new Error('Reload the list.'), { response: { status: 400, data: { code: 'INVALID_CURSOR' } } });
    return queue(path, o);
  });
  await expect(coachAiExecutionApi.listPending()).rejects.toThrow('Reload the list.');
});

it('an older server without the paged queue: its plain list is used as it comes', async () => {
  const plain = [row(3), row(2), row(1)];
  mockGet.mockResolvedValueOnce({ data: plain });
  expect((await coachAiExecutionApi.listPending()).drafts).toEqual(plain);
  mockGet.mockResolvedValueOnce({ data: { drafts: plain } });
  expect((await coachAiExecutionApi.listPending()).drafts).toEqual(plain);
});

it('clientId and limit pick from the whole queue', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => row(i));
  mockGet.mockImplementation(pagedQueue(rows));
  const mine = await coachAiExecutionApi.listPending({ clientId: 'client-3' });
  expect(mine.drafts.map((d) => d.id)).toEqual(rows.filter((r) => r.subject_user_id === 'client-3').map((r) => r.id).reverse());
  expect((await coachAiExecutionApi.listPending({ clientId: 'client-3', limit: 2 })).drafts.map((d) => d.id)).toEqual(['d-273', 'd-228']);
});
