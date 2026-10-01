/**
 * Box 2 grant / withdrawal with one retry (D2 contract), and the stop check
 * between attempts: a retry never goes out once the step is no longer live
 * (another user signed in after the hand-off, #310 fix round 4).
 */
import { grantRomanWithRetry, withdrawRomanWithRetry } from '../aiConsent';
import type { AiConsentOutcome } from '../../../api/aiConsentApi';

const fail: AiConsentOutcome = { kind: 'error', status: 500 };

describe('grantRomanWithRetry / withdrawRomanWithRetry', () => {
  it('retries once on a failure', async () => {
    const grant = jest.fn(async () => fail);
    await expect(grantRomanWithRetry(grant)).resolves.toBe('failed');
    expect(grant).toHaveBeenCalledTimes(2);
    const withdraw = jest.fn(async () => fail);
    await expect(withdrawRomanWithRetry(withdraw)).resolves.toBe('failed');
    expect(withdraw).toHaveBeenCalledTimes(2);
  });

  it('stops before the retry when the step is no longer live', async () => {
    let live = true;
    const grant = jest.fn(async () => {
      live = false;
      return fail;
    });
    await expect(grantRomanWithRetry(grant, () => live)).resolves.toBe('failed');
    expect(grant).toHaveBeenCalledTimes(1);
    live = true;
    const withdraw = jest.fn(async () => {
      live = false;
      return fail;
    });
    await expect(withdrawRomanWithRetry(withdraw, () => live)).resolves.toBe('failed');
    expect(withdraw).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the step is not live at the start', async () => {
    const grant = jest.fn(async () => fail);
    await expect(grantRomanWithRetry(grant, () => false)).resolves.toBe('failed');
    expect(grant).not.toHaveBeenCalled();
  });

  it('404 / 503 are not retried (ledger off)', async () => {
    const grant = jest.fn(async (): Promise<AiConsentOutcome> => ({ kind: 'unavailable', status: 503 }));
    await expect(grantRomanWithRetry(grant)).resolves.toBe('unavailable');
    expect(grant).toHaveBeenCalledTimes(1);
  });
});
