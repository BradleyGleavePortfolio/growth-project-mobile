/**
 * F2 — Named Regimes + partial-refund decision wire contracts (fitness mobile).
 *
 * Mirrors the shapes returned by `gpb/src/regimes/*`. Strict types — no
 * `Record<string, unknown>` on these responses. Dates arrive as ISO strings
 * over the wire (the backend serialises Date → string), so every timestamp is
 * typed as `string | null` here.
 */

/** A named regime row in the coach's regime list. */
export interface RegimeListItem {
  id: string;
  /** Underlying WorkoutProgram.name (the editor fallback name). */
  name: string;
  /** Independent regime display name; null falls back to `name`. */
  regime_display_name: string | null;
  weeks: number;
  days_per_week: number;
  head_revision_id: string | null;
  archived_at: string | null;
  /** How many packages currently attach this regime. */
  package_attachments_count: number;
}

/** A single read-only revision row for the "last 3 versions" drawer. */
export interface RegimeRevisionItem {
  revision_index: number;
  created_at: string;
  cause: string;
}

/** A pending partial-refund decision awaiting the coach. */
export interface PendingRefundDecision {
  id: string;
  client_purchase_id: string;
  stripe_refund_id: string;
  decision: 'pending' | 'keep_drops' | 'unassign_drops';
  created_at: string;
  client_user_id: string;
  amount_cents: number;
}

/** Result of applying a partial-refund decision. */
export interface DecideRefundResult {
  id: string;
  decision: 'keep_drops' | 'unassign_drops';
  drops_canceled: number;
}

/** Result of F1's push-to-existing endpoint (PR #326). */
export interface PushToExistingResult {
  drops_updated: number;
  buyers_affected: number;
}
