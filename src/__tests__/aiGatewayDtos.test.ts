// AI Gateway — DTO contract tests.
// These pin the discriminated union and the type guards so the UI's
// switch-on-status pattern remains exhaustive as the contract evolves.

import {
  AI_GATEWAY_CAPABILITIES,
  isAIGatewayDisabled,
  isAIGatewayError,
  isAIGatewayOk,
  type AIGatewayDraftDisabled,
  type AIGatewayDraftError,
  type AIGatewayDraftOk,
  type AIGatewayDraftResponse,
} from '../types/aiGateway';

describe('AI Gateway DTOs', () => {
  it('exposes the four capabilities in stable order', () => {
    expect(AI_GATEWAY_CAPABILITIES).toEqual([
      'coach_brief_draft',
      'client_path_summary',
      'check_in_summary',
      'food_log_explain',
    ]);
  });

  it('isAIGatewayOk narrows correctly', () => {
    const ok: AIGatewayDraftOk = {
      status: 'ok',
      draftId: 'd-1',
      capability: 'coach_brief_draft',
      text: 'hi',
      source: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-05-01T00:00:00Z',
        groundedAt: null,
      },
      approval: { actor: null, approvedAt: null },
      isStale: false,
    };
    const r: AIGatewayDraftResponse = ok;
    expect(isAIGatewayOk(r)).toBe(true);
    expect(isAIGatewayDisabled(r)).toBe(false);
    expect(isAIGatewayError(r)).toBe(false);
  });

  it('isAIGatewayDisabled narrows correctly and surfaces every documented reason', () => {
    const reasons: AIGatewayDraftDisabled['reason'][] = [
      'kill_switch',
      'no_provider_key',
      'rate_limited',
      'role_denied',
      'consent_missing',
      'feature_flag_off',
    ];
    for (const reason of reasons) {
      const d: AIGatewayDraftDisabled = {
        status: 'disabled',
        capability: 'coach_brief_draft',
        reason,
      };
      expect(isAIGatewayDisabled(d)).toBe(true);
      expect(isAIGatewayOk(d)).toBe(false);
    }
  });

  it('isAIGatewayError narrows correctly and surfaces every documented reason', () => {
    const reasons: AIGatewayDraftError['reason'][] = [
      'provider_unavailable',
      'timeout',
      'content_blocked',
      'invalid_input',
      'unknown',
    ];
    for (const reason of reasons) {
      const e: AIGatewayDraftError = {
        status: 'error',
        capability: 'coach_brief_draft',
        reason,
      };
      expect(isAIGatewayError(e)).toBe(true);
      expect(isAIGatewayOk(e)).toBe(false);
    }
  });

  it('approval.actor null is the only legal pre-signoff state — UI must not invent an approver', () => {
    // This is a structural assertion: a draft fresh from the gateway has
    // approval.actor === null. The UI component AISourceBadge enforces it
    // at render time; this test pins the TS shape that allows it.
    const fresh: AIGatewayDraftOk = {
      status: 'ok',
      draftId: 'd-1',
      capability: 'coach_brief_draft',
      text: 'hi',
      source: {
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        generatedAt: '2026-05-01T00:00:00Z',
        groundedAt: null,
      },
      approval: { actor: null, approvedAt: null },
      isStale: false,
    };
    expect(fresh.approval.actor).toBeNull();
  });
});
