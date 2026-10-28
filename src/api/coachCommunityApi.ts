/**
 * coachCommunityApi — typed client for the v1-6 Community COACH backend
 * (growth-project-backend@2fa6b57e, three controllers:
 * `community-cohort-write`, `community-cohort-members`, `community-coach-inbox`).
 *
 * This is a NEW file dedicated to the coach-only v1-6 surface. It does NOT
 * touch `communityApi.ts` (the client-side API). The two clients share the
 * same axios instance (`services/api`), the same Zod-at-the-boundary doctrine,
 * and the same idempotency contract, but their endpoint sets are disjoint.
 *
 * Backend contract source of truth (binding — do NOT drift):
 *   growth-project-backend/src/community/coach-inbox/community-coach-inbox.controller.ts
 *   growth-project-backend/src/community/cohorts/community-cohort-write.controller.ts
 *   growth-project-backend/src/community/cohorts/community-cohort-members.controller.ts
 *   growth-project-backend/src/community/moderation/community-moderation.controller.ts
 *
 * Auth posture (hard gate §2.3 / AGENT_RULES):
 *   - Every request carries the caller's JWT via the shared axios instance's
 *     request interceptor (services/api). The backend derives the acting coach
 *     from that token. This client NEVER accepts or sends a `coachId` param —
 *     a coach can only ever read or mutate their OWN tenant-scoped resources.
 *     Passing a foreign coachId is structurally impossible through this API.
 *   - Mutations send an `Idempotency-Key` header (R19) so a double-tap or
 *     retry from the same logical action deduplicates server-side. Optimistic
 *     update + rollback lives in the screen hooks, not here.
 *   - Every response is Zod-validated at the wire boundary; a shape that drifts
 *     from the backend DTO throws a `contract` CoachCommunityApiError here
 *     instead of feeding malformed data into React state.
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';
import { featureFlags } from '../config/featureFlags';

// ─── Shared enums (mirror backend) ───────────────────────────────────────────

/** Moderation surface targets a post or a message. */
export const COACH_MOD_TARGET_TYPES = ['post', 'message', 'voice_note', 'win'] as const;
export type CoachModTargetType = (typeof COACH_MOD_TARGET_TYPES)[number];

/** Moderation decisions accepted by PATCH /community/moderation/items/:id. */
export const COACH_MODERATION_ACTIONS = ['hide', 'warn', 'ban', 'dismiss'] as const;
export type CoachModerationAction = (typeof COACH_MODERATION_ACTIONS)[number];

/** Cohort membership role enum (mirrors the client API role language). */
export const COACH_COHORT_MEMBER_ROLES = ['client', 'coach', 'owner'] as const;
export type CoachCohortMemberRole =
  (typeof COACH_COHORT_MEMBER_ROLES)[number];

// ─── v2-2 coach ack signals (mirror backend src/community/ack/ack.dto.ts) ─────

/**
 * The four ordered ack states. Badge precedence is
 * `replied > acked > seen > none`; the backend derives the highest reached
 * state from the existing `coach_*_at` columns. These are COACH-SIDE-ONLY
 * signals shown TO the client — the client can never mutate them.
 */
export const COACH_ACK_STATES = ['none', 'seen', 'acked', 'replied'] as const;
export type CoachAckState = (typeof COACH_ACK_STATES)[number];

/**
 * Monotonic rank for badge precedence and to forbid backward transitions
 * (cannot un-ack a replied message). Higher wins. Mirrors the backend
 * `ACK_STATE_RANK`.
 */
export const ACK_STATE_RANK: Record<CoachAckState, number> = {
  none: 0,
  seen: 1,
  acked: 2,
  replied: 3,
};

/** The three SLA states, derived from elapsed time vs configured thresholds. */
export const COACH_SLA_STATES = ['within', 'warning', 'breached'] as const;
export type CoachSlaState = (typeof COACH_SLA_STATES)[number];

// ─── Response schemas (mirror backend Zod DTOs) ──────────────────────────────

/**
 * The coach landing counts. The server has no dashboard route: getDashboard()
 * builds this from GET /community/cohorts, GET /community/me/coach-inbox and
 * GET /community/moderation/flagged.
 */
export const CoachDashboardSchema = z
  .object({
    unread_inbox_count: z.number().int().nonnegative(),
    active_cohort_count: z.number().int().nonnegative(),
    flagged_today_count: z.number().int().nonnegative(),
  })
  .passthrough();
