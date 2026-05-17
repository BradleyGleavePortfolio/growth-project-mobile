/**
 * AI Gateway — request / response DTOs.
 *
 * These types describe the shape the mobile app expects from the backend AI
 * Gateway when the gateway lands. The gateway is the only path mobile uses to
 * reach a model provider — the app never holds provider keys, never assembles
 * raw PII into prompts, and never calls a provider SDK directly.
 *
 * Doctrine (mirrors PR #100's wave11 honesty rules):
 *   - AI summarises / drafts / flags / explains. A coach or admin approves.
 *   - Every AI response carries an explicit source attribution + freshness so
 *     the UI can render "stale" / "source missing" states honestly.
 *   - The gateway returns a fail-closed `disabled` shape when the backend
 *     refuses (no provider key, kill switch, rate-limit, role denied) — the
 *     app must render the disabled UX, never fabricate a fallback answer.
 */

// ─── Capability surface ────────────────────────────────────────────────────
// The set of mobile-visible AI capabilities. Each capability is gated by the
// backend; the mobile feature flag is a *secondary* gate so we can disable a
// surface client-side even if the backend would allow it.
export type AIGatewayCapability =
  | 'coach_brief_draft' // assist drafting the weekly coach brief
  | 'client_path_summary' // summarise a client's recent activity
  | 'check_in_summary' // summarise a single check-in into 1–2 lines
  | 'food_log_explain'; // explain why a food log entry looks off

export const AI_GATEWAY_CAPABILITIES: readonly AIGatewayCapability[] = [
  'coach_brief_draft',
  'client_path_summary',
  'check_in_summary',
  'food_log_explain',
] as const;

// ─── Request DTOs ──────────────────────────────────────────────────────────
// The mobile app sends a *capability* + a small structured payload. It never
// sends a free-text prompt with PII baked in — the gateway assembles the
// prompt from the user's authenticated context server-side.
export interface AIGatewayDraftRequest {
  capability: AIGatewayCapability;
  // Opaque references to server-side records. The backend resolves these
  // against the caller's auth context; mobile cannot pass arbitrary IDs and
  // expect them to be honoured.
  subjectRef?: {
    kind: 'client' | 'check_in' | 'food_log_entry' | 'coach_brief';
    id: string;
  };
  // Free-text *intent* the user typed (e.g. "focus on protein adherence").
  // Distinct from the model prompt — the gateway treats this as user input
  // bounded by guardrails, not as instructions.
  userIntent?: string;
  // Idempotency key so a retried request returns the same draft instead of a
  // new generation. The mobile client generates this; backend persists for a
  // short window.
  idempotencyKey: string;
  // Optional structured action payload forwarded to the backend as
  // `proposed_action`. Required for approval-gated capabilities.
  proposedAction?: Record<string, unknown>;
}

// ─── Response DTOs ─────────────────────────────────────────────────────────
// The gateway returns one of three shapes. Discriminated by `status` so the
// UI is forced to handle every case at compile time.

/**
 * Successful generation. The draft is *unsigned*; a coach or admin must
 * approve before the app may render it as authoritative. UI must show the
 * source attribution and freshness, and gate any "approved" treatment behind
 * `approval.actor != null`.
 */
export interface AIGatewayDraftOk {
  status: 'ok';
  draftId: string;
  capability: AIGatewayCapability;
  // The model output, plain text. UI must render through the AINote component
  // (PR #100) so the disclaimer is always attached.
  text: string;
  // Source attribution for the audit primitive. `provider` is opaque — mobile
  // does not branch on it; it only displays it in the audit chip.
  source: {
    provider: string; // e.g. "anthropic" / "openai" — display only
    model: string; // e.g. "claude-sonnet-4-6" — display only
    generatedAt: string; // ISO timestamp
    // ISO timestamp of the underlying data (last check-in, last food log)
    // the draft is grounded in. Lets the UI show "based on data from
    // 2 days ago" honestly.
    groundedAt?: string | null;
  };
  // Approval state. Drafts arrive `null`; the UI must not present them as
  // approved. A coach/admin approval flow flips this server-side.
  approval: {
    actor: { id: string; role: 'coach' | 'admin'; name?: string } | null;
    approvedAt: string | null;
  };
  // Freshness flag. True when the underlying data is older than the
  // capability's freshness window — UI should show the "source stale" chip.
  isStale: boolean;
}

/**
 * Backend refused or could not run the capability. UI MUST render the
 * disabled / fail-closed state and never substitute a fabricated answer.
 *
 * Reasons are an enum (not free text) so analytics + UI copy can branch
 * without parsing strings.
 */
export interface AIGatewayDraftDisabled {
  status: 'disabled';
  capability: AIGatewayCapability;
  reason:
    | 'kill_switch' // operator-flipped global off
    | 'no_provider_key' // backend has no usable provider credential
    | 'rate_limited' // capability quota exhausted for this caller / tenant
    | 'role_denied' // caller's role is not allowed this capability
    | 'consent_missing' // user / coach has not granted required consent
    | 'feature_flag_off'; // backend feature flag disabled
  // Optional, server-rendered, human-readable summary the UI may show
  // verbatim. Pattern matches `coachBilling.summary` — backend owns copy.
  summary?: string | null;
  // ISO timestamp the gateway may try again, when known (e.g. rate-limit).
  retryAfter?: string | null;
}

/**
 * Generation attempted but failed (provider error, timeout, content policy
 * block). UI shows the error state — same fail-closed posture as `disabled`,
 * but with a "try again" affordance.
 */
export interface AIGatewayDraftError {
  status: 'error';
  capability: AIGatewayCapability;
  reason:
    | 'provider_unavailable'
    | 'timeout'
    | 'content_blocked'
    | 'invalid_input'
    | 'unknown';
  // Opaque correlation id for support; mobile displays it in the error chip.
  correlationId?: string | null;
}

export type AIGatewayDraftResponse =
  | AIGatewayDraftOk
  | AIGatewayDraftDisabled
  | AIGatewayDraftError;

// ─── Capability discovery ──────────────────────────────────────────────────
// Mobile calls this once per session to learn which capabilities are live for
// the current caller. UI uses this to decide whether to render the entry
// point at all (fail-closed default = hidden).
export interface AIGatewayCapabilityStatus {
  capability: AIGatewayCapability;
  enabled: boolean;
  // When `enabled === false`, mirrors the disabled-response reason so the UI
  // can show why a capability is hidden (e.g. an admin-only banner).
  reason?: AIGatewayDraftDisabled['reason'];
}

export interface AIGatewayStatusResponse {
  // True only when the gateway itself is reachable AND at least one
  // capability is enabled for this caller. UI uses this as a master gate.
  available: boolean;
  capabilities: AIGatewayCapabilityStatus[];
  // When the gateway is hard-disabled (kill switch), this is the operator
  // message to display verbatim. Pattern matches `coachBilling.summary`.
  summary?: string | null;
}

// ─── Type guards ───────────────────────────────────────────────────────────
// Cheap runtime narrowing for the discriminated union. Useful at adapter
// boundaries where `unknown` becomes a typed response.
export function isAIGatewayOk(r: AIGatewayDraftResponse): r is AIGatewayDraftOk {
  return r.status === 'ok';
}
export function isAIGatewayDisabled(
  r: AIGatewayDraftResponse,
): r is AIGatewayDraftDisabled {
  return r.status === 'disabled';
}
export function isAIGatewayError(
  r: AIGatewayDraftResponse,
): r is AIGatewayDraftError {
  return r.status === 'error';
}
