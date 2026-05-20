/**
 * AI Gateway — structured runtime errors.
 *
 * Rule 9 (fail-closed, structured clear errors): when the gateway refuses to
 * generate (because the model pathway is degraded or a stub provider is
 * configured), the client THROWS one of these. Callers must catch and render
 * an "AI temporarily unavailable" notice — the type system cannot prove a
 * caller handled a discriminated `disabled` union, so we use an exception
 * instead. If a caller forgets to catch, the UI sees a real error rather
 * than silently rendering stub placeholder text as if it were a real draft.
 */

import type {
  AIGatewayCapability,
  AIGatewayDraftDisabled,
} from '../types/aiGateway';

export type AIUnavailableReason = AIGatewayDraftDisabled['reason'];

export class AIUnavailableError extends Error {
  readonly name = 'AIUnavailableError' as const;
  readonly capability: AIGatewayCapability;
  readonly reason: AIUnavailableReason;
  readonly retryAfter: string | null;
  readonly summary: string | null;

  constructor(args: {
    capability: AIGatewayCapability;
    reason: AIUnavailableReason;
    retryAfter?: string | null;
    summary?: string | null;
  }) {
    super(`AI gateway unavailable: ${args.reason} (capability=${args.capability})`);
    this.capability = args.capability;
    this.reason = args.reason;
    this.retryAfter = args.retryAfter ?? null;
    this.summary = args.summary ?? null;
  }
}

export function isAIUnavailableError(err: unknown): err is AIUnavailableError {
  return err instanceof AIUnavailableError;
}
