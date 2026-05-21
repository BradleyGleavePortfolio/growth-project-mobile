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
 *   POST /ai/gateway/drafts        → AIGatewayDraftOk on 200; mapped to disabled/error on 4xx/5xx
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
import { AIUnavailableError } from './aiGatewayErrors';

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
   * Generate an unsigned draft.
   *
   * Returns one of `AIGatewayDraftResponse`'s discriminated shapes for the
   * cases the UI can branch on (flag-off, HTTP error mapping). THROWS
   * `AIUnavailableError` when the gateway returns HTTP 200 with a degraded
   * pathway (`enabled:false`, top-level or nested `provider:'stub'`). The
   * throw is the runtime fail-closed guarantee from Rule 9 — a discriminated
   * union member can be silently ignored at a call site; an exception cannot.
   * Callers must catch `AIUnavailableError` and render the "AI temporarily
   * unavailable" UX.
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
    let resp;
    try {
      resp = await api.post<
        import('../types/aiGateway').AIGatewayDraftOk & {
          enabled?: boolean;
          provider?: string;
          meta?: { reason?: string };
        }
      >('/ai/gateway/drafts', {
        capability: req.capability,
        user_intent: req.userIntent ?? '',
        subject_user_id: req.subjectRef?.id,
        proposed_action: req.proposedAction,
        idempotency_key: idempotencyKey,
      });
    } catch (err) {
      return networkErrorResponse(req.capability, err as AxiosError);
    }
    const data = resp.data;
    // Fail-closed stub detection (audit d613ff0 + round-3 contract change):
    // when the backend returns HTTP 200 with enabled:false or any stub
    // provider, throw a structured AIUnavailableError. The previous round
    // returned a `disabled` union member here, but callers had to opt in to
    // handling it — any caller that forgot would silently render the stub
    // placeholder as a real draft. An exception forces handling.
    const allowedReasons: AIGatewayDraftDisabled['reason'][] = [
      'kill_switch',
      'no_provider_key',
      'rate_limited',
      'role_denied',
      'consent_missing',
      'feature_flag_off',
    ];
    const metaReason = data.meta?.reason;
    const topLevelProvider = data.provider;
    const nestedProvider = data.source?.provider;
    if (
      data.enabled === false ||
      topLevelProvider === 'stub' ||
      nestedProvider === 'stub'
    ) {
      const reason: AIGatewayDraftDisabled['reason'] =
        metaReason && (allowedReasons as string[]).includes(metaReason)
          ? (metaReason as AIGatewayDraftDisabled['reason'])
          : 'no_provider_key';
      throw new AIUnavailableError({
        capability: req.capability,
        reason,
        summary: null,
        retryAfter: null,
      });
    }
    return data;
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
export { AIUnavailableError, isAIUnavailableError } from './aiGatewayErrors';
