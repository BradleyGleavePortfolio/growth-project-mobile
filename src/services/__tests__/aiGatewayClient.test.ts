// AI Gateway client — covers the fail-closed paths and HTTP-status mapping.
// Mirrors the existing apiClients.test.ts mocking pattern: install the axios
// mock BEFORE requiring the modules under test so the api.ts singleton binds
// to our fakes.

jest.mock('axios', () => {
  const request = jest.fn();
  const instance = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    request,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
    },
    __instance: instance,
  };
});

const axiosMock = jest.requireMock('axios') as {
  __instance: {
    get: jest.Mock;
    post: jest.Mock;
  };
};

import {
  aiGatewayClient,
  generateIdempotencyKey,
  AIUnavailableError,
} from '../aiGatewayClient';
import type {
  AIGatewayCapability,
  AIGatewayDraftOk,
  AIGatewayDraftDisabled,
  AIGatewayDraftError,
  AIGatewayStatusResponse,
} from '../../types/aiGateway';
import type { AIGatewayFlags } from '../../config/aiGatewayFlags';

function flagsFor(
  master: boolean,
  enabledCapabilities: AIGatewayCapability[],
): AIGatewayFlags {
  return {
    aiGatewayEnabled: master,
    capabilities: {
      coach_brief_draft: enabledCapabilities.includes('coach_brief_draft'),
      client_path_summary: enabledCapabilities.includes('client_path_summary'),
      check_in_summary: enabledCapabilities.includes('check_in_summary'),
      food_log_explain: enabledCapabilities.includes('food_log_explain'),
    },
    showSourceBadge: true,
  };
}

describe('aiGatewayClient.createDraft — fail-closed flag gates', () => {
  beforeEach(() => {
    axiosMock.__instance.post.mockReset();
    axiosMock.__instance.get.mockReset();
  });

  it('returns disabled.feature_flag_off when master flag is off, without hitting the network', async () => {
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags: flagsFor(false, ['coach_brief_draft']) },
    )) as AIGatewayDraftDisabled;
    expect(r.status).toBe('disabled');
    expect(r.reason).toBe('feature_flag_off');
    expect(axiosMock.__instance.post).not.toHaveBeenCalled();
  });

  it('returns disabled.feature_flag_off when capability flag is off even if master is on', async () => {
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags: flagsFor(true, []) },
    )) as AIGatewayDraftDisabled;
    expect(r.status).toBe('disabled');
    expect(r.reason).toBe('feature_flag_off');
    expect(axiosMock.__instance.post).not.toHaveBeenCalled();
  });

  // ── Fail-closed stub detection: each variant must THROW an
  // AIUnavailableError. A return-based discriminated union member can be
  // silently ignored by a forgetful caller; an exception forces handling.

  it('throws AIUnavailableError when top-level enabled:false on a 200', async () => {
    axiosMock.__instance.post.mockResolvedValue({
      data: { enabled: false, meta: { reason: 'no_provider_key' } },
    });
    await expect(
      aiGatewayClient.createDraft(
        { capability: 'coach_brief_draft' },
        { flags: flagsFor(true, ['coach_brief_draft']) },
      ),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it('throws AIUnavailableError when top-level provider:"stub" on a 200 (enabled absent)', async () => {
    axiosMock.__instance.post.mockResolvedValue({
      data: {
        provider: 'stub',
        meta: { reason: 'no_provider_key' },
      },
    });
    let caught: unknown = null;
    try {
      await aiGatewayClient.createDraft(
        { capability: 'coach_brief_draft' },
        { flags: flagsFor(true, ['coach_brief_draft']) },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AIUnavailableError);
    expect((caught as InstanceType<typeof AIUnavailableError>).reason).toBe(
      'no_provider_key',
    );
    expect((caught as InstanceType<typeof AIUnavailableError>).capability).toBe(
      'coach_brief_draft',
    );
  });

  it('throws AIUnavailableError when nested source.provider:"stub" on a 200', async () => {
    axiosMock.__instance.post.mockResolvedValue({
      data: {
        status: 'ok',
        draftId: 'd-1',
        capability: 'coach_brief_draft',
        text: '[ai-disabled]',
        source: {
          provider: 'stub',
          model: 'stub',
          generatedAt: '2026-05-01T00:00:00Z',
          groundedAt: null,
        },
        approval: { actor: null, approvedAt: null },
        isStale: false,
      },
    });
    await expect(
      aiGatewayClient.createDraft(
        { capability: 'coach_brief_draft' },
        { flags: flagsFor(true, ['coach_brief_draft']) },
      ),
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it('throws AIUnavailableError when nested source.provider:"stub" AND enabled:false', async () => {
    axiosMock.__instance.post.mockResolvedValue({
      data: {
        enabled: false,
        status: 'ok',
        source: {
          provider: 'stub',
          model: 'stub',
          generatedAt: '2026-05-01T00:00:00Z',
          groundedAt: null,
        },
        meta: { reason: 'kill_switch' },
      },
    });
    let caught: unknown = null;
    try {
      await aiGatewayClient.createDraft(
        { capability: 'check_in_summary' },
        { flags: flagsFor(true, ['check_in_summary']) },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AIUnavailableError);
    expect((caught as InstanceType<typeof AIUnavailableError>).reason).toBe(
      'kill_switch',
    );
  });

  it('issues the request with an auto-generated idempotency key when flags allow', async () => {
    axiosMock.__instance.post.mockResolvedValue({
      data: {
        status: 'ok',
        draftId: 'd-1',
        capability: 'coach_brief_draft',
        text: 'hello',
        source: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          generatedAt: '2026-05-01T00:00:00Z',
          groundedAt: null,
        },
        approval: { actor: null, approvedAt: null },
        isStale: false,
      },
    });
    const r = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft', userIntent: 'protein focus' },
      { flags: flagsFor(true, ['coach_brief_draft']) },
    );
    expect(r.status).toBe('ok');
    const call = axiosMock.__instance.post.mock.calls[0];
    expect(call[0]).toBe('/ai/gateway/drafts');
    expect(call[1].capability).toBe('coach_brief_draft');
    expect(call[1].user_intent).toBe('protein focus');
    expect(typeof call[1].idempotency_key).toBe('string');
    expect(call[1].idempotency_key.length).toBeGreaterThan(4);
  });
});

describe('aiGatewayClient.createDraft — HTTP error mapping', () => {
  const flags = flagsFor(true, ['coach_brief_draft']);
  beforeEach(() => {
    axiosMock.__instance.post.mockReset();
  });

  it('maps 401 → disabled.role_denied (401 is handled by api.ts but mapped defensively)', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, headers: {}, data: {} },
    });
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    )) as AIGatewayDraftDisabled;
    expect(r.status).toBe('disabled');
    expect(r.reason).toBe('role_denied');
  });

  it('maps 403 → disabled.role_denied', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, headers: {}, data: {} },
    });
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    )) as AIGatewayDraftDisabled;
    expect(r.reason).toBe('role_denied');
  });

  it('maps 429 → disabled.rate_limited and surfaces retry-after', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 429,
        headers: { 'retry-after': '60' },
        data: {},
      },
    });
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    )) as AIGatewayDraftDisabled;
    expect(r.status).toBe('disabled');
    expect(r.reason).toBe('rate_limited');
    expect(r.retryAfter).toBe('60');
  });

  it('maps 500 → error.provider_unavailable and surfaces correlation_id', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 500,
        headers: {},
        data: { correlation_id: 'corr-abc' },
      },
    });
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    )) as AIGatewayDraftError;
    expect(r.status).toBe('error');
    expect(r.reason).toBe('provider_unavailable');
    expect(r.correlationId).toBe('corr-abc');
  });

  it('maps 400 → error.invalid_input', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, headers: {}, data: {} },
    });
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    )) as AIGatewayDraftError;
    expect(r.status).toBe('error');
    expect(r.reason).toBe('invalid_input');
  });

  it('maps no-response (network error) → error.provider_unavailable', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: undefined,
    });
    const r = (await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    )) as AIGatewayDraftError;
    expect(r.status).toBe('error');
    expect(r.reason).toBe('provider_unavailable');
  });

  it('does not throw on HTTP/transport failures — those still map to typed responses', async () => {
    // Stub-detection on a 200 is the only path that throws (see fail-closed
    // suite above). HTTP errors continue to map into the discriminated union
    // so the UI can branch on `status` + `reason`.
    axiosMock.__instance.post.mockRejectedValue(new Error('boom'));
    await expect(
      aiGatewayClient.createDraft(
        { capability: 'coach_brief_draft' },
        { flags },
      ),
    ).resolves.toBeDefined();
  });
});

