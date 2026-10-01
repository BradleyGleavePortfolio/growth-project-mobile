const mockGetEntitlement = jest.fn();
jest.mock('../../api/clientPaymentsApi', () => ({
  clientPaymentsApi: { getEntitlement: () => mockGetEntitlement() },
}));

import { Platform } from 'react-native';
import { shouldOfferPackagePrompt } from '../packagePromptGate';

describe('shouldOfferPackagePrompt (fail closed, #304 Sol B1)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('never offers to an active (comp) entitlement', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: true, reason: 'comp' } });
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('never offers when entitlement_active is true even if active is false', async () => {
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false, entitlement_active: true } });
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('offers 1:1 packages only to an explicitly inactive client, including on iOS (3.1.3(d))', async () => {
    expect(Platform.OS).toBe('ios');
    mockGetEntitlement.mockResolvedValue({ ok: true, data: { active: false, entitlement_active: false } });
    expect(await shouldOfferPackagePrompt()).toBe(true);
  });

  it.each([
    ['ok:false error', { ok: false, reason: 'error', message: 'x' }],
    ['ok:false not_configured', { ok: false, reason: 'not_configured' }],
    ['ok:true empty data', { ok: true, data: {} }],
    ['ok:true null data', { ok: true, data: null }],
    ['ok:true active undefined', { ok: true, data: { active: undefined } }],
    ['ok:true active as string', { ok: true, data: { active: 'false' } }],
    ['undefined result', undefined],
  ])('suppresses the prompt on an unknown entitlement: %s', async (_label, value) => {
    mockGetEntitlement.mockResolvedValue(value);
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });

  it('suppresses the prompt when the lookup rejects', async () => {
    mockGetEntitlement.mockRejectedValue(new Error('boom'));
    expect(await shouldOfferPackagePrompt()).toBe(false);
  });
});
