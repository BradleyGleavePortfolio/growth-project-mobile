/**
 * ROMAN-HOLD-M (#197-D3): reportMessage sends POST /roman/messages/:id/report (backend #1223)
 * with the DM report body (wire reason, folded label, 1000-character details) and no message
 * text; a repeat answers already_reported; errors arrive as RomanApiError for the report sheet.
 */
import axios from 'axios';
import { RomanApiError, RomanWireError, reportMessage } from '../romanApi';
import { DETAILS_MAX } from '../messagesApi';

jest.mock('../../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
jest.mock('../../services/secureStorage', () => ({ secureStorage: { getItem: jest.fn(async () => 'test-token') } }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const api = require('../../services/api').default as { post: jest.Mock };

const httpError = (status: number) =>
  Object.assign(new axios.AxiosError('fail'), { response: { status, data: {}, headers: {} } });

beforeEach(() => api.post.mockReset());

describe('romanApi.reportMessage', () => {
  it('posts the reason and details only, to the reply id route', async () => {
    api.post.mockResolvedValueOnce({ data: { reportId: 'rep-1', status: 'received' } });
    await expect(reportMessage('cm-1', { reason: 'harassment', details: 'Rude.' })).resolves.toEqual({
      reportId: 'rep-1', status: 'received',
    });
    expect(api.post).toHaveBeenCalledWith('/roman/messages/cm-1/report', { reason: 'harassment', details: 'Rude.' });
  });

  it('folds a phone-only reason into the wider wire reason with its label, capped at the details limit', async () => {
    api.post.mockResolvedValueOnce({ data: { reportId: 'rep-1', status: 'received' } });
    await reportMessage('cm-1', { reason: 'hate_speech', details: 'x'.repeat(2000) });
    const body = api.post.mock.calls[0][1];
    expect(body.reason).toBe('harassment');
    expect(body.details.startsWith('Hate speech. ')).toBe(true);
    expect(body.details).toHaveLength(DETAILS_MAX);
  });

  it('a repeat is not a second report: already_reported comes back as a success', async () => {
    api.post.mockResolvedValueOnce({ data: { reportId: 'rep-1', status: 'already_reported' } });
    await expect(reportMessage('cm-1', { reason: 'spam' })).resolves.toEqual({ reportId: 'rep-1', status: 'already_reported' });
  });

  it('encodes the id and refuses an empty one', async () => {
    api.post.mockResolvedValueOnce({ data: { reportId: 'rep-1', status: 'received' } });
    await reportMessage('a/b', { reason: 'spam' });
    expect(api.post.mock.calls[0][0]).toBe('/roman/messages/a%2Fb/report');
    await expect(reportMessage('', { reason: 'spam' })).rejects.toThrow('messageId required');
  });

  it('offline, not found and a changed answer all throw, so the sheet says so', async () => {
    api.post.mockRejectedValueOnce(new axios.AxiosError('Network Error'));
    await expect(reportMessage('cm-1', { reason: 'spam' })).rejects.toMatchObject({ kind: 'offline' });
    api.post.mockRejectedValueOnce(httpError(404));
    await expect(reportMessage('cm-1', { reason: 'spam' })).rejects.toBeInstanceOf(RomanApiError);
    api.post.mockResolvedValueOnce({ data: { ok: true } });
    await expect(reportMessage('cm-1', { reason: 'spam' })).rejects.toBeInstanceOf(RomanWireError);
  });
});
