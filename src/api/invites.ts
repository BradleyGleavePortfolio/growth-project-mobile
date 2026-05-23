/**
 * Email Pipeline v1 — typed mobile API client.
 *
 * Companion backend PR: feat/email-pipeline-v1-backend.
 *
 * Endpoints (see `src/types/invites.ts` for shapes):
 *   POST   /coach/invite-codes/bulk          (rows: BulkInviteRowDto[])
 *   POST   /coach/invite-codes/single
 *   GET    /coach/invite-codes               (returns raw Prisma rows, snake_case)
 *   POST   /coach/invite-codes/:id/send      (resend; requires email body)
 *   DELETE /coach/invite-codes/:id           (revoke)
 *   POST   /invites/accept/:token            (PUBLIC, no auth)
 *
 * Contract adapters live at the bottom of this file. The backend returns
 * `bulkInvite` as `{ total, created[], rejected[] }` and `listForCoach`
 * as a raw `InviteCode[]` array with snake_case columns; we map both
 * into the camelCase `Invite` / `BulkInviteResult` shapes the UI consumes
 * so a backend response-shape change is contained to this file.
 *
 * The wrapper uses the existing axios instance for authed calls so the
 * 401 -> refresh interceptor still fires. Accept goes through a raw fetch
 * against the same base URL so it never carries a stale auth header.
 *
 * Resend gracefully degrades: when the backend returns 404 we return
 * `{ supported: false }` instead of throwing so the UI can hide the
 * affordance instead of erroring out.
 */

import api from '../services/api';
import { env } from '../config/env';
import { isValidInviteToken } from '../utils/inviteToken';
import type {
  AcceptInviteResponse,
  BulkInviteResponse,
  BulkInviteResult,
  Invite,
  InviteListFilter,
  InviteStatus,
  RawInviteRow,
  SingleInviteResponse,
} from '../types/invites';

const MAX_BULK_EMAILS = 100;
const EMAIL_MAX_TOTAL = 254;
const EMAIL_MAX_LOCAL = 64;

// Stricter RFC-leaning email regex matching the conservative subset the
// backend's class-validator `@IsEmail()` will accept. We also enforce a
// display-safety pass that rejects HTML/script-flavored characters even
// if they would be permitted in an RFC 5321 quoted local part — we never
// want to surface such rows as "valid" in the bulk-invite preview.
const EMAIL_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9._+\-]*[A-Za-z0-9])?@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)+$/;

function hasDisplayUnsafeChar(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return /[<>"'`&\\\s]/.test(v);
}

export function isValidEmail(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v.length === 0 || v.length > EMAIL_MAX_TOTAL) return false;
  if (hasDisplayUnsafeChar(v)) return false;
  const at = v.indexOf('@');
  if (at < 1) return false;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (local.length === 0 || local.length > EMAIL_MAX_LOCAL) return false;
  if (domain.length === 0 || !domain.includes('.')) return false;
  if (v.includes('..')) return false;
  return EMAIL_RE.test(v);
}

/** Normalise an email to lower-case, trimmed form. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Tokenise a paste blob into candidate emails.
 *
 * Accepts newline, comma, semicolon, tab, or whitespace separators.
 * Deduplicates while preserving first-seen order. Does NOT validate.
 */
