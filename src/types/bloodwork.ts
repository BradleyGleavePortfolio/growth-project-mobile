/**
 * Bloodwork / Lab Results — typed contracts.
 *
 * SCOPE (v1): client-entered, manual-entry-only. Coach reviews and
 * approves any insight surfaced back to the client.
 *
 * NON-GOALS (v1): EHR import, OCR, provider-connected records,
 * automated triage, diagnostic interpretation. Those are tracked as
 * *future, optional* pathways in docs/BLOODWORK_HANDOFF.md and must
 * remain disabled by default.
 *
 * Bloodwork is sensitive personal health data. These contracts assume
 * a backend that will (a) encrypt at rest, (b) audit-log every read
 * and write, (c) gate access to a client's records to (the client) +
 * (the client's assigned coach), and (d) require consent capture
 * before any provider connection is enabled.
 */

// ─── Source / provenance ─────────────────────────────────────────────────────

/**
 * Where the value came from. `manual` is the only path enabled in v1.
 * The other values exist so contracts don't need to be reshaped when
 * future pathways ship behind their own flags.
 */
export type BloodworkSourceType =
  | 'manual'
  | 'photo_attachment_unverified' // future: client uploads a lab PDF/photo placeholder
  | 'lab_provider_import'         // future: connected lab/EHR
  | 'clinician_entered';          // future: a verified clinician in-app

export const DEFAULT_BLOODWORK_SOURCE: BloodworkSourceType = 'manual';

// ─── Validation, freshness, signoff ──────────────────────────────────────────

/**
 * Lifecycle of a single result row.
 *
 *   draft_client_entered  — the client has typed it but not submitted
 *   submitted             — submitted to coach, awaiting review
 *   needs_source          — coach asked the client to confirm the source
 *   needs_clinician_context — coach flagged a value as outside their scope;
 *                             client should consult their clinician
 *   coach_reviewed        — coach reviewed; insights (if any) may be shown
 *   hidden_from_client    — coach hid the row from the client surface
 *   disputed_flagged      — value looks implausible; surfaced for manual fix
 */
export type BloodworkReviewState =
  | 'draft_client_entered'
  | 'submitted'
  | 'needs_source'
  | 'needs_clinician_context'
  | 'coach_reviewed'
  | 'hidden_from_client'
  | 'disputed_flagged';

export type BloodworkValidationStatus =
  | 'unvalidated'
  | 'value_in_range'
  | 'value_out_of_range'
  | 'value_implausible' // outside any sane physiological window
  | 'unit_mismatch'
  | 'missing_unit';

/**
 * `fresh` / `stale` is purely informational — coaches care about how old a
 * panel is, but staleness must NEVER be presented as a clinical concern.
 */
export type BloodworkFreshness = 'fresh' | 'aging' | 'stale' | 'undated';

/**
 * The disclaimer level a surface MUST render alongside any AI- or
 * coach-derived text. Even at level `educational`, the surface must
 * still link to the long-form disclaimer.
 */
export type BloodworkDisclaimerLevel =
  | 'educational'        // generic educational copy + "not medical advice"
  | 'coach_context'      // coach has reviewed; coaching context, not advice
  | 'clinician_referral' // coach is explicitly punting to the client's clinician
  | 'hidden';            // copy is suppressed (e.g. coach hid the row)

// ─── AI draft ────────────────────────────────────────────────────────────────

/**
 * AI-drafted educational context attached to a panel or marker.
 *
 * Hard rules (enforced in copy + tests):
 *   - never present as diagnosis, treatment, prescription, or dosing.
 *   - never claim urgency / triage.
 *   - never replace a clinician.
 *   - must remain `unapproved` until a coach signs off.
 */
export type BloodworkAIDraftStatus =
  | 'none'
  | 'pending'
  | 'unapproved' // generated, awaiting coach review
  | 'approved'   // coach signed off — safe to show client
  | 'rejected';  // coach rejected — never shown to client

