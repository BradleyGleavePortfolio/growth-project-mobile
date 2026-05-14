/**
 * Email Pipeline v1 — shared mobile types.
 *
 * Mirrors the contract on `feat/email-pipeline-v1-backend`:
 *   POST /coach/invite-codes/bulk
 *   POST /coach/invite-codes/single
 *   GET  /coach/invite-codes
 *   POST /coach/invite-codes/:id/resend          (optional — graceful)
 *   DELETE /coach/invite-codes/:id               (revoke — existing surface)
 *   POST /invites/accept/:token                  (PUBLIC, no auth)
 *
 * These types are intentionally narrow: anything the mobile actively
 * renders gets a strict union; opaque ids stay as `string`.
 */

/** Invite lifecycle state as surfaced by the backend list endpoint. */
export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

/** Last delivery state for the invite email. */
export type EmailStatus =
  | 'QUEUED'
  | 'SENT'
  | 'DELIVERED'
  | 'BOUNCED'
  | 'FAILED';

/** Per-email outcome from a bulk-invite request. */
export type BulkInviteResultStatus = 'created' | 'reused' | 'failed';

export interface BulkInviteResult {
  email: string;
  inviteId?: string;
  status: BulkInviteResultStatus;
  emailQueued: boolean;
  error?: string;
}

export interface BulkInviteResponse {
  results: BulkInviteResult[];
}

export interface SingleInviteResponse {
  inviteId: string;
  status: BulkInviteResultStatus;
  emailQueued: boolean;
}

export interface Invite {
  id: string;
  code: string;
  clientEmail?: string;
  status: InviteStatus;
  expiresAt?: string;
  createdAt: string;
  acceptedAt?: string;
  lastEmailStatus?: EmailStatus;
}

export interface ListInvitesResponse {
  invites: Invite[];
}

/** Reason an accept attempt failed. The backend may add more values; treat
 *  anything else as `'invalid'`. */
export type AcceptInviteFailureReason =
  | 'expired'
  | 'already_accepted'
  | 'invalid';

export type AcceptInviteResponse =
  | {
      accepted: true;
      coachName?: string;
      coachEmail?: string;
      /** Hint for the mobile router. `app_open` = signed-in users go straight
       *  to client home; unknown values fall back to safe defaults. */
      redirectTo?: 'app_open' | 'login' | 'signup';
      /** Email the invite was issued to — used to prefill login/signup. */
      email?: string;
    }
  | {
      accepted: false;
      reason: AcceptInviteFailureReason;
      /** Optional human-readable detail the backend may include. */
      message?: string;
    };

/** Optional client-side filter for the invites list. */
export type InviteListFilter = 'all' | 'pending' | 'accepted' | 'expired';