describe('aiGatewayClient.getStatus', () => {
  beforeEach(() => {
    axiosMock.__instance.get.mockReset();
  });

  it('returns a synthesised unavailable status when master flag is off', async () => {
    const r: AIGatewayStatusResponse = await aiGatewayClient.getStatus({
      flags: flagsFor(false, []),
    });
    expect(r.available).toBe(false);
    expect(r.capabilities).toHaveLength(4);
    for (const c of r.capabilities) {
      expect(c.enabled).toBe(false);
      expect(c.reason).toBe('feature_flag_off');
    }
    expect(axiosMock.__instance.get).not.toHaveBeenCalled();
  });

  it('passes through the gateway response when the call succeeds', async () => {
    const live: AIGatewayStatusResponse = {
      available: true,
      capabilities: [
        { capability: 'coach_brief_draft', enabled: true },
        { capability: 'client_path_summary', enabled: false, reason: 'consent_missing' },
        { capability: 'check_in_summary', enabled: false, reason: 'feature_flag_off' },
        { capability: 'food_log_explain', enabled: false, reason: 'feature_flag_off' },
      ],
      summary: null,
    };
    axiosMock.__instance.get.mockResolvedValue({ data: live });
    const r = await aiGatewayClient.getStatus({
      flags: flagsFor(true, ['coach_brief_draft']),
    });
    expect(r).toEqual(live);
  });

  it('returns unavailable when the gateway throws', async () => {
    axiosMock.__instance.get.mockRejectedValue(new Error('network'));
    const r = await aiGatewayClient.getStatus({
      flags: flagsFor(true, ['coach_brief_draft']),
    });
    expect(r.available).toBe(false);
  });
});

describe('generateIdempotencyKey', () => {
  // R19: idempotency keys must come from a cryptographically secure source.
  // The helper returns a 36-character RFC 4122 v4 UUID from crypto.randomUUID
  // when available, or an expo-crypto-derived UUID. There is no Math.random
  // fallback.
  const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('returns a 36-character RFC 4122 v4 UUID', () => {
    const k = generateIdempotencyKey();
    expect(k).toHaveLength(36);
    expect(k).toMatch(UUID_V4_RE);
  });

  it('returns distinct keys on successive calls', () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toBe(b);
  });
});

// Reference: forces the OK shape to be assignable so future shape drift on
// AIGatewayDraftOk surfaces here as a TS error rather than at runtime.
const _exampleOk: AIGatewayDraftOk = {
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
void _exampleOk;
