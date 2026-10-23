import api from '../../services/api';
import { COPILOT_PATHS, PATH_DRAFTS_MAX_PAGES, copilotApi, copilotErrorOf, parseChange, parseSuggestion } from '../copilotApi';

jest.mock('../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() } }));
const get = jest.mocked(api.get);
const post = jest.mocked(api.post);
const patch = jest.mocked(api.patch);
const ok = (data: unknown) => ({ data }) as never;
const fail = (status: number, data: unknown = {}) => Object.assign(new Error('http'), { response: { status, data } });

const MOVE = { kind: 'move_session', assignment_id: 'a1', workout: 'Lower body B', from_at: '2026-10-22T17:00:00Z', to_at: '2026-10-23T17:00:00Z', sources: [] };
const KCAL = { kind: 'set_calorie_target', target_id: 'auto-t1', from_kcal: 2600, to_kcal: 2450, sources: [] };
const VIEW = { id: 's1', status: 'pending', change: MOVE, reason: 'Friday is a rest day.', note: null, sent_at: '2026-10-21T21:34:00Z', decided_at: null };

beforeEach(() => jest.resetAllMocks());

test('a change parses only when every field the phone draws is there', () => {
  expect(parseChange(MOVE)).toEqual({ kind: 'move_session', assignment_id: 'a1', workout: 'Lower body B', from_at: MOVE.from_at, to_at: MOVE.to_at });
  expect(parseChange(KCAL)).toEqual({ kind: 'set_calorie_target', target_id: 'auto-t1', from_kcal: 2600, to_kcal: 2450 });
  expect(parseChange({ ...MOVE, to_at: 'soon' })).toBeNull();
  expect(parseChange({ ...KCAL, to_kcal: '2450' })).toBeNull();
  expect(parseChange({ kind: 'swap_meal' })).toBeNull();
  expect(parseSuggestion({ ...VIEW, status: 'maybe' })).toBeNull();
  expect(parseSuggestion(VIEW)?.reason).toBe('Friday is a rest day.');
});

test('the client read: rows it cannot draw are left out, and a server without Copilot (404) is "nothing new"', async () => {
  get.mockResolvedValueOnce(ok({ suggestions: [VIEW, { ...VIEW, id: 's2', change: { kind: 'other' } }], suggestions_total: 2 }));
  expect((await copilotApi.recent())?.map((s) => s.id)).toEqual(['s1']);
  expect(get).toHaveBeenCalledWith(COPILOT_PATHS.recent);
  get.mockRejectedValueOnce(fail(404));
  expect(await copilotApi.recent()).toBeNull();
  get.mockRejectedValueOnce(fail(500));
  await expect(copilotApi.recent()).rejects.toThrow('http');
});

test('send posts to the row and returns the sent view', async () => {
  post.mockResolvedValueOnce(ok(VIEW));
  expect((await copilotApi.send('s 1')).status).toBe('pending');
  expect(post).toHaveBeenCalledWith('/client/copilot/suggestions/s%201/send');
});

test('the coach queue reads oldest first, keeps only waiting Copilot rows, and the old array means none', async () => {
  const row = { id: 'd1', capability: 'client_path_change', status: 'pending', subject_user_id: 'c1', payload: KCAL, rationale: 'Steady loss.', created_at: VIEW.sent_at };
  get.mockResolvedValueOnce(ok({ items: [row, { ...row, id: 'd2', capability: 'program_draft' }, { ...row, id: 'd3', payload: {} }], total: 3, next_cursor: null }));
  expect(await copilotApi.pathChangeDrafts()).toEqual([{ id: 'd1', clientId: 'c1', change: parseChange(KCAL), reason: 'Steady loss.', sentAt: VIEW.sent_at }]);
  expect(get).toHaveBeenCalledWith('/ai/gateway/drafts', { params: { order: 'oldest', limit: '100' } });
  get.mockResolvedValueOnce(ok([row]));
  expect(await copilotApi.pathChangeDrafts()).toEqual([]);
});

test('a busy coach: the Copilot row on page 2, behind 100 older drafts of other kinds, still shows; paging stops at the cap', async () => {
  const old = Array.from({ length: 100 }, (_, i) => ({ id: `w${i}`, capability: 'draft.create_workout_plan', status: 'pending' }));
  const row = { id: 'd1', capability: 'client_path_change', status: 'pending', subject_user_id: 'c1', payload: MOVE, created_at: VIEW.sent_at };
  get.mockResolvedValueOnce(ok({ items: old, next_cursor: 'w99' })).mockResolvedValueOnce(ok({ items: [row], next_cursor: null }));
  expect((await copilotApi.pathChangeDrafts()).map((d) => d.id)).toEqual(['d1']);
  expect(get).toHaveBeenLastCalledWith('/ai/gateway/drafts', { params: { order: 'oldest', limit: '100', after: 'w99' } });
  get.mockReset().mockResolvedValue(ok({ items: old, next_cursor: 'w99' }));
  expect([await copilotApi.pathChangeDrafts(), get.mock.calls.length]).toEqual([[], PATH_DRAFTS_MAX_PAGES]);
});

test('decide sends the body as given, and errors expose status, code and the server words', async () => {
  patch.mockResolvedValueOnce(ok({}));
  await copilotApi.decide('d1', { decision: 'rejected', note: 'Keep the run.' });
  expect(patch).toHaveBeenCalledWith('/ai/gateway/drafts/d1', { decision: 'rejected', note: 'Keep the run.' });
  expect(copilotErrorOf(fail(409, { code: 'COPILOT_PLAN_CHANGED', message: 'm' }))).toEqual({ status: 409, code: 'COPILOT_PLAN_CHANGED', message: 'm' });
  expect(copilotErrorOf(new Error('offline'))).toEqual({ status: null, code: null, message: null });
});