export interface BloodworkAIDraft {
  status: BloodworkAIDraftStatus;
  /** Short coach-facing summary. Never shown to client unless approved. */
  summaryForCoach?: string;
  /** Educational tips drafted for the client. Only shown when approved. */
  educationalTipsForClient?: string[];
  /** Generation timestamp (ISO-8601). */
  generatedAt?: string;
  /** Coach who reviewed (if any). */
  reviewedByCoachId?: string;
  /** Review timestamp (ISO-8601). */
  reviewedAt?: string;
  /** Free-text reason for rejection / required edits, coach-only. */
  coachReviewNotes?: string;
}

// ─── Reference range ─────────────────────────────────────────────────────────

export interface BloodworkReferenceRange {
  low?: number;
  high?: number;
  unit: string;
  /** Where the range came from — lab printout, generic textbook, etc. */
  sourceLabel?: string;
}

// ─── Marker (single biomarker reading) ───────────────────────────────────────

export interface BloodworkMarker {
  id: string;
  panelId: string;
  /** Human label, e.g. "Vitamin D, 25-OH". Never the only identifier. */
  name: string;
  /**
   * Stable code. LOINC is the long-term goal; v1 just stores whatever the
   * client typed (or null) and lets the coach normalise later.
   */
  code?: string;
  value?: number;
  /** Stringified value for readings that aren't numeric (e.g. "negative"). */
  valueText?: string;
  unit?: string;
  referenceRange?: BloodworkReferenceRange;
  /** ISO-8601 collection date as entered by the client. */
  collectionDate?: string;
  sourceType: BloodworkSourceType;
  /** Free-text source notes — "Quest lab printout", "screenshot from portal". */
  sourceNotes?: string;
  validationStatus: BloodworkValidationStatus;
  freshness: BloodworkFreshness;
  reviewState: BloodworkReviewState;
  disclaimerLevel: BloodworkDisclaimerLevel;
  aiDraft?: BloodworkAIDraft;
  /** Coach-only notes not shown to the client. */
  coachNotes?: string;
  /** True when the client should fix something before resubmitting. */
  needsClientAction?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Panel (group of markers for one collection event) ───────────────────────

export interface BloodworkPanel {
  id: string;
  clientId: string;
  /** Optional client-supplied label, e.g. "Annual physical, March 2026". */
  label?: string;
  collectionDate?: string;
  labName?: string;
  sourceType: BloodworkSourceType;
  sourceNotes?: string;
  /**
   * Optional placeholder for an attachment id. v1 does NOT store the
   * attachment — this is reserved for the future low-risk pathway.
   */
  attachmentPlaceholderId?: string;
  markers: BloodworkMarker[];
  reviewState: BloodworkReviewState;
  disclaimerLevel: BloodworkDisclaimerLevel;
  aiDraft?: BloodworkAIDraft;
  /** True when at least one marker is missing required fields. */
  hasMissingFields: boolean;
  /** True when the panel is older than the staleness window. */
  isStale: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Wire / draft inputs ─────────────────────────────────────────────────────

/**
 * Shape the client manual-entry form submits. The backend is expected
 * to return a fully-hydrated `BloodworkPanel` with server-assigned ids
 * and `submitted` review state.
 */
export interface BloodworkPanelDraftInput {
  label?: string;
  collectionDate?: string;
  labName?: string;
  sourceNotes?: string;
  markers: Array<{
    name: string;
    value?: number;
    valueText?: string;
    unit?: string;
    referenceRange?: BloodworkReferenceRange;
    sourceNotes?: string;
  }>;
}

// ─── Coach review queue item ─────────────────────────────────────────────────

export interface BloodworkReviewQueueItem {
  panelId: string;
  clientId: string;
  clientDisplayName: string;
  submittedAt: string;
  reviewState: BloodworkReviewState;
  hasUnreviewedAIDraft: boolean;
  /** Number of markers flagged by validation. */
  flaggedMarkerCount: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Whether a coach surface should treat this row as "client-visible".
 * Mirrors the server-side rule: anything not coach_reviewed is hidden
 * from the client.
 */
export function isClientVisible(state: BloodworkReviewState): boolean {
  return state === 'coach_reviewed';
}

/**
 * Whether AI draft text is safe to render to the client. The default is
 * `false` — caller must opt in by passing an explicitly approved draft.
 */
export function isAIDraftClientVisible(draft?: BloodworkAIDraft): boolean {
  return !!draft && draft.status === 'approved';
}
