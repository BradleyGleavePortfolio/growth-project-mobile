/**
 * bulkInviteApi
 *
 * Typed client for the Sprint B v2 bulk-invite endpoints (PR #188
 * backend). Two routes:
 *   POST /coach/invite-codes/bulk        — persist + email codes
 *   POST /coach/invite-codes/bulk/parse  — pure paste-area parser
 *
 * Backend contract source of truth:
 *   src/invite-codes/invite-codes.controller.ts
 *   src/invite-codes/bulk-invite.dto.ts
 *
 * Validation posture (see Sprint B v2.1 audit + HOUSE_RULES.md):
 *   The submit endpoint applies class-validator with
 *   `forbidNonWhitelisted: true` and `@IsEmail({each: true})`. One bad
 *   email in the array rejects the whole batch with a 400. The
 *   recommended mobile flow is:
 *     1. User pastes blob.
 *     2. Call `parse(input)` for a forgiving server-side tokenisation
 *        preview.
 *     3. Locally drop rows that fail an email regex.
 *     4. Confirm + call `submit(rows)`.
 *   This is why the mobile renders a paste-then-preview step rather
 *   than a single submit-and-pray button.
 *
 * Throttle: 5 calls / minute on `/bulk`. The parse endpoint is not
 * rate-limited.
 */

import api from '../services/api';

// ─── DTOs (mirror backend) ───────────────────────────────────────────────────

export interface BulkInviteRow {
  email: string;
  name?: string;
  note?: string;
}

export interface BulkInviteSubmitInput {
  /** Up to 100 rows per submit. */
  rows: BulkInviteRow[];
}

export interface BulkInviteCreated {
  email: string;
  code: string;
  invite_code_id: string;
}

export interface BulkInviteRejected {
  email: string;
  /** 'empty' | 'duplicate_in_batch' | 'create_failed' | ... */
  reason: string;
}

export interface BulkInviteSubmitResult {
  total: number;
  created: BulkInviteCreated[];
  rejected: BulkInviteRejected[];
}

export interface BulkInviteParseInput {
  /** Raw paste-area blob (CSV, TSV, newline-separated). */
  input: string;
}

export interface BulkInviteParseResult {
  rows: BulkInviteRow[];
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const bulkInviteApi = {
  /**
   * Pure paste-area parser. No DB writes. Safe to call on every
   * keystroke (debounced). Returns up to 100 rows.
   */
  parse: (input: string) =>
    api.post<BulkInviteParseResult>('/coach/invite-codes/bulk/parse', {
      input,
    }),

  /**
   * Persist + email codes. Throttled 5/min per user. One bad row
   * rejects the entire batch with a 400 — pre-validate locally before
   * calling.
   */
  submit: (rows: BulkInviteRow[]) =>
    api.post<BulkInviteSubmitResult>('/coach/invite-codes/bulk', {
      rows,
    } satisfies BulkInviteSubmitInput),
};

// ─── Local pre-validation helper ─────────────────────────────────────────────

/**
 * Conservative email regex — matches what `class-validator`'s
 * `@IsEmail()` accepts in practice without trying to be RFC-5322
 * exhaustive. Use in the paste-preview step before calling `submit()`
 * so the strict batch-reject behaviour of the backend never surfaces
 * to the coach.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLikelyEmail(value: string | undefined): boolean {
  if (!value) return false;
  return EMAIL_RE.test(value.trim());
}

export function filterValidRows(rows: BulkInviteRow[]): {
  valid: BulkInviteRow[];
  dropped: BulkInviteRow[];
} {
  const valid: BulkInviteRow[] = [];
  const dropped: BulkInviteRow[] = [];
  for (const row of rows) {
    if (isLikelyEmail(row.email)) {
      valid.push({ ...row, email: row.email.trim().toLowerCase() });
    } else {
      dropped.push(row);
    }
  }
  return { valid, dropped };
}