export type CoachDashboard = z.infer<typeof CoachDashboardSchema>;

/** Voice row extras: community-coach-inbox.dto.ts:48. */
const InboxVoiceSchema = z
  .object({ note_id: z.string().uuid(), duration_ms: z.number().int().nonnegative() })
  .passthrough();

/** Per-row ack summary: community-coach-inbox.dto.ts:25-31. */
export const InboxAckSummarySchema = z
  .object({ state: z.enum(COACH_ACK_STATES), sla_state: z.enum(COACH_SLA_STATES) })
  .passthrough();
export type InboxAckSummary = z.infer<typeof InboxAckSummarySchema>;

/**
 * A single aggregated inbox item — an unanswered client signal surfaced across
 * all of the coach's cohorts. `avatar_url` is nullable so the row falls back to
 * a monogram badge built from `client_name`.
 */
export const CoachInboxItemSchema = z
  .object({
    id: z.string().uuid(),
    cohort_id: z.string().uuid(),
    cohort_name: z.string(),
    client_user_id: z.string().uuid(),
    client_name: z.string(),
    avatar_url: z.string().nullable(),
    snippet: z.string(),
    /** ISO timestamp of the unanswered item; the row renders a relative age. */
    created_at: z.string(),
    acknowledged: z.boolean(),
    /** Only message rows carry coach acks; a voice row's id is the note's id. */
    type: z.enum(['message', 'post']),
    kind: z.enum(['text', 'voice']),
    voice: InboxVoiceSchema.optional(),
    ack: InboxAckSummarySchema.optional(),
  })
  .passthrough();
export type CoachInboxItem = z.infer<typeof CoachInboxItemSchema>;

/** One page of the coach inbox, mapped from GET /community/me/coach-inbox. */
export const CoachInboxPageSchema = z
  .object({
    items: z.array(CoachInboxItemSchema),
    /** Opaque cursor for the next page, or null at the end. */
    next_cursor: z.string().nullable(),
  })
  .passthrough();
export type CoachInboxPage = z.infer<typeof CoachInboxPageSchema>;

/** A cohort summary as seen by its owning coach. */
export const CoachCohortSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    member_count: z.number().int().nonnegative(),
    /** Unread per space: the server sends none yet, so this is always 0. */
    unread_count: z.number().int().nonnegative(),
    created_at: z.string().optional(),
  })
  .passthrough();
export type CoachCohort = z.infer<typeof CoachCohortSchema>;

/** The coach's cohorts (tenant-scoped). */
export const CoachCohortListSchema = z
  .object({ cohorts: z.array(CoachCohortSchema) })
  .passthrough();
export type CoachCohortList = z.infer<typeof CoachCohortListSchema>;

/** A single cohort member as seen on the detail screen. */
export const CoachCohortMemberSchema = z
  .object({
    user_id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    avatar_url: z.string().nullable(),
    role: z.enum(COACH_COHORT_MEMBER_ROLES),
    joined_at: z.string().nullable(),
  })
  .passthrough();
export type CoachCohortMember = z.infer<typeof CoachCohortMemberSchema>;

/** Cohort header + member list (GET /community/cohorts/:id + its members). */
export const CoachCohortDetailSchema = z
  .object({
    cohort: CoachCohortSchema,
    members: z.array(CoachCohortMemberSchema),
  })
  .passthrough();
export type CoachCohortDetail = z.infer<typeof CoachCohortDetailSchema>;

/**
 * Playable media on a flagged voice note: a short-lived (15 minute) signed
 * link, or null when storage signing is unavailable. Pull to refresh mints a
 * new link.
 */
export const CoachFlaggedMediaSchema = z
  .object({
    kind: z.literal('voice_note'),
    url: z.string().nullable(),
    duration_ms: z.number().int().nonnegative(),
    mime_type: z.string(),
  })
  .passthrough();
export type CoachFlaggedMedia = z.infer<typeof CoachFlaggedMediaSchema>;

/**
 * What the affected member was told after hide / warn / ban (B-610-4,
 * B-314-6). `stored` means the backend wrote a member-readable notice in the
 * same transaction (they read it in Community safety); `push` is only ever an
 * attempted extra, never a promise of delivery. Absent for dismiss.
 */
export const CoachModerationMemberNoticeSchema = z
  .object({ stored: z.boolean(), push: z.enum(['attempted', 'not_sent']) })
  .passthrough();
export type CoachModerationMemberNotice = z.infer<typeof CoachModerationMemberNoticeSchema>;

