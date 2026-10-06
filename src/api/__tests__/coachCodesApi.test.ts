/**
 * coachCodesApi wire contract against backend b#658
 * (src/invite-codes/coach-code-tools.controller.ts on growth-project-backend main).
 */
import api from '../../services/api';
import {
  coachCodesApi,
  coachCodesErrorMessage,
  isCodeToolsDisabled,
  newCreateKey,
} from '../coachCodesApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

function httpError(status: number, data: Record<string, unknown> = {}) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { statusCode: status, ...data } },
  });
}

describe('coachCodesApi', () => {
  it('lists from GET /coach/codes and signups from GET /coach/codes/signups?days=N', async () => {
    get.mockResolvedValueOnce({ data: { codes: [], tracking_note: 'n' } });
    await expect(coachCodesApi.list()).resolves.toEqual({ codes: [], tracking_note: 'n' });
    expect(get).toHaveBeenLastCalledWith('/coach/codes');
    get.mockResolvedValueOnce({ data: { by_code: [] } });
    await coachCodesApi.signups(7);
    expect(get).toHaveBeenLastCalledWith('/coach/codes/signups', { params: { days: 7 } });
  });

  it('create sends the Idempotency-Key header (never in the body) and the same key on a retry', async () => {
    const key = newCreateKey();
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    post.mockRejectedValueOnce(new Error('Network Error'));
    post.mockResolvedValueOnce({ data: { code: { id: 'c1' }, replayed: true } });
    await expect(coachCodesApi.create({ label: 'Front desk' }, key)).rejects.toThrow('Network Error');
    await coachCodesApi.create({ label: 'Front desk' }, key);
    expect(post).toHaveBeenCalledTimes(2);
    for (const call of post.mock.calls) {
      expect(call[0]).toBe('/coach/codes');
      expect(call[1]).toEqual({ label: 'Front desk' });
      expect(call[2]).toEqual({ headers: { 'Idempotency-Key': key } });
    }
  });

  it('rotate sends grace_hours, and expected_code only for the coach link', async () => {
    post.mockResolvedValue({ data: { code: {}, previous: null, replayed: false } });
    await coachCodesApi.rotate({ id: 'coach-link', code: 'GP-LINK22' }, 24);
    expect(post).toHaveBeenLastCalledWith('/coach/codes/coach-link/rotate', {
      grace_hours: 24,
      expected_code: 'GP-LINK22',
    });
    await coachCodesApi.rotate({ id: 'abc-123', code: 'GP-ROW234' }, 0);
    expect(post).toHaveBeenLastCalledWith('/coach/codes/abc-123/rotate', { grace_hours: 0 });
  });

  it('revoke posts to /coach/codes/:id/revoke', async () => {
    post.mockResolvedValue({ data: { code: { id: 'abc' }, replayed: false } });
    await coachCodesApi.revoke('abc');
    expect(post).toHaveBeenLastCalledWith('/coach/codes/abc/revoke', {});
  });
});

describe('coach code errors', () => {
  it('404 coach_code_tools_disabled (or a bare 404 from an older backend) means tools are off', () => {
    expect(isCodeToolsDisabled(httpError(404, { code: 'coach_code_tools_disabled' }))).toBe(true);
    expect(isCodeToolsDisabled(httpError(404))).toBe(true);
    expect(isCodeToolsDisabled(httpError(404, { code: 'code_not_found' }))).toBe(false);
    expect(isCodeToolsDisabled(httpError(500))).toBe(false);
    expect(isCodeToolsDisabled(new Error('Network Error'))).toBe(false);
  });

  it('maps each server refusal to its own sentence, never the raw server string', () => {
    expect(coachCodesErrorMessage(httpError(409, { code: 'code_rotation_conflict', message: 'raw' }), 'rotate')).toMatch(
      /changed on another device/,
    );
    expect(coachCodesErrorMessage(httpError(403, { code: 'coach_link_head_coach_only' }), 'rotate')).toMatch(/head coach/);
    expect(coachCodesErrorMessage(httpError(409, { code: 'coach_link_not_revocable' }), 'revoke')).toMatch(/Rotate/);
    expect(coachCodesErrorMessage(httpError(400, { code: 'idempotency_key_invalid' }), 'create')).toMatch(/Tap Create/);
    expect(coachCodesErrorMessage(new Error('Network Error'), 'load')).toMatch(/could not be reached/);
    expect(coachCodesErrorMessage(httpError(500, { message: 'PrismaClientKnownRequestError' }), 'rotate')).toMatch(
      /current code still works/,
    );
  });
});
