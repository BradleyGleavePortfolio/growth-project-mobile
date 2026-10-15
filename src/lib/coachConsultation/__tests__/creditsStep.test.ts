/**
 * CREDITBUILD-143: KC "Your AI credits." sits after K6/K7 and before K8, in
 * chapter 5, only for a head coach whose pool loaded; the server stores K7
 * for it (its PUT accepts K0-K8 only).
 */
const mockPut = jest.fn();
jest.mock('../../../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), put: (...a: unknown[]) => mockPut(...a), post: jest.fn() },
}));
jest.mock('../../../api/coachSetupApi', () => ({ advanceWizardTo: jest.fn(), coachSetupApi: { complete: jest.fn() } }));

import { STEP_ORDER, nextStep, previousStep, progressFor, resumeStep, visibleSteps, wireStep, type FlowContext } from '../flow';
import { coachConsultApi } from '../api';

const on: FlowContext = { built: new Set(STEP_ORDER), importOn: true, creditsOn: true };
const off: FlowContext = { built: new Set(STEP_ORDER), importOn: true, creditsOn: false };
const notBuilt: FlowContext = { built: new Set(STEP_ORDER.filter((s) => s !== 'KC')), importOn: true, creditsOn: true };
const withClients = { clients_today: '1_10' as const };
const noClients = { clients_today: 'none' as const };

describe('KC in the coach consultation order', () => {
  it('comes after K7 and before K8 for a head coach with a pool', () => {
    expect(visibleSteps(withClients, on)).toEqual(['K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', 'KC', 'K8']);
    expect(nextStep('K6', noClients, on)).toBe('KC');
    expect(nextStep('KC', noClients, on)).toBe('K8');
    expect(previousStep('K8', noClients, on)).toBe('KC');
    expect(previousStep('KC', withClients, on)).toBe('K7');
  });

  it('is skipped without a pool (sub-coach, loading, failed) or with the flag off', () => {
    expect(visibleSteps(withClients, off)).not.toContain('KC');
    expect(visibleSteps(withClients, notBuilt)).not.toContain('KC');
    expect(visibleSteps(withClients, { built: new Set(STEP_ORDER), importOn: true })).not.toContain('KC');
    expect(nextStep('K6', noClients, off)).toBe('K8');
  });

  it('is the last part of chapter 5', () => {
    expect(progressFor('KC', withClients, on)).toEqual({ chapter: 5, position: 3, count: 3, total: 5 });
    expect(progressFor('KC', noClients, on)).toEqual({ chapter: 5, position: 2, count: 2, total: 5 });
    expect(progressFor('K6', noClients, on)).toEqual({ chapter: 5, position: 1, count: 2, total: 5 });
  });

  it('resumes at KC when it is shown, else at the step before it', () => {
    expect(resumeStep('KC', withClients, on)).toBe('KC');
    expect(resumeStep('KC', withClients, off)).toBe('K7');
    expect(resumeStep('KC', noClients, off)).toBe('K6');
  });
});

describe('KC on the wire', () => {
  it('maps KC to K7 and leaves the other steps alone', () => {
    expect(wireStep('KC')).toBe('K7');
    STEP_ORDER.filter((s) => s !== 'KC').forEach((s) => expect(wireStep(s)).toBe(s));
  });

  it('saves a draft paused on KC as K7', async () => {
    mockPut.mockResolvedValueOnce({ data: {} });
    await coachConsultApi.saveDraft({ display_name: 'Jordan' }, 'KC');
    expect(mockPut).toHaveBeenCalledWith('/coach/consultation', expect.objectContaining({ step: 'K7' }));
  });
});