const ModerationDecisionResponseSchema = z
  .object({ member_notice: CoachModerationMemberNoticeSchema.optional() })
  .passthrough();

/** The result of a moderation decision the queue needs for its confirmation copy. */
export interface CoachModerationOutcome {
  memberNotice: CoachModerationMemberNotice | null;
}

/** A single flagged-content item awaiting a moderation decision. */
export const CoachFlaggedItemSchema = z
  .object({
    id: z.string().uuid(),
    target_type: z.enum(COACH_MOD_TARGET_TYPES),
    /** The post, message, voice note or win id the decision will act on. */
    target_id: z.string().uuid(),
    /** Voice notes only: what the reviewer plays (audio is not text-filtered). */
    media: CoachFlaggedMediaSchema.nullable().optional(),
    /** True when the content was already hidden or deleted. */
    removed: z.boolean().optional(),
    /** created_at + 24 hours: the published review commitment. */
    respond_by: z.string().optional(),
    /** Still open past respond_by. */
    overdue: z.boolean().optional(),
    /** The offending content body, surfaced verbatim for the reviewer. */
    content: z.string(),
    author_name: z.string(),
    cohort_name: z.string().nullable(),
    /** Coarse reason label from the report pipeline (never a raw message). */
    reason: z.string(),
    /** Author of the reported content (null when the content is gone). */
    author_user_id: z.string().uuid().nullable().optional(),
    created_at: z.string(),
  })
  .passthrough();
export type CoachFlaggedItem = z.infer<typeof CoachFlaggedItemSchema>;

/** GET /community/moderation/flagged — the flagged-content review queue. */
export const CoachFlaggedListSchema = z
  .object({ items: z.array(CoachFlaggedItemSchema) })
  .passthrough();
export type CoachFlaggedList = z.infer<typeof CoachFlaggedListSchema>;

// ─── Roman empty-state payload (operator-locked face+voice contract) ─────────

/**
 * Avatar crop for a Roman-voiced surface. Mirrors the backend
 * voice-policy.constants AVATAR_CROPS. `monogram` is the universal fallback;
 * `neutral`/`smile` are the empty-state crops.
 */
export const CoachAvatarCropSchema = z.enum(['monogram', 'smile', 'neutral']);
export type CoachAvatarCrop = z.infer<typeof CoachAvatarCropSchema>;

/** Which backend copy map a payload was composed from (analytics signal). */
export const CoachVoiceVariantSchema = z.enum(['legacy', 'roman_v2']);
export type CoachVoiceVariant = z.infer<typeof CoachVoiceVariantSchema>;

/**
 * The five v1-6 coach-community empty-state surfaces. Mirrors the backend
 * SURFACE_KEYS exactly (the coach lab surface was removed from v1-6 — it had
 * no backend write — so there is no `coach_community_lab_empty`).
 */
export const CoachEmptyStateSurfaceKeySchema = z.enum([
  'coach_community_home_empty',
  'coach_community_inbox_empty',
  'coach_community_cohorts_empty',
  'coach_community_cohort_members_empty',
  'coach_community_moderation_empty',
]);
export type CoachEmptyStateSurfaceKey = z.infer<
  typeof CoachEmptyStateSurfaceKeySchema
>;

export const COACH_EMPTY_STATE_SURFACE_KEYS =
  CoachEmptyStateSurfaceKeySchema.options;

/**
 * The composed Roman copy payload for a single surface. `passthrough()` so a
 * future additive backend field (e.g. an `avatar_url`) does not fail the
 * boundary parse; the four contract fields are required and typed.
 */
export const RomanCopyPayloadSchema = z
  .object({
    text: z.string().min(1),
    avatar_crop: CoachAvatarCropSchema,
    surface_key: CoachEmptyStateSurfaceKeySchema,
    voice_variant: CoachVoiceVariantSchema,
  })
  .passthrough();
export type RomanCopyPayload = z.infer<typeof RomanCopyPayloadSchema>;

/** GET /community/coach/empty-states — every surface keyed by surface_key. */
export const CoachEmptyStatesResponseSchema = z.record(
  CoachEmptyStateSurfaceKeySchema,
  RomanCopyPayloadSchema,
);
export type CoachEmptyStatesResponse = z.infer<
  typeof CoachEmptyStatesResponseSchema
>;

// ─── Post detail (coach post-detail surface) ─────────────────────────────────

