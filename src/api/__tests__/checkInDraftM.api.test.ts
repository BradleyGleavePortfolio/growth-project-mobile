/**
 * CHECKIN-DRAFT-M: the wire bytes, as units. Decide (PATCH /ai/gateway/drafts/:id) carries {payload: {body}} only
 * when the coach saved an edit; the draft report (POST /ai/gateway/drafts/:id/report) carries {reason} and no other
 * key (backend ReportAiDraftDto, forbidNonWhitelisted); Home's ask-first invoke without a check-in sends today's bytes
 * (case 22). services/api mocked at its edge.
 */
const mockPost = jest.fn();
const mockPatch = jest.fn();
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => mockPost(...a), patch: (...a: unknown[]) => mockPatch(...a), get: jest.fn() },
}));

import { coachAiExecutionApi, _setMockModeForTesting } from '../coachAiExecutionApi';
import { askRomanToDraft } from '../../screens/coach/home-v11/DraftSheets';

beforeEach(() => {
  _setMockModeForTesting('off');
  mockPost.mockReset().mockResolvedValue({ data: {} });
  mockPatch.mockReset().mockResolvedValue({ data: { id: 'd-1', status: 'approved' } });
});

describe('approveDraft', () => {
  it('without an edit sends {decision} and no payload key (every current caller)', async () => {
    await coachAiExecutionApi.approveDraft('d-1');
    expect(mockPatch).toHaveBeenCalledTimes(1);
    const [url, body] = mockPatch.mock.calls[0];
    expect(url).toBe('/ai/gateway/drafts/d-1');
    expect(body).toEqual({ decision: 'approved' });
    expect('payload' in body).toBe(false);
  });

  it('with a saved edit sends {decision, payload: {body}}', async () => {
    await coachAiExecutionApi.approveDraft('d-1', undefined, { body: 'My words.' });
    expect(mockPatch.mock.calls[0]).toEqual(['/ai/gateway/drafts/d-1', { decision: 'approved', payload: { body: 'My words.' } }]);
  });

  it('rejectDraft is unchanged: {decision: rejected}', async () => {
    await coachAiExecutionApi.rejectDraft('d-1');
    expect(mockPatch.mock.calls[0]).toEqual(['/ai/gateway/drafts/d-1', { decision: 'rejected' }]);
  });
});

describe('reportDraft', () => {
  it('posts {reason} only to the draft report route and returns the answer', async () => {
    mockPost.mockResolvedValue({ data: { reportId: 'd-1', status: 'already_reported' } });
    await expect(coachAiExecutionApi.reportDraft('d 1', 'self_harm')).resolves.toEqual({ reportId: 'd-1', status: 'already_reported' });
    expect(mockPost.mock.calls).toEqual([['/ai/gateway/drafts/d%201/report', { reason: 'self_harm' }]]);
    expect(Object.keys(mockPost.mock.calls[0][1])).toEqual(['reason']);
  });
});

describe('case 22: askRomanToDraft', () => {
  const answer = { data: { enabled: true, provider: 'anthropic', reply: ' Hi. ', approval: { required: true, status: 'pending', draft_id: 'd-1' } } };

  it("Home's ask without check_in_id sends today's bytes", async () => {
    mockPost.mockResolvedValue(answer);
    const request = { capability: 'draft.coach_message' as const, subject_user_id: 'client-1', message: 'Write a short check-in.' };
    await expect(askRomanToDraft(request)).resolves.toEqual({ draftId: 'd-1', reply: 'Hi.' });
    expect(mockPost.mock.calls).toEqual([['/ai/gateway/invoke', { capability: 'draft.coach_message', subject_user_id: 'client-1', message: 'Write a short check-in.' }]]);
    expect(JSON.stringify(mockPost.mock.calls[0][1])).toBe('{"capability":"draft.coach_message","subject_user_id":"client-1","message":"Write a short check-in."}');
  });

  it('the plan-ended ask still posts {} to its own route', async () => {
    mockPost.mockResolvedValue(answer);
    await askRomanToDraft({ capability: 'draft.coach_message', subject_user_id: 'client-1', message: '' }, 'client-1');
    expect(mockPost.mock.calls).toEqual([['/v1/coach/churned-clients/client-1/draft', {}]]);
  });

  it('a check-in ask sends exactly {capability, subject_user_id, message: "", check_in_id}', async () => {
    mockPost.mockResolvedValue(answer);
    await askRomanToDraft({ capability: 'draft.coach_message', subject_user_id: 'client-1', message: '', check_in_id: 'ci-1' });
    expect(JSON.stringify(mockPost.mock.calls[0][1])).toBe('{"capability":"draft.coach_message","subject_user_id":"client-1","message":"","check_in_id":"ci-1"}');
  });

  it.each([
    [{ data: { enabled: false, provider: 'stub', reply: '', approval: { required: false, status: 'not_required', draft_id: null } } }],
    [{ data: { enabled: true, provider: 'anthropic', reply: '   ', approval: { required: true, status: 'pending', draft_id: 'd-1' } } }],
  ])('a stub or blank answer is null (nothing can be sent) %#', async (res) => {
    mockPost.mockResolvedValue(res);
    await expect(askRomanToDraft({ capability: 'draft.coach_message', subject_user_id: 'client-1', message: '', check_in_id: 'ci-1' })).resolves.toBeNull();
  });
});