export function tokeniseEmails(input: string): string[] {
  if (!input) return [];
  const tokens = input
    .split(/[\s,;]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * Parse the first column of a CSV blob into candidate emails.
 *
 * Auto-detects an "email" header (case-insensitive). When no header
 * is present, takes column zero.
 */
export function parseCsvEmails(input: string): string[] {
  if (!input) return [];
  const lines = input
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  let emailColumn = 0;
  let startRow = 0;
  const firstCells = splitCsvLine(lines[0]);
  const headerIdx = firstCells.findIndex(
    (c) => c.trim().toLowerCase() === 'email',
  );
  if (headerIdx >= 0) {
    emailColumn = headerIdx;
    startRow = 1;
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const candidate = (cells[emailColumn] ?? '').trim();
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        out.push(cur);
        cur = '';
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

// ─── API surface ─────────────────────────────────────────────────────────────

export interface BulkInviteRow {
  email: string;
  note?: string;
  name?: string;
}

export const invitesApi = {
  /**
   * Bulk-create invite codes and queue their emails.
   * Up to 100 emails per request — over the cap throws synchronously
   * so the caller can show the validation error without a network round trip.
   *
   * Backend contract: `{ rows: BulkInviteRowDto[] }`. The optional `message`
   * is forwarded as `note` on every row.
   */
  bulkInvite: async (
    emails: string[],
    message?: string,
  ): Promise<BulkInviteResponse> => {
    if (emails.length === 0) {
      throw new Error('At least one email is required');
    }
    if (emails.length > MAX_BULK_EMAILS) {
      throw new Error(`Too many emails — max ${MAX_BULK_EMAILS} per request`);
    }
    const note = message && message.trim().length > 0 ? message.trim() : undefined;
    const rows: BulkInviteRow[] = emails.map((email) =>
      note ? { email, note } : { email },
    );
    const res = await api.post<BackendBulkInviteResponse>(
      '/coach/invite-codes/bulk',
      { rows },
    );
    return adaptBulkInviteResponse(res.data);
  },

  /** Single invite — used by the per-row resend path's fallback. */
  singleInvite: async (
    email: string,
    message?: string,
  ): Promise<SingleInviteResponse> => {
    const res = await api.post<SingleInviteResponse>(
      '/coach/invite-codes/single',
      { email, message },
    );
    return res.data;
  },

  /**
   * List invite codes belonging to the current coach. Filter is applied
   * client-side because the backend list is small (<= a few hundred per
   * coach) and we want fast filter-chip switching.
   */
  listInvites: async (
    filter: InviteListFilter = 'all',
  ): Promise<Invite[]> => {
    const res = await api.get<RawInviteRow[] | { invites: RawInviteRow[] }>(
      '/coach/invite-codes',
    );
    const raw = unwrapInviteList(res.data);
    const invites = raw.map(adaptInviteRow);
    if (filter === 'all') return invites;
    const target: InviteStatus =
      filter === 'pending'
        ? 'PENDING'
        : filter === 'accepted'
          ? 'ACCEPTED'
          : 'EXPIRED';
    return invites.filter((i) => i.status === target);
  },

  /**
   * Re-deliver the invite email for an existing invite-code row. Hits
   * `POST /coach/invite-codes/:id/send` with the recipient's email in the
   * request body — that is the contract documented on the backend
   * controller. Returns `{ supported: false }` on 404 so the UI can hide
   * the affordance when the backend hasn't rolled the route yet.
   */
  resendInvite: async (
    id: string,
    email: string,
    opts?: { name?: string; note?: string },
  ): Promise<{ supported: true } | { supported: false }> => {
    if (!email) throw new Error('email is required to resend an invite');
    try {
      await api.post(`/coach/invite-codes/${id}/send`, {
        email,
        ...(opts?.name ? { name: opts.name } : {}),
        ...(opts?.note ? { note: opts.note } : {}),
      });
      return { supported: true };
    } catch (err) {
      if (isNotFound(err)) return { supported: false };
      throw err;
    }
  },

  /** Revoke a pending invite. Reuses the existing DELETE surface. */
  revokeInvite: async (id: string): Promise<void> => {
    await api.delete(`/coach/invite-codes/${id}`);
  },

  /**
   * PUBLIC — accept an invite by token. Does NOT include the auth header
   * so an already-logged-in user can land here without their JWT being
   * consumed by the unauth handler.
   *
   * Tokens are validated against `isValidInviteToken()` before the
   * network call. A malformed deep link short-circuits to a structured
   * `invalid` failure instead of probing the public endpoint.
   */
  acceptInvite: async (token: string): Promise<AcceptInviteResponse> => {
    if (!isValidInviteToken(token)) {
      return { accepted: false, reason: 'invalid' };
    }
    const base = env.API_URL.replace(/\/$/, '');
    const url = `${base}/invites/accept/${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok && res.status !== 410 && res.status !== 409) {
      throw new Error(`Accept failed (${res.status})`);
    }
    const body = (await res.json().catch(() => null)) as
      | AcceptInviteResponse
      | null;
    if (!body) {
      return { accepted: false, reason: 'invalid' };
    }
    return body;
  },
};

/** Axios 404 detector — kept private so the surface stays clean. */
function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { response?: { status?: number } };
  return e.response?.status === 404;
}

// ─── Backend response shapes (snake_case) ────────────────────────────────────
//
// These mirror what the backend invite-codes controller actually returns
// today (`bulkInvite` → `{ total, created, rejected }`; `listForCoach`
// → raw Prisma rows). We adapt them at the API boundary so the rest of
// the mobile app keeps consuming the camelCase `Invite` / `BulkInviteResult`
// shapes declared in `src/types/invites.ts`.

type BackendBulkEmailStatus = 'sent' | 'failed' | 'skipped' | 'logged';

interface BackendBulkCreatedRow {
  email: string;
  code: string;
  invite_code_id: string;
  email_status: BackendBulkEmailStatus;
  email_error?: string;
}

interface BackendBulkRejectedRow {
  email: string;
  reason: string;
}

interface BackendBulkInviteResponse {
  total: number;
  created: BackendBulkCreatedRow[];
  rejected: BackendBulkRejectedRow[];
}

function adaptBulkInviteResponse(
  raw: BackendBulkInviteResponse,
): BulkInviteResponse {
  const created = Array.isArray(raw?.created) ? raw.created : [];
  const rejected = Array.isArray(raw?.rejected) ? raw.rejected : [];
  const results: BulkInviteResult[] = [
    ...created.map<BulkInviteResult>((row) => {
      const queued =
        row.email_status === 'sent' || row.email_status === 'logged';
      const status: BulkInviteResult['status'] =
        row.email_status === 'failed' ? 'failed' : 'created';
      const out: BulkInviteResult = {
        email: row.email,
        inviteId: row.invite_code_id,
        status,
        emailQueued: queued,
      };
      if (row.email_error) out.error = row.email_error;
      return out;
    }),
    ...rejected.map<BulkInviteResult>((row) => ({
      email: row.email,
      status: 'failed',
      emailQueued: false,
      error: row.reason,
    })),
  ];
  return {
    results,
    total: typeof raw?.total === 'number' ? raw.total : results.length,
    createdCount: created.length,
    rejectedCount: rejected.length,
  };
}

function unwrapInviteList(
  data: RawInviteRow[] | { invites: RawInviteRow[] } | null | undefined,
): RawInviteRow[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as { invites?: RawInviteRow[] }).invites)) {
    return (data as { invites: RawInviteRow[] }).invites;
  }
  return [];
}

function deriveInviteStatus(row: RawInviteRow): InviteStatus {
  if (row.revoked) return 'REVOKED';
  if (row.accepted_at || row.accepted_by_user_id) return 'ACCEPTED';
  if (
    typeof row.max_uses === 'number' &&
    row.max_uses > 0 &&
    row.used_count >= row.max_uses
  ) {
    return 'ACCEPTED';
  }
  if (row.expires_at) {
    const exp = Date.parse(row.expires_at);
    if (Number.isFinite(exp) && exp <= Date.now()) return 'EXPIRED';
  }
  return 'PENDING';
}

function adaptInviteRow(row: RawInviteRow): Invite {
  // Prefer the canonical `client_email` field from the email-pipeline
  // backend; fall back to the legacy `intended_email` for any older
  // rows still in flight, then to an empty string so the UI never
  // renders `undefined`.
  const clientEmail = row.client_email ?? row.intended_email ?? '';
  const invite: Invite = {
    id: row.id,
    code: row.code,
    clientEmail,
    status: deriveInviteStatus(row),
    createdAt: row.created_at,
    // Map `last_email_status` directly. Null is preserved (rather than
    // collapsed to undefined) so callers can distinguish "backend
    // explicitly said no status" from "field absent".
    lastEmailStatus: row.last_email_status ?? null,
  };
  if (row.expires_at) invite.expiresAt = row.expires_at;
  if (row.accepted_at) invite.acceptedAt = row.accepted_at;
  return invite;
}

export { MAX_BULK_EMAILS };
export const __invitesInternals = {
  adaptBulkInviteResponse,
  adaptInviteRow,
  deriveInviteStatus,
  unwrapInviteList,
};
