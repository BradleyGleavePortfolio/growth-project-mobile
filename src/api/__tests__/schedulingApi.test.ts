/** Existing backend DTOs reject speculative civil-time/note fields. */
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

import api from '../../services/api';
import { schedulingApi, resolveClientTimezone } from '../schedulingApi';

const mockApi = jest.mocked(api);
const input = {
  coach_id: 'c1',
  session_type_id: 'type1',
  title: 'Quick initialization',
  start_at: '2030-05-21T15:00:00Z',
  end_at: '2030-05-21T15:15:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.get.mockResolvedValue({ data: {} });
  mockApi.post.mockResolvedValue({ data: {} });
});

it('resolves a time zone for display without changing absolute booking instants', () => {
  expect(resolveClientTimezone().length).toBeGreaterThan(0);
});

it('request sends the existing strict DTO, excluding unsupported notes/timezone', async () => {
  await schedulingApi.requestSession({ ...input, notes: 'private note', client_timezone: 'Europe/Berlin' });
  expect(mockApi.post).toHaveBeenCalledWith('/scheduling/sessions', input);
});

it('request with no speculative fields preserves its shape', async () => {
  await schedulingApi.requestSession(input);
  expect(mockApi.post).toHaveBeenCalledWith('/scheduling/sessions', input);
});

it('reschedule excludes unsupported timezone and keeps the absolute instants', async () => {
  await schedulingApi.rescheduleSession('s1', { start_at: input.start_at, end_at: input.end_at, client_timezone: 'Asia/Tokyo' });
  expect(mockApi.post).toHaveBeenCalledWith('/scheduling/sessions/s1/reschedule', { start_at: input.start_at, end_at: input.end_at });
});

it('open slots passes the approved duration to the existing backend contract', async () => {
  await schedulingApi.getOpenSlots('c1', { from: input.start_at, to: input.end_at, durationMinutes: 15 });
  expect(mockApi.get).toHaveBeenCalledWith('/scheduling/coaches/c1/open-slots', {
    params: { from: input.start_at, to: input.end_at, duration_minutes: '15' },
  });
});

it('bookable coaches come from the S-SCHED-2 my-coaches contract with the welcome marker', async () => {
  const row = {
    coach_id: 'c1', name: 'Coach', avatar_url: null, timezone: 'America/Los_Angeles', relationship: 'head',
    bookable_type_count: 2,
    welcome: { session_type_id: 't1', name: 'Quick initialization', duration_minutes: 15, active_session_id: null, active_session_status: null, active_session_start_at: null, completed_at: null },
  };
  mockApi.get.mockResolvedValueOnce({ data: [row] });
  await expect(schedulingApi.listMyCoaches()).resolves.toEqual([row]);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
  expect(mockApi.get).toHaveBeenCalledWith('/scheduling/my-coaches');
});

it('an older backend without my-coaches (bare 404) falls back to the assigned-coach endpoint', async () => {
  mockApi.get
    .mockRejectedValueOnce({ response: { status: 404, data: { statusCode: 404, message: 'Cannot GET /scheduling/my-coaches', error: 'Not Found' } } })
    .mockResolvedValueOnce({ data: { id: 'c1', name: 'Coach' } });
  await expect(schedulingApi.listMyCoaches()).resolves.toEqual([{ coach_id: 'c1', name: 'Coach', timezone: null }]);
  expect(mockApi.get).toHaveBeenLastCalledWith('/v1/clients/me/coach');
});

it('a coded my-coaches failure is surfaced, never masked by the fallback', async () => {
  mockApi.get.mockRejectedValueOnce({ response: { status: 403, data: { code: 'COACH_NOT_BOOKABLE' } } });
  await expect(schedulingApi.listMyCoaches()).rejects.toMatchObject({ response: { status: 403 } });
  expect(mockApi.get).toHaveBeenCalledTimes(1);
});

it('only explicit no assignment becomes an empty coach list; other 404s remain errors', async () => {
  const bare404 = { response: { status: 404, data: { error: 'Not Found' } } };
  mockApi.get.mockRejectedValueOnce(bare404).mockRejectedValueOnce({ response: { status: 404, data: { error: 'COACH_NOT_ASSIGNED' } } });
  await expect(schedulingApi.listMyCoaches()).resolves.toEqual([]);
  mockApi.get.mockRejectedValueOnce(bare404).mockRejectedValueOnce({ response: { status: 404, data: { error: 'COACH_NOT_FOUND' } } });
  await expect(schedulingApi.listMyCoaches()).rejects.toMatchObject({ response: { status: 404 } });
});

it('open slots sends the session type so the server sizes slots to it', async () => {
  await schedulingApi.getOpenSlots('c1', { from: input.start_at, to: input.end_at, durationMinutes: 15, sessionTypeId: 'type1' });
  expect(mockApi.get).toHaveBeenCalledWith('/scheduling/coaches/c1/open-slots', {
    params: { from: input.start_at, to: input.end_at, duration_minutes: '15', session_type_id: 'type1' },
  });
});

it('session types: archived ones only on explicit request', async () => {
  await schedulingApi.listSessionTypes('c1');
  expect(mockApi.get).toHaveBeenLastCalledWith('/scheduling/coaches/c1/session-types');
  await schedulingApi.listSessionTypes('c1', { includeArchived: true });
  expect(mockApi.get).toHaveBeenLastCalledWith('/scheduling/coaches/c1/session-types', { params: { include_archived: 'true' } });
});

it('past sessions page with scope=past and the before cursor', async () => {
  await schedulingApi.listMySessions(20, { scope: 'past', before: '2030-05-01T10:00:00.000Z' });
  expect(mockApi.get).toHaveBeenLastCalledWith('/scheduling/sessions', {
    params: { limit: '20', scope: 'past', before: '2030-05-01T10:00:00.000Z' },
  });
  await schedulingApi.listMySessions(5);
  expect(mockApi.get).toHaveBeenLastCalledWith('/scheduling/sessions', { params: { limit: '5' } });
});