/** A single community post as returned by GET /community/posts/:id. */
export const CoachPostSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    cohort_id: z.string().uuid().nullable(),
    author_user_id: z.string().uuid(),
    title: z.string().nullable(),
    body: z.string().nullable(),
    scope: z.enum(['hall', 'cohort']),
    type: z.enum(['text', 'lesson', 'replay', 'poll', 'win']),
    pinned: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
    deleted: z.boolean(),
  })
  .passthrough();
export type CoachPost = z.infer<typeof CoachPostSchema>;

/** A single reply/comment on a post (GET /community/posts/:id/comments). */
export const CoachPostCommentSchema = z
  .object({
    id: z.string().uuid(),
    // The backend comment view derives post_id from a nullable column and may
    // emit an empty string, so this is a plain string (not a uuid) by design.
    post_id: z.string(),
    author_user_id: z.string().uuid(),
    body: z.string(),
    created_at: z.string(),
  })
  .passthrough();
export type CoachPostComment = z.infer<typeof CoachPostCommentSchema>;

/** Composed post-detail view consumed by CoachCommunityPostDetailScreen. */
export interface CoachPostDetail {
  post: CoachPost;
  comments: CoachPostComment[];
}

// ─── v2-2 ack envelope schemas (mirror backend Zod DTOs exactly) ────────────

/**
 * The read-time SLA snapshot for a message: the derived state plus the inputs
 * that produced it, so the badge can render a countdown without re-deriving
 * the thresholds. `elapsed_ms` is time since message receipt; the soft/hard
 * thresholds are the configured targets (env-configurable on the backend,
 * default 24h soft / 48h hard).
 */
export const CoachSlaSnapshotSchema = z
  .object({
    sla_state: z.enum(COACH_SLA_STATES),
    elapsed_ms: z.number().int().nonnegative(),
    soft_target_ms: z.number().int().positive(),
    hard_target_ms: z.number().int().positive(),
  })
  .strict();
export type CoachSlaSnapshot = z.infer<typeof CoachSlaSnapshotSchema>;

/**
 * The ack envelope returned by every transition endpoint and (additively)
 * attached to a message view when the flag is ON. `seen_at`/`acked_at`/
 * `replied_at` mirror the existing `coach_*_at` columns (ISO strings or null);
 * `state` is the derived highest reached state; `sla` is the read-time SLA
 * snapshot.
 */
export const AckStateSchema = z
  .object({
    state: z.enum(COACH_ACK_STATES),
    seen_at: z.string().datetime().nullable(),
    acked_at: z.string().datetime().nullable(),
    replied_at: z.string().datetime().nullable(),
    sla: CoachSlaSnapshotSchema,
  })
  .strict();
export type AckStateDto = z.infer<typeof AckStateSchema>;

/**
 * POST /community/ack/:messageId/(seen|acked|replied) response envelope.
 * Mirrors the backend `AckTransitionResponseSchema`.
 */
export const AckTransitionResponseSchema = z
  .object({
    message_id: z.string().uuid(),
    ack: AckStateSchema,
  })
  .strict();
export type AckTransitionResponse = z.infer<typeof AckTransitionResponseSchema>;

// ─── Typed error ─────────────────────────────────────────────────────────────

/**
 * The bounded set of backend ack error codes the mobile client reconciles
 * against. The v2-2 backend returns `community.ack.illegal_transition` (HTTP
 * 409) when a coach attempts a transition the server rejects because the
 * message state changed underneath them (e.g. another device already advanced
 * it). We parse ONLY this known code from the error body; any other shape is
 * left as `undefined` so the UI falls back to its generic conflict handling.
 */
export const ACK_ILLEGAL_TRANSITION_CODE = 'community.ack.illegal_transition';
export type CoachAckErrorCode = typeof ACK_ILLEGAL_TRANSITION_CODE;

/**
 * Transport / contract error surfaced to the screen hooks. `.status` lets the
 * UI branch on 401 (auth), 403 (forbidden — e.g. a non-coach role or a foreign
 * tenant), 404/410 (gone), 409 (conflict — a server-rejected state transition),
 * and 5xx (server) without re-parsing the axios error. `kind` is a coarse,
 * bounded label (never a raw server message) for telemetry / logging. `code`
 * carries the bounded backend error code when the body matched a known one
 * (currently only `community.ack.illegal_transition`).
 */
