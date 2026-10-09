const mockApi = { get: jest.fn(), put: jest.fn(), post: jest.fn() };
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockApi.get(...a),
    put: (...a: unknown[]) => mockApi.put(...a),
    post: (...a: unknown[]) => mockApi.post(...a),
  },
}));
const mockAdvance = jest.fn();
const mockWizardComplete = jest.fn();
jest.mock('../../../api/coachSetupApi', () => ({
  advanceWizardTo: (...a: unknown[]) => mockAdvance(...a),
  coachSetupApi: { complete: () => mockWizardComplete() },
}));

import { coachConsultApi } from '../api';

const notFound = Object.assign(new Error('nf'), { response: { status: 404 } });
const answers = { display_name: 'Jordan Reyes', clients_today: 'none' as const, link_shared: true };

beforeEach(() => jest.clearAllMocks());

describe('coach consultation API (works on the current production backend)', () => {
  it('completes through POST /coach/consultation/complete with backend keys only', async () => {
    mockApi.post.mockResolvedValueOnce({ data: { status: 'complete' } });
    await coachConsultApi.complete(answers);
    expect(mockApi.post).toHaveBeenCalledWith(
      '/coach/consultation/complete',
      expect.not.objectContaining({ link_shared: expect.anything() }),
    );
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('falls back to the existing wizard completion when the route is not deployed (404)', async () => {
    mockApi.post.mockRejectedValueOnce(notFound);
    mockAdvance.mockResolvedValueOnce({});
    mockWizardComplete.mockResolvedValueOnce({});
    await coachConsultApi.complete(answers);
    expect(mockAdvance).toHaveBeenCalledWith(6, {
      coach_consultation: expect.objectContaining({ display_name: 'Jordan Reyes', clients_today: 'none' }),
    });
    expect(mockWizardComplete).toHaveBeenCalled();
  });

  it('surfaces other failures so the coach can try again', async () => {
    mockApi.post.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 500 } }));
    await expect(coachConsultApi.complete(answers)).rejects.toThrow('x');
    expect(mockAdvance).not.toHaveBeenCalled();
  });

  it('treats a missing draft route as local-only and reads a deployed one', async () => {
    mockApi.put.mockRejectedValueOnce(notFound);
    expect(await coachConsultApi.saveDraft(answers, 'K2')).toBe('unavailable');
    mockApi.get.mockRejectedValueOnce(notFound);
    expect(await coachConsultApi.load()).toBeNull();
    mockApi.get.mockResolvedValueOnce({
      data: { status: 'in_progress', step: 'K3', answers: { display_name: 'Jordan', clients_today: 'none' }, updated_at: 'x' },
    });
    expect(await coachConsultApi.load()).toEqual({
      status: 'in_progress',
      step: 'K3',
      answers: { display_name: 'Jordan', clients_today: 'none' },
      updatedAt: 'x',
    });
  });
});
