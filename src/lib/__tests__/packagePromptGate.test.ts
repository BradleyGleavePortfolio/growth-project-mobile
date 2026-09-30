const mockGetEntitlement = jest.fn();
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));
const mockHidden = jest.fn();
jest.mock('../../config/purchaseSurfaces', () => ({ clientPurchasesHidden: () => mockHidden() }));

import { shouldOfferPackagePrompt } from '../packagePromptGate';

describe('shouldOfferPackagePrompt', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never offers on iOS with purchases hidden (no network call)', async () => {
    mockHidden.mockReturnValue(true);
    expect(await shouldOfferPackagePrompt()).toBe(false);
    expect(mockGetEntitlement).not.toHaveBeenCalled();
  });

  it('never offers to an active (comp) entitlement', async () => {
    mockHidden.mockReturnValue(false);
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, reason: 'comp' } });
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('offers to an inactive client when purchases are visible', async () => {
    mockHidden.mockReturnValue(false);
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false } });
    expect(await shouldOfferPackagePrompt()).toBe(true);
  });

  it('keeps legacy behaviour on lookup failure', async () => {
    mockHidden.mockReturnValue(false);
    mockGetEntitlement.mockResolvedValue({ ok: false, reason: 'error' });
    expect(await shouldOfferPackagePrompt()).toBe(true);
    mockGetEntitlement.mockRejectedValue(new Error('boom'));
    expect(await shouldOfferPackagePrompt()).toBe(true);
  });
});
