/**
 * AI Gateway — typed mobile client.
 *
 * All AI traffic from the app flows through this client. The backend gateway
 * is the only path to a model provider; this file holds zero provider keys
 * and never imports a provider SDK.
 *
 * Responsibilities:
 *   1. Apply the mobile master flag and per-capability flag *before* hitting
 *      the network — when either is off, return a synthesised `disabled`
 *      response shape so callers can render the disabled UX uniformly.
 *   2. Coerce the gateway's HTTP responses (200 OK, 4xx capability-disabled,
 *      5xx provider failure) into the discriminated `AIGatewayDraftResponse`
 *      union. The UI is forced by the type system to handle every case.
 *   3. Generate idempotency keys when the caller doesn't supply one.
 *
 * Backend contract (from the AI Gateway design doc):
 *   POST /ai/gateway/drafts        → AIGatewayDraftResponse
 *   GET  /ai/gateway/status        → AIGatewayStatusResponse
 *
 * Until the backend ships, all calls return `disabled.feature_flag_off` when
 * the master flag is off — the default in production. Live calls only happen
 * once an operator flips `EXPO_PUBLIC_FF_AI_GATEWAY=1` AND a per-capability
 * flag in a build.
 */

import { AxiosError } from 'axios';
import api from './api';
import {
  aiGatewayFlags,
  isAIGatewayCapabilityAllowed,
  type AIGatewayFlags,
} from '../config/aiGatewayFlags';
import type {
  AIGatewayCapability,
  AIGatewayDraftRequest,
  AIGatewayDraftResponse,
  AIGatewayDraftDisabled,
  AIGatewayDraftError,
  AIGatewayStatusResponse,
} from '../types/aiGateway';

// ─── Idempotency key ───────────────────────────────────────────────────────
// Cheap, collision-resistant enough for short-window dedupe. Backend persists
// the key for ~10 minutes; longer windows would require a UUID lib import.
function generateIdempotencyKey(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `mob-${Date.now().toString(36)}-${rand}`;
}

// ─── Synthesised fail-closed responses ─────────────────────────────────────
// When the mobile flag is off we never touch the network. Callers still get a
// typed response so the UI's switch over `status` covers every path.
function flagOffResponse(
  capability: AIGatewayCapability,
): AIGatewayDraftDisabled {
  return {
    status: 'disabled',
    capability,
    reason: 'feature_flag_off',
    summary: null,
    retryAfter: null,
  };
}

function networkErrorResponse(
  capability: AIGatewayCapability,
  err: AxiosError,
): AIGatewayDraftError | AIGatewayDraftDisabled {
  // No HTTP response → treat as a transient provider/transport failure.
  if (!err.response) {
    return {
      status: 'error',
      capability,
      reason: 'provider_unavailable',
      correlationId: null,
    };
  }
  const status = err.response.status;
  // 401 is handled by the api.ts refresh interceptor; if we reach here the
  // refresh itself failed and the user will be logged out. Surface as
  // disabled so the UI doesn't double-render an error toast on top.
  if (status === 401 || status === 403) {
    return {
      status: 'disabled',
      capability,
      reason: 'role_denied',
      summary: null,
      retryAfter: null,
    };
  }
  if (status === 429) {
    const retryAfter = (err.response.headers as Record<string, string> | undefined)?.[
      'retry-after'
    ];
    return {
      status: 'disabled',
      capability,
      reason: 'rate_limited',
      summary: null,
      retryAfter: retryAfter ?? null,
    };
  }
  if (status >= 500 && status < 600) {
    return {
      status: 'error',
      capability,
      reason: 'provider_unavailable',
      correlationId:
        (err.response.data as { correlation_id?: string } | undefined)
          ?.correlation_id ?? null,
    };
  }
  // 400-class catch-all: invalid input.
  return {
    status: 'error',
    capability,
    reason: 'invalid_input',
    correlationId: null,
  };
}

// ─── Public client ─────────────────────────────────────────────────────────
export interface AIGatewayClientDeps {
  flags?: AIGatewayFlags;
}

export const aiGatewayClient = {
  /**
   * Generate an unsigned draft. Always returns one of the three discriminated
   * shapes; never throws for HTTP/transport errors. Callers must `switch` on
   * `status` and render the matching UX state.
   */
  async createDraft(
    req: Omit<AIGatewayDraftRequest, 'idempotencyKey'> & {
      idempotencyKey?: string;
    },
    deps: AIGatewayClientDeps = {},
  ): Promise<AIGatewayDraftResponse> {
    const flags = deps.flags ?? aiGatewayFlags;
    if (!isAIGatewayCapabilityAllowed(req.capability, flags)) {
      return flagOffResponse(req.capability);
    }
    const idempotencyKey = req.idempotencyKey ?? generateIdempotencyKey();
    try {
      const resp = await api.post<AIGatewayDraftResponse>(
        '/ai/gateway/drafts',
        {
          capability: req.capability,
          subject_ref: req.subjectRef
            ? { kind: req.subjectRef.kind, id: req.subjectRef.id }
            : undefined,
          user_intent: req.userIntent,
          idempotency_key: idempotencyKey,
        },
      );
      return resp.data;
    } catch (err) {
      return networkErrorResponse(req.capability, err as AxiosError);
    }
  },

  /**
   * Fetch the gateway's capability status. Returns a synthesised
   * fail-closed response when the master flag is off so callers can use a
   * single render path.
   */
  async getStatus(
    deps: AIGatewayClientDeps = {},
  ): Promise<AIGatewayStatusResponse> {
    const flags = deps.flags ?? aiGatewayFlags;
    if (!flags.aiGatewayEnabled) {
      return {
        available: false,
        capabilities: [
          { capability: 'coach_brief_draft', enabled: false, reason: 'feature_flag_off' },
          { capability: 'client_path_summary', enabled: false, reason: 'feature_flag_off' },
          { capability: 'check_in_summary', enabled: false, reason: 'feature_flag_off' },
          { capability: 'food_log_explain', enabled: false, reason: 'feature_flag_off' },
        ],
        summary: null,
      };
    }
    try {
      const resp = await api.get<AIGatewayStatusResponse>(
        '/ai/gateway/status',
      );
      return resp.data;
    } catch {
      return {
        available: false,
        capabilities: [],
        summary: null,
      };
    }
  },
};

// Exported for tests and any caller that needs to short-circuit on flags
// without invoking the client.
export { generateIdempotencyKey };
