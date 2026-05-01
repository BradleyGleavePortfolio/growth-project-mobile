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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { aiGatewayClient, generateIdempotencyKey } = require('../aiGatewayClient');
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
    const r: AIGatewayDraftDisabled = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags: flagsFor(false, ['coach_brief_draft']) },
    );
    expect(r.status).toBe('disabled');
    expect(r.reason).toBe('feature_flag_off');
    expect(axiosMock.__instance.post).not.toHaveBeenCalled();
  });

  it('returns disabled.feature_flag_off when capability flag is off even if master is on', async () => {
    const r: AIGatewayDraftDisabled = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags: flagsFor(true, []) },
    );
    expect(r.status).toBe('disabled');
    expect(r.reason).toBe('feature_flag_off');
    expect(axiosMock.__instance.post).not.toHaveBeenCalled();
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
    const r: AIGatewayDraftDisabled = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    );
    expect(r.status).toBe('disabled');
    expect(r.reason).toBe('role_denied');
  });

  it('maps 403 → disabled.role_denied', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, headers: {}, data: {} },
    });
    const r: AIGatewayDraftDisabled = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    );
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
    const r: AIGatewayDraftDisabled = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    );
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
    const r: AIGatewayDraftError = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    );
    expect(r.status).toBe('error');
    expect(r.reason).toBe('provider_unavailable');
    expect(r.correlationId).toBe('corr-abc');
  });

  it('maps 400 → error.invalid_input', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, headers: {}, data: {} },
    });
    const r: AIGatewayDraftError = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    );
    expect(r.status).toBe('error');
    expect(r.reason).toBe('invalid_input');
  });

  it('maps no-response (network error) → error.provider_unavailable', async () => {
    axiosMock.__instance.post.mockRejectedValue({
      isAxiosError: true,
      response: undefined,
    });
    const r: AIGatewayDraftError = await aiGatewayClient.createDraft(
      { capability: 'coach_brief_draft' },
      { flags },
    );
    expect(r.status).toBe('error');
    expect(r.reason).toBe('provider_unavailable');
  });

  it('never throws — every failure path returns a typed response', async () => {
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
  it('returns a non-empty mob-prefixed string', () => {
    const k = generateIdempotencyKey();
    expect(k).toMatch(/^mob-/);
    expect(k.length).toBeGreaterThan(8);
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
