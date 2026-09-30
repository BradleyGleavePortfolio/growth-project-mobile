const mockGetEntitlement = jest.fn();
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));

import { Platform } from 'react-native';
import { shouldOfferPackagePrompt } from '../packagePromptGate';

describe('shouldOfferPackagePrompt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never offers to an active (comp) entitlement', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, reason: 'comp' } });
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('offers 1:1 packages to an inactive client, including on iOS (3.1.3(d))', async () => {
    expect(Platform.OS).toBe('ios');
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false } });
    expect(await shouldOfferPackagePrompt()).toBe(true);
  });

  it('keeps legacy behaviour on lookup failure', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: false, reason: 'error' });
    expect(await shouldOfferPackagePrompt()).toBe(true);
    mockGetEntitlement.mockRejectedValue(new Error('boom'));
    expect(await shouldOfferPackagePrompt()).toBe(true);
  });
});
