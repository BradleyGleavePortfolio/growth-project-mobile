import { featureFlags, NOTIFICATIONS_MOCK_ENABLED } from '../featureFlags';
import { aiGatewayFlags, isAIGatewayCapabilityAllowed } from '../aiGatewayFlags';

describe('ALL-ON-SMOKE-M scratch configuration', () => {
  it.each(Object.entries(featureFlags))('%s is enabled together', (_name, enabled) => {
    expect(enabled).toBe(true);
  });

  it('enables every AI gateway capability and its source badge', () => {
    expect(aiGatewayFlags.aiGatewayEnabled).toBe(true);
    expect(aiGatewayFlags.showSourceBadge).toBe(true);
    for (const capability of Object.keys(aiGatewayFlags.capabilities)) {
      expect(isAIGatewayCapabilityAllowed(
        capability as keyof typeof aiGatewayFlags.capabilities,
      )).toBe(true);
    }
  });

  it('does not substitute mock notification data', () => {
    expect(NOTIFICATIONS_MOCK_ENABLED).toBe(false);
  });
});
