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

it('coach identity uses the already scoped assigned-coach endpoint', async () => {
  mockApi.get.mockResolvedValue({ data: { id: 'c1', name: 'Coach' } });
  await expect(schedulingApi.listMyCoaches()).resolves.toEqual([{ coach_id: 'c1', name: 'Coach', timezone: null }]);
  expect(mockApi.get).toHaveBeenCalledWith('/v1/clients/me/coach');
});

it('only explicit no assignment becomes an empty coach list; other 404s remain errors', async () => {
  mockApi.get.mockRejectedValueOnce({ response: { status: 404, data: { error: 'COACH_NOT_ASSIGNED' } } });
  await expect(schedulingApi.listMyCoaches()).resolves.toEqual([]);
  mockApi.get.mockRejectedValueOnce({ response: { status: 404, data: { error: 'COACH_NOT_FOUND' } } });
  await expect(schedulingApi.listMyCoaches()).rejects.toMatchObject({ response: { status: 404 } });
});
