// Coach package CONTENTS + push API client (PR-17 M1).
//
// Wires the backend coach package-contents authoring endpoints
// (`v1/coach/packages/:id/contents…`) and the new "push to existing
// buyers" endpoints. Kept as a sibling to packagesApi.ts (package-LEVEL
// CRUD) so the contents/push surface evolves without merge contention on
// the package methods.
//
// Contract alignment (PR17_EXPANSION_PLAN §2.1 / §3.1, frozen in
// PR17_M1_BRIEF):
//   • GET    v1/coach/packages/:id/contents                       → { contents }
//   • POST   v1/coach/packages/:id/contents                       (attach)  + Idempotency-Key
//   • PUT    v1/coach/packages/:id/contents/reorder               → { contents }
//   • PATCH  v1/coach/packages/:id/contents/:contentId            (patch)   + Idempotency-Key
//   • DELETE v1/coach/packages/:id/contents/:contentId            (soft-delete)
//   • GET    v1/coach/packages/:id/contents/:contentId/push/preview?audience=&mode=
//   • POST   v1/coach/packages/:id/contents/:contentId/push                 + Idempotency-Key
//
// The backend returns these rows in snake_case (raw Prisma rows), so the
// PackageContent type below mirrors the backend shape verbatim rather than
// camelCasing — the contents authoring screens consume it as-is. Every
// mutation (attach/patch/push) sends a client-generated UUID
// `Idempotency-Key` header via the shared idemHeaders helper (decision #8)
// so double-taps / retries don't create duplicate content rows or
// double-push drops to buyers.

import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';

// ─── types (mirror backend DTO shapes) ────────────────────────────────────────

// CoachPackageContent.asset_type union (backend package-contents.dto.ts ASSET_TYPES).
export type ContentAssetType =
  | 'workout_program'
  | 'workout_plan'
  | 'meal_plan'
  | 'pdf'
  | 'video'
  | 'auto_message';

// CoachPackageContent.cadence_kind union (backend CADENCE_PAYLOAD_SCHEMAS keys).
export type CadenceKind =
  | 'immediate'
  | 'relative_to_purchase'
  | 'fixed_calendar'
  | 'on_completion'
  | 'on_milestone';

// A CoachPackageContent row as returned by the backend (snake_case verbatim).
export interface PackageContent {
  id: string;
  package_id: string;
  asset_type: ContentAssetType;
  asset_id: string;
  asset_revision_id: string | null;
  display_order: number;
  cadence_kind: CadenceKind;
  cadence_payload: Record<string, unknown>;
  display_title: string | null;
  display_caption: string | null;
  created_at: string;
  updated_at: string;
  removed_at: string | null;
}

// Attach body — mirrors the backend CreateContentSchema (discriminated on
// cadence_kind). asset_type/asset_id + cadence pair are required; display_*
// and display_order optional.
export interface AttachContentBody {
  asset_type: ContentAssetType;
  asset_id: string;
  asset_revision_id?: string | null;
  display_order?: number;
  cadence_kind: CadenceKind;
  cadence_payload: Record<string, unknown>;
  display_title?: string | null;
  display_caption?: string | null;
}

// Patch body — all fields optional; cadence is all-or-nothing on the
// backend (cadence_kind + cadence_payload must be sent together).
export interface PatchContentBody {
  display_order?: number;
  display_title?: string | null;
  display_caption?: string | null;
  asset_revision_id?: string | null;
  cadence_kind?: CadenceKind;
  cadence_payload?: Record<string, unknown>;
}

// ─── push types ───────────────────────────────────────────────────────────────

export type PushAudience = 'all' | 'active' | 'cohort';
export type PushMode = 'push_existing' | 'resend';

// POST push body (frozen contract, PR17_EXPANSION_PLAN §2.1).
export interface PushRequest {
  audience: PushAudience;
  cohort_purchase_ids?: string[];
  fire_at: string; // ISO 8601, today-or-later (server re-validates)
  mode: PushMode;
  notify: boolean;
}

// GET push/preview response — the buyer count for the confirm modal.
export interface PushPreview {
  count: number;
  audience: PushAudience;
  already_delivered: number;
}

// POST push response — the success-preview payload.
export interface PushResult {
  scheduled: number;
  skipped: number;
  fire_at: string;
  audience: PushAudience;
  notify: boolean;
}

// ─── helpers ────────────────────────────────────────────────────────────────

// Local copy of the idempotency-header shaper (packagesApi.ts exports the
// same helper; we re-derive here to keep this module import-independent of
// the package-level client). Decision #8.
function idemHeaders(key?: string): { headers: { 'Idempotency-Key': string } } {
  return { headers: { 'Idempotency-Key': key ?? generateIdempotencyKey() } };
}

const base = (packageId: string) =>
  `/v1/coach/packages/${encodeURIComponent(packageId)}/contents`;

// ─── coach package contents + push API ────────────────────────────────────────

export const coachPackageContentsApi = {
  list: (packageId: string) =>
    api.get<{ contents: PackageContent[] }>(base(packageId)),

  attach: (packageId: string, body: AttachContentBody, key?: string) =>
    api.post<PackageContent>(base(packageId), body, idemHeaders(key)),

  patch: (
    packageId: string,
    contentId: string,
    body: PatchContentBody,
    key?: string,
  ) =>
    api.patch<PackageContent>(
      `${base(packageId)}/${encodeURIComponent(contentId)}`,
      body,
      idemHeaders(key),
    ),

  reorder: (packageId: string, contentIds: string[]) =>
    api.put<{ contents: PackageContent[] }>(`${base(packageId)}/reorder`, {
      content_ids: contentIds,
    }),

  remove: (packageId: string, contentId: string, key?: string) =>
    api.delete<PackageContent>(
      `${base(packageId)}/${encodeURIComponent(contentId)}`,
      idemHeaders(key),
    ),

  pushPreview: (
    packageId: string,
    contentId: string,
    params: { audience: PushAudience; mode: PushMode },
  ) =>
    api.get<PushPreview>(
      `${base(packageId)}/${encodeURIComponent(contentId)}/push/preview`,
      { params: { audience: params.audience, mode: params.mode } },
    ),

  push: (
    packageId: string,
    contentId: string,
    body: PushRequest,
    key?: string,
  ) =>
    api.post<PushResult>(
      `${base(packageId)}/${encodeURIComponent(contentId)}/push`,
      body,
      idemHeaders(key),
    ),
};
