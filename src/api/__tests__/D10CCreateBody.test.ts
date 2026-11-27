/**
 * D10-BUILD-COMMUNITY B1 (the T4 tripwire, class (a)): every POST /community/workspaces/:id/cohorts the phone can send
 * carries exactly the keys its sender chose. The K2 "New cohort" sends { name } and nothing else; New space sends
 * { name, kind, visibility: 'clients' } or { name, kind, visibility: 'package', package_ids } (CreateCohortDto,
 * community-cohort.dto.ts:52-82 at production 1a052ef2). No path sends 'public', 'members', 'section', or package_ids
 * without 'package'. Ids and names are made up.
 */
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: (...a: unknown[]) => mockGet(...a), post: (...a: unknown[]) => mockPost(...a) },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { coachCommunityApi } = require('../coachCommunityApi');

const WS = '00000001-0000-4000-8000-000000000000';
const SPACE = '00000002-0000-4000-8000-000000000000';
const PKG_A = 'pkg-alpha';
const PKG_B = 'pkg-beta';

beforeEach(() => {
  mockGet.mockReset().mockResolvedValue({ data: { workspace_id: WS } });
  mockPost.mockReset().mockResolvedValue({
    data: { cohort: { id: SPACE, workspace_id: WS, name: 'Food on the go', created_at: '2026-11-27T00:00:00.000Z' } },
  });
});

async function bodyOf(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await coachCommunityApi.createCohort(input);
  expect(mockPost).toHaveBeenCalledTimes(1);
  const [url, body, config] = mockPost.mock.calls[0];
  expect(url).toBe(`/community/workspaces/${WS}/cohorts`);
  expect(config.headers['Idempotency-Key']).toEqual(expect.any(String));
  return body;
}

describe('B1: the create body is exactly the coach\'s choice', () => {
  it('the K2 "New cohort" still sends { name } and nothing else', async () => {
    expect(await bodyOf({ name: 'Winter' })).toStrictEqual({ name: 'Winter' });
  });

  it.each([
    ['chat', 'All my clients', { visibility: 'clients' }],
    ['announcement', 'All my clients', { visibility: 'clients' }],
    ['chat', 'one package', { visibility: 'package', package_ids: [PKG_A] }],
    ['announcement', 'one package', { visibility: 'package', package_ids: [PKG_A] }],
    ['chat', 'two packages', { visibility: 'package', package_ids: [PKG_A, PKG_B] }],
    ['announcement', 'two packages', { visibility: 'package', package_ids: [PKG_A, PKG_B] }],
  ])('%s x %s: the exact body', async (kind, _who, access) => {
    const body = await bodyOf({ name: 'Food on the go', kind, ...access });
    expect(body).toStrictEqual({ name: 'Food on the go', kind, ...access });
    expect(['clients', 'package']).toContain(body.visibility);
    expect(['chat', 'announcement']).toContain(body.kind);
    if (body.visibility !== 'package') expect(body).not.toHaveProperty('package_ids');
  });

  it('a create carries the server\'s kind and visibility back on the row', async () => {
    mockPost.mockResolvedValueOnce({
      data: { cohort: { id: SPACE, workspace_id: WS, name: 'Food on the go', created_at: '2026-11-27T00:00:00.000Z', kind: 'chat', visibility: 'package' } },
    });
    const row = await coachCommunityApi.createCohort({ name: 'Food on the go', kind: 'chat', visibility: 'package', package_ids: [PKG_A] });
    expect(row).toEqual(expect.objectContaining({ id: SPACE, kind: 'chat', visibility: 'package' }));
  });
});

describe('the list keeps kind and visibility as plain strings', () => {
  it('an unknown value never fails the list', async () => {
    mockGet.mockReset().mockResolvedValue({
      data: { cohorts: [
        { id: SPACE, workspace_id: WS, name: 'Later', member_count: 3, kind: 'future_kind', visibility: 'future_value' },
      ] },
    });
    const list = await coachCommunityApi.getCohorts();
    expect(list).toEqual([expect.objectContaining({ id: SPACE, kind: 'future_kind', visibility: 'future_value' })]);
  });
});