export class CoachCommunityApiError extends Error {
  constructor(
    public readonly kind:
      | 'unauthorized'
      | 'forbidden'
      | 'gone'
      | 'conflict'
      | 'server'
      | 'network'
      | 'contract'
      | 'unknown',
    public readonly status: number,
    message: string,
    public readonly cause?: unknown,
    public readonly code?: CoachAckErrorCode,
  ) {
    super(message);
    this.name = 'CoachCommunityApiError';
    Object.setPrototypeOf(this, CoachCommunityApiError.prototype);
  }
}

function classify(status: number): CoachCommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'gone';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/**
 * Extract the bounded backend ack error code from an axios error body, if it
 * matches a known code. The backend convention is a JSON body of the shape
 * `{ code: 'community.ack.illegal_transition', ... }` (NestJS exception
 * filter). We never surface a raw server message — only the recognised code.
 */
function parseAckErrorCode(data: unknown): CoachAckErrorCode | undefined {
  if (data == null || typeof data !== 'object') return undefined;
  const code = (data as { code?: unknown }).code;
  return code === ACK_ILLEGAL_TRANSITION_CODE
    ? ACK_ILLEGAL_TRANSITION_CODE
    : undefined;
}

/**
 * Run an axios call and normalise failures into a CoachCommunityApiError.
 * ZodErrors (contract drift) are re-wrapped as `contract` so a screen can show
 * a calm "we could not load this" state instead of crashing on a parse throw.
 */
async function call<T>(
  schema: z.ZodType<T>,
  fn: () => Promise<{ data: unknown }>,
): Promise<T> {
  let res: { data: unknown };
  try {
    res = await fn();
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 0;
      throw new CoachCommunityApiError(
        classify(status),
        status,
        `coach community request failed (${status || 'network'})`,
        err,
        status === 409 ? parseAckErrorCode(err.response?.data) : undefined,
      );
    }
    throw new CoachCommunityApiError(
      'unknown',
      -1,
      'coach community request failed',
      err,
    );
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CoachCommunityApiError(
        'contract',
        200,
        'coach community response shape drifted from the backend contract',
        err,
      );
    }
    throw err;
  }
}

function idempotentHeaders(): { headers: Record<string, string> } {
  // R19 — client-generated key so a retried mutation deduplicates server-side.
  return { headers: { 'Idempotency-Key': generateIdempotencyKey() } };
}

// ─── Server wire shapes (growth-project-backend main 7359c3f9) ──────────────
// The coach pages call the server's own community routes. These schemas copy
// the fields the phone reads from the backend DTOs (file:line on each) and map
// them onto the Coach* types the screens already use.

/** GET /community/cohorts row: src/community/dto/community-cohort.dto.ts:16-28. */
const CohortSummaryWireSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    name: z.string(),
    member_count: z.number().int().nonnegative(),
  })
  .passthrough();

/** GET /community/cohorts: community-cohort.dto.ts:30-35. */
const CohortListWireSchema = z
  .object({ cohorts: z.array(CohortSummaryWireSchema) })
  .passthrough();

/** GET /community/cohorts/:id (flat, no envelope): community-cohort.dto.ts:41-64. */
const CohortWireSchema = CohortSummaryWireSchema.extend({
  created_at: z.string(),
});

/**
 * POST /community/workspaces/:id/cohorts response `{ cohort }`:
 * src/community/cohorts/community-cohort.dto.ts:124-143 and :149-151.
 */
const CohortAdminWireSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    name: z.string(),
    created_at: z.string(),
  })
  .passthrough();

/** GET /community/me, the field used here: src/community/dto/community-me.dto.ts:27. */
const MeWorkspaceWireSchema = z
  .object({ workspace_id: z.string().uuid().nullable() })
  .passthrough();

/** Roster row: src/community/cohorts/community-cohort-members.dto.ts:60-81. */
const MemberWireSchema = z
  .object({
    user_id: z.string().uuid(),
    display_name: z.string(),
    role: z.enum(['student', 'co_coach', 'coach']),
    status: z.enum(['invited', 'active', 'muted', 'removed']).nullable(),
    email: z.string().nullable(),
    joined_at: z.string().nullable(),
  })
  .passthrough();
type MemberWire = z.infer<typeof MemberWireSchema>;

/** GET members: community-cohort-members.dto.ts:85-90. */
const MemberListWireSchema = z
  .object({
    members: z.array(MemberWireSchema),
    next_cursor: z.string().nullable(),
  })
  .passthrough();

