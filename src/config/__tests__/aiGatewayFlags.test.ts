// AI Gateway feature-flag tests. Pin the fail-closed defaults and the
// per-capability gating helper.

import { isAIGatewayCapabilityAllowed } from '../aiGatewayFlags';
import type { AIGatewayFlags } from '../aiGatewayFlags';

function flags(over: Partial<AIGatewayFlags> = {}): AIGatewayFlags {
  return {
    aiGatewayEnabled: false,
    capabilities: {
      coach_brief_draft: false,
      client_path_summary: false,
      check_in_summary: false,
      food_log_explain: false,
    },
    showSourceBadge: true,
    ...over,
  };
}

describe('isAIGatewayCapabilityAllowed', () => {
  it('returns false when master flag is off, regardless of capability flag', () => {
    const f = flags({
      aiGatewayEnabled: false,
      capabilities: {
        coach_brief_draft: true,
        client_path_summary: true,
        check_in_summary: true,
        food_log_explain: true,
      },
    });
    expect(isAIGatewayCapabilityAllowed('coach_brief_draft', f)).toBe(false);
    expect(isAIGatewayCapabilityAllowed('client_path_summary', f)).toBe(false);
  });

  it('returns false when master flag is on but capability flag is off', () => {
    const f = flags({ aiGatewayEnabled: true });
    expect(isAIGatewayCapabilityAllowed('coach_brief_draft', f)).toBe(false);
  });

  it('returns true only when both flags are on', () => {
    const f = flags({
      aiGatewayEnabled: true,
      capabilities: {
        coach_brief_draft: true,
        client_path_summary: false,
        check_in_summary: false,
        food_log_explain: false,
      },
    });
    expect(isAIGatewayCapabilityAllowed('coach_brief_draft', f)).toBe(true);
    expect(isAIGatewayCapabilityAllowed('client_path_summary', f)).toBe(false);
  });
});
