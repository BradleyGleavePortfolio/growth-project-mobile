/**
 * S-SCHED-3 (mobile #325 fix round): the call-link contract matches the
 * backend (`MEETING_LINK_PATTERN`: https or a bounded tel: number), every
 * other scheme stays "no link", and the session list sends the compound
 * (start_at, id) cursor, the status filter and expected_start_at.
 */
import api from '../../services/api';
import {
  normalizeCallLinkInput,
  resolveCallLink,
  resolveVideoUrl,
  schedulingApi,
} from '../schedulingApi';

jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

const get = jest.mocked(api.get);
const post = jest.mocked(api.post);

beforeEach(() => {
  jest.clearAllMocks();
  get.mockResolvedValue({ data: [] });
  post.mockResolvedValue({ data: { id: 's1' } });
});

describe('resolveCallLink', () => {
  it('resolves a backend-ready phone link to a dialable tel: URL', () => {
    expect(resolveCallLink('tel:+1 425 555 0100')).toEqual({
      kind: 'phone',
      url: 'tel:+14255550100',
      display: '+1 425 555 0100',
    });
    expect(resolveCallLink('tel:(425) 555-0100')).toEqual({
      kind: 'phone',
      url: 'tel:4255550100',
      display: '(425) 555-0100',
    });
  });

  it('keeps https video links and rejects every other scheme or credential link', () => {
    expect(resolveCallLink('https://meet.example/room')).toEqual({ kind: 'video', url: 'https://meet.example/room' });
    for (const bad of [
      'tgp-stub://session/1',
      'http://meet.example/room',
      'javascript:alert(1)',
      'sms:+14255550100',
      'tel:call-me',
      'tel:12',
      'tel:+1 425 555 0100;ext=9',
      'https://user:pw@meet.example/room',
      'https://',
      '',
      null,
    ]) {
      expect(resolveCallLink(bad)).toBeNull();
    }
    expect(resolveVideoUrl('tel:+14255550100')).toBeNull();
    expect(resolveVideoUrl('https://meet.example/room')).toBe('https://meet.example/room');
  });
});

describe('normalizeCallLinkInput (coach entry)', () => {
  it('accepts an https link, a bare phone number or a tel: link', () => {
    expect(normalizeCallLinkInput(' https://meet.example/room ')).toEqual({ ok: true, url: 'https://meet.example/room' });
    expect(normalizeCallLinkInput('+1 425 555 0100')).toEqual({ ok: true, url: 'tel:+14255550100' });
    expect(normalizeCallLinkInput('tel:425.555.0100')).toEqual({ ok: true, url: 'tel:4255550100' });
  });

  it('refuses anything else with a next step', () => {
    for (const bad of ['http://meet.example', 'call me', 'javascript:alert(1)', 'https://a:b@meet.example/x']) {
      const r = normalizeCallLinkInput(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/https call link .* or a phone number .* tap Save call link\./);
    }
  });
});

describe('session list and transitions on the wire', () => {
  it('past pages send before + before_id; upcoming pages send after + after_id and the status filter', async () => {
    await schedulingApi.listMySessions(20, { scope: 'past', before: '2026-09-30T17:00:00.000Z', beforeId: 'sess-9' });
    expect(get).toHaveBeenLastCalledWith('/scheduling/sessions', {
      params: { limit: '20', scope: 'past', before: '2026-09-30T17:00:00.000Z', before_id: 'sess-9' },
    });
    await schedulingApi.listMySessions(50, {
      status: ['scheduled', 'pending_provider'],
      after: '2026-10-06T17:00:00.000Z',
      afterId: 'sess-3',
    });
    expect(get).toHaveBeenLastCalledWith('/scheduling/sessions', {
      params: {
        limit: '50',
        after: '2026-10-06T17:00:00.000Z',
        after_id: 'sess-3',
        status: 'scheduled,pending_provider',
      },
    });
    // An id without its time is never sent (the server would refuse it).
    await schedulingApi.listMySessions(20, { scope: 'past', beforeId: 'sess-9' });
    expect(get).toHaveBeenLastCalledWith('/scheduling/sessions', { params: { limit: '20', scope: 'past' } });
  });

  it('approve and decline carry the start time the coach saw', async () => {
    await schedulingApi.approveSession('s1', { expected_start_at: '2026-10-06T17:00:00.000Z' });
    expect(post).toHaveBeenLastCalledWith('/scheduling/sessions/s1/approve', {
      expected_start_at: '2026-10-06T17:00:00.000Z',
    });
    await schedulingApi.declineSession('s1', { expected_start_at: '2026-10-06T17:00:00.000Z' });
    expect(post).toHaveBeenLastCalledWith('/scheduling/sessions/s1/decline', {
      expected_start_at: '2026-10-06T17:00:00.000Z',
    });
  });
});