/** POST / DELETE member response `{ member }`: community-cohort-members.dto.ts:96-98. */
const MemberResponseWireSchema = z
  .object({ member: MemberWireSchema })
  .passthrough();

/** Server roster role -> the role words the detail screen already shows. */
const MEMBER_ROLE: Record<MemberWire['role'], CoachCohortMemberRole> = {
  student: 'client',
  co_coach: 'coach',
  coach: 'owner',
};

function toMember(m: MemberWire): CoachCohortMember {
  const { display_name, role, ...rest } = m;
  return {
    ...rest,
    name: display_name,
    avatar_url: null,
    role: MEMBER_ROLE[role],
  };
}

function toCohort(c: {
  id: string;
  name: string;
  member_count?: number;
  created_at?: string;
}): CoachCohort {
  return { ...c, member_count: c.member_count ?? 0, unread_count: 0 };
}

/** Same calendar day on this phone. */
function isToday(iso: string, now: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

// ─── Endpoint hooks ──────────────────────────────────────────────────────────

// ─── Coach inbox wire shape (community-coach-inbox.dto.ts) ──────────────────

/** Largest page the inbox and roster routes return (MAX_PAGE = 100). */
const PAGE_LIMIT = 100;

/** Inbox row kinds this build can draw; any other kind is skipped. Read per call, not at import. */
const inboxRowKinds = (): readonly string[] =>
  featureFlags.communityVoiceNotes ? ['text', 'voice'] : ['text'];

/** One inbox row: src/community/inbox/community-coach-inbox.dto.ts:34-52. */
const InboxRowWireSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(['message', 'post']),
    cohort_id: z.string().uuid(),
    cohort_name: z.string(),
    author_user_id: z.string().uuid(),
    author_display_name: z.string(),
    preview: z.string(),
    created_at: z.string(),
    kind: z.string().optional(),
    voice: InboxVoiceSchema.optional(),
    ack: InboxAckSummarySchema.optional().catch(undefined),
  })
  .passthrough();

/** GET /community/me/coach-inbox: community-coach-inbox.dto.ts:57-62. */
const InboxPageWireSchema = z
  .object({ items: z.array(z.unknown()), next_cursor: z.string().nullable() })
  .passthrough();

/** Parse each row on its own: a row this build cannot read is skipped. */
function toInboxItems(rows: unknown[]): CoachInboxItem[] {
  const out: CoachInboxItem[] = [];
  for (const raw of rows) {
    const parsed = InboxRowWireSchema.safeParse(raw);
    if (!parsed.success) continue;
    const { author_user_id, author_display_name, preview, kind, ...rest } =
      parsed.data;
    const rowKind = kind ?? 'text';
    if (!inboxRowKinds().includes(rowKind)) continue;
    if (rowKind === 'voice' && !rest.voice) continue;
    out.push({
      ...rest,
      kind: rowKind as CoachInboxItem['kind'],
      client_user_id: author_user_id,
      client_name: author_display_name,
      avatar_url: null,
      snippet: preview,
      // The server lists only unanswered items, so none are acknowledged.
      acknowledged: false,
    });
  }
  return out;
}

/** 403 body when the caller owns no cohorts: community-coach-inbox.service.ts:24-27. */
const INBOX_NOT_COACH_CODE = 'community.inbox.not_coach';

function isInboxNotCoach(err: unknown): boolean {
  if (!(err instanceof CoachCommunityApiError) || err.status !== 403) {
    return false;
  }
  const cause = err.cause;
  if (!axios.isAxiosError(cause)) return false;
  const data = cause.response?.data as { code?: unknown } | undefined;
  return data?.code === INBOX_NOT_COACH_CODE;
}

