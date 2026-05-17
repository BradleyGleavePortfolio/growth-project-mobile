/**
 * Email Pipeline v1 — typed mobile API client.
 *
 * Companion backend PR: feat/email-pipeline-v1-backend.
 *
 * Endpoints (see `src/types/invites.ts` for shapes):
 *   POST   /coach/invite-codes/bulk
 *   POST   /coach/invite-codes/single
 *   GET    /coach/invite-codes
 *   POST   /coach/invite-codes/:id/resend     (optional — graceful)
 *   DELETE /coach/invite-codes/:id            (revoke)
 *   POST   /invites/accept/:token             (PUBLIC, no auth)
 *
 * Why not extend `services/api.ts:coachApi`? Two reasons:
 *   1. Accept is unauthenticated; co-locating it with authed coach calls
 *      invites a mistake where someone adds the JWT interceptor to it.
 *   2. The v1 list contract (Invite shape with `status` + `lastEmailStatus`)
 *      diverges from the legacy `coachApi.listInviteCodes()` shape; keeping
 *      them in separate modules makes the migration boundary explicit.
 *
 * The wrapper uses the existing axios instance for authed calls so the
 * 401 → refresh interceptor still fires. Accept goes through a raw fetch
 * against the same base URL so it never carries a stale auth header.
 *
 * Resend gracefully degrades: when the backend returns 404 we return
 * `{ supported: false }` instead of throwing so the UI can hide the
 * affordance instead of erroring out.
 */

import api from '../services/api';
import { env } from '../config/env';
import type {
  AcceptInviteResponse,
  BulkInviteResponse,
  Invite,
  InviteListFilter,
  ListInvitesResponse,
  SingleInviteResponse,
} from '../types/invites';

const MAX_BULK_EMAILS = 100;

/**
 * Conservative email regex matching the backend's `class-validator`
 * `@IsEmail()` accept-list in practice. Local pre-validation is required
 * because the bulk endpoint may reject the entire batch on a malformed
 * row depending on the backend's posture.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string | undefined): boolean {
  if (!value) return false;
  return EMAIL_RE.test(value.trim());
}

/** Normalise an email to lower-case, trimmed form. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Tokenise a paste blob into candidate emails.
 *
 * Accepts newline, comma, semicolon, tab, or whitespace separators.
 * Deduplicates while preserving first-seen order. Does NOT validate —
 * call `isValidEmail()` on each result if you need that.
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
 * is present, takes column zero. Keep this hand-rolled — pulling in
 * papaparse just for a single column is overkill and we already have
 * a heavier server-side parser available for the more exotic shapes.
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
  // Detect a header row by looking for "email" (case-insensitive) in any
  // of the first row's comma-separated fields.
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

/**
 * Split a single CSV line respecting double-quoted fields. Doesn't
 * implement the entire RFC 4180 — newlines inside quotes are not
 * supported because the line tokeniser splits on `\n` first. That's
 * fine for the first-column-emails use case.
 */
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

export const invitesApi = {
  /**
   * Bulk-create invite codes and queue their emails.
   * Up to 100 emails per request — over the cap throws synchronously
   * so the caller can show the validation error without a network round trip.
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
    const res = await api.post<BulkInviteResponse>(
      '/coach/invite-codes/bulk',
      { emails, message },
    );
    return res.data;
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
   * client-side because the backend list is small (≤ a few hundred per coach)
   * and we want fast filter-chip switching.
   */
  listInvites: async (
    filter: InviteListFilter = 'all',
  ): Promise<Invite[]> => {
    const res = await api.get<ListInvitesResponse>('/coach/invite-codes');
    const invites = res.data?.invites ?? [];
    if (filter === 'all') return invites;
    const target =
      filter === 'pending'
        ? 'PENDING'
        : filter === 'accepted'
          ? 'ACCEPTED'
          : 'EXPIRED';
    return invites.filter((i) => i.status === target);
  },

  /**
   * Re-queue the invite email for a PENDING invite. Calls
   * POST /coach/invite-codes/:id/send with { email } matching the
   * backend's sendOne endpoint signature. Returns
   * `{ supported: false }` when the backend returns 404 so the UI
   * can hide the affordance instead of erroring out.
   */
  resendInvite: async (
    id: string,
    email: string,
  ): Promise<{ supported: true } | { supported: false }> => {
    try {
      await api.post(`/coach/invite-codes/${id}/send`, { email });
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
   */
  acceptInvite: async (token: string): Promise<AcceptInviteResponse> => {
    const base = env.API_URL.replace(/\/$/, '');
    const url = `${base}/invites/accept/${encodeURIComponent(token)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // The backend is expected to return 200 on both "accepted" and a
    // structured failure ({ accepted: false, reason }). Network or 5xx
    // errors throw so the UI can render a retry CTA.
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

export { MAX_BULK_EMAILS };