export const coachCommunityApi = {
  /**
   * The coach landing counts, built on the phone (the server has no dashboard
   * route): spaces from GET /community/cohorts, unanswered items from the
   * first inbox page, and reports opened today from the flagged queue. The
   * acting coach is derived from the JWT; no coachId is sent.
   */
  async getDashboard(): Promise<CoachDashboard> {
    const [cohorts, inbox, flagged] = await Promise.all([
      coachCommunityApi.getCohorts(),
      coachCommunityApi.getInbox({ limit: PAGE_LIMIT }),
      coachCommunityApi.getFlagged(),
    ]);
    const now = new Date();
    return {
      unread_inbox_count: inbox.items.length,
      active_cohort_count: cohorts.length,
      flagged_today_count: flagged.filter((f) => isToday(f.created_at, now))
        .length,
    };
  },

  /**
   * GET /community/me/coach-inbox?cursor=&limit= — unanswered items across the
   * coach's cohorts (community-coach-inbox.controller.ts:25), oldest first. A
   * coach who owns no cohorts gets a 403 `community.inbox.not_coach`, shown as
   * an empty inbox.
   */
  async getInbox(
    opts: { cursor?: string; limit?: number } = {},
  ): Promise<CoachInboxPage> {
    const params: Record<string, string> = {
      limit: String(opts.limit ?? PAGE_LIMIT),
    };
    if (opts.cursor) params.cursor = opts.cursor;
    try {
      const page = await call(InboxPageWireSchema, () =>
        api.get<unknown>('/community/me/coach-inbox', { params }),
      );
      return { items: toInboxItems(page.items), next_cursor: page.next_cursor };
    } catch (err) {
      if (isInboxNotCoach(err)) return { items: [], next_cursor: null };
      throw err;
    }
  },

  /**
   * POST /community/ack/:messageId/seen — v2-2 coach ack transition. Stamps the
   * `seen` signal on a client message and returns the full ack envelope (state
   * + SLA snapshot). Idempotent (R19): re-stamping is a server-side no-op that
   * returns the existing timestamp. The acting coach is derived from the JWT;
   * no coachId is sent.
   */
  markCoachAckSeen(messageId: string): Promise<AckTransitionResponse> {
    return call(AckTransitionResponseSchema, () =>
      api.post<unknown>(
        `/community/ack/${messageId}/seen`,
        {},
        idempotentHeaders(),
      ),
    );
  },

  /**
   * POST /community/ack/:messageId/acked — v2-2 coach ack transition. Stamps
   * the `acked` signal. Idempotent (R19); monotonic on the backend (cannot
   * regress a message that has already reached `replied`).
   */
  markCoachAckAcked(messageId: string): Promise<AckTransitionResponse> {
    return call(AckTransitionResponseSchema, () =>
      api.post<unknown>(
        `/community/ack/${messageId}/acked`,
        {},
        idempotentHeaders(),
      ),
    );
  },

  /**
   * POST /community/ack/:messageId/replied — v2-2 coach ack transition. Stamps
   * the strongest `replied` signal. Idempotent (R19).
   */
  markCoachAckReplied(messageId: string): Promise<AckTransitionResponse> {
    return call(AckTransitionResponseSchema, () =>
      api.post<unknown>(
        `/community/ack/${messageId}/replied`,
        {},
        idempotentHeaders(),
      ),
    );
  },

  /**
   * GET /community/cohorts (community.controller.ts:71). A first-run coach has
   * none until GET /community/me sets up the two default spaces, so read again.
   */
  async getCohorts(): Promise<CoachCohort[]> {
    const list = () =>
      call(CohortListWireSchema, () => api.get<unknown>('/community/cohorts'));
    let r = await list();
    if (r.cohorts.length === 0) {
      await call(MeWorkspaceWireSchema, () => api.get<unknown>('/community/me'));
      r = await list();
    }
    return r.cohorts.map(toCohort);
  },

  /**
   * POST /community/workspaces/:workspaceId/cohorts — create a space
   * (community-cohort-write.controller.ts:40). The workspace id comes from
   * GET /community/me, which also sets up the coach's workspace on first use
   * (community.service.ts:106). Idempotent (R19). Optimistic insert +
   * rollback lives in the screen hook.
   */
  async createCohort(input: { name: string }): Promise<CoachCohort> {
    const me = await call(MeWorkspaceWireSchema, () =>
      api.get<unknown>('/community/me'),
    );
    const workspaceId = me.workspace_id;
    if (workspaceId == null) {
      throw new CoachCommunityApiError(
        'contract',
        200,
        'coach community: no workspace for this coach',
      );
    }
    return call(z.object({ cohort: CohortAdminWireSchema }).passthrough(), () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/cohorts`,
        { name: input.name },
        idempotentHeaders(),
      ),
    ).then((r) => toCohort(r.cohort));
  },

  /**
   * GET /community/cohorts/:id (community.controller.ts:79) and GET
   * /community/cohorts/:id/members (community-cohort-members.controller.ts:40)
   * — the space header and its whole roster, page by page. Removed members
   * are left out; the owning coach stays in, as in the server's member_count.
   */
  async getCohortDetail(cohortId: string): Promise<CoachCohortDetail> {
    const rosterPage = (cursor: string | null) =>
      call(MemberListWireSchema, () =>
        api.get<unknown>(`/community/cohorts/${cohortId}/members`, {
          params: { limit: String(PAGE_LIMIT), ...(cursor ? { cursor } : {}) },
        }),
      );
    const [cohort, first] = await Promise.all([
      call(CohortWireSchema, () =>
        api.get<unknown>(`/community/cohorts/${cohortId}`),
      ),
      rosterPage(null),
    ]);
    const members = [...first.members];
    for (let next = first.next_cursor; next; ) {
      const page = await rosterPage(next);
      members.push(...page.members);
      next = page.next_cursor;
    }
    return {
      cohort: toCohort(cohort),
      members: members.filter((m) => m.status !== 'removed').map(toMember),
    };
  },

  /**
   * POST /community/cohorts/:id/members — add a client by email as a student
   * (community-cohort-members.controller.ts:52; `role` is required,
   * community-cohort-members.dto.ts:34-35). Idempotent (R19).
   */
  inviteMember(
    cohortId: string,
    input: { email: string },
  ): Promise<CoachCohortMember> {
    return call(MemberResponseWireSchema, () =>
      api.post<unknown>(
        `/community/cohorts/${cohortId}/members`,
        { email: input.email, role: 'student' },
        idempotentHeaders(),
      ),
    ).then((r) => toMember(r.member));
  },

  /**
   * DELETE /community/cohorts/:id/members/:userId — remove a member
   * (community-cohort-members.controller.ts:64). Always confirmed in the UI
   * before this fires (hard gate §2.3).
   */
  removeMember(cohortId: string, userId: string): Promise<void> {
    return call(z.unknown(), () =>
      api.delete<unknown>(`/community/cohorts/${cohortId}/members/${userId}`),
    ).then(() => undefined);
  },

  /** GET /community/moderation/flagged — the flagged-content review queue. */
  getFlagged(): Promise<CoachFlaggedItem[]> {
    return call(CoachFlaggedListSchema, () =>
      api.get<unknown>('/community/moderation/flagged'),
    ).then((r) => r.items);
  },

  /**
   * GET /community/coach/empty-states — the operator-locked Roman copy payload
   * for every v1-6 coach-community empty-state surface, keyed by surface_key.
   * Validated at the wire boundary; a missing surface key throws a `contract`
   * error (caught here as a Zod drift) so the client never silently falls back
   * to constants on a successful 200.
   */
  getCoachEmptyStates(): Promise<CoachEmptyStatesResponse> {
    return call(CoachEmptyStatesResponseSchema, () =>
      api.get<unknown>('/community/coach/empty-states'),
    );
  },

  /**
   * GET /community/posts/:id (+ /comments) — the post-detail view for the
   * coach post-detail surface. The coach role can read any post in their
   * tenant via the existing posts controller (Roles: coach). Two reads are
   * composed into one CoachPostDetail; both are Zod-validated.
   */
  async getCoachPostDetail(postId: string): Promise<CoachPostDetail> {
    const post = await call(
      z.object({ post: CoachPostSchema }).passthrough(),
      () => api.get<unknown>(`/community/posts/${postId}`),
    ).then((r) => r.post);
    const comments = await call(
      z.object({ comments: z.array(CoachPostCommentSchema) }).passthrough(),
      () => api.get<unknown>(`/community/posts/${postId}/comments`),
    ).then((r) => r.comments);
    return { post, comments };
  },

  /**
   * PATCH /community/moderation/items/:id — act on a queued report (coach of
   * that workspace or platform owner only; server-enforced).
   *   hide    — removes the content for everyone
   *   warn    — notifies the author; access kept
   *   ban     — removes the author's access to the community space AND hides
   *             the content (the coach / platform owner can never be banned)
   *   dismiss — closes the report with no action
   * Destructive actions are always confirmed in the UI first. Idempotent (R19).
   * Replaces the never-implemented POST /community/{posts,messages}/:id/hide.
   */
  actOnItem(
    itemId: string,
    action: CoachModerationAction,
    notes?: string,
  ): Promise<CoachModerationOutcome> {
    return call(ModerationDecisionResponseSchema, () =>
      api.patch<unknown>(
        `/community/moderation/items/${itemId}`,
        notes ? { action, notes } : { action },
        idempotentHeaders(),
      ),
    ).then((r) => ({ memberNotice: r.member_notice ?? null }));
  },
};

export type CoachCommunityApi = typeof coachCommunityApi;
