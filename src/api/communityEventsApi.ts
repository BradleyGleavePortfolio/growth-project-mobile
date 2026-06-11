/**
 * communityEventsApi — typed client for the v2-3 Community EVENTS backend
 * surface (BradleyGleavePortfolio/growth-project-backend@feature/community-v2-events).
 *
 * Backend contract source of truth (binding — do NOT drift):
 *   growth-project-backend/src/community/events/community-events.controller.ts
 *   growth-project-backend/src/community/dto/community-event.dto.ts
 *
 * Wire posture (mirrors the existing communityApi.ts doctrine):
 *   - Every response is Zod-validated at the wire boundary so a shape that
 *     drifts from the backend DTO THROWS here (a `contract` error) instead of
 *     feeding malformed data into React state.
 *   - Mutations (create / update / rsvp / replay / reflect) send an
 *     `Idempotency-Key` header (R19) so a double-tap or retry from the same
 *     logical action deduplicates server-side. Optimistic-update rollback
 *     lives in the screen hooks (useCommunityEvents.ts).
 *
 * NO NATIVE LIVE ROOM (Step 0): there is no video provider and no in-app room.
 * An event's `external_url` is an externally-hosted, host-allowlisted link the
 * client opens in the system browser — never a "join native room" affordance.
 *
 * This module imports the EXPORTED `CommunityApiError` from `./communityApi`
 * (the shared typed transport error) and reimplements thin, module-private
 * `call` / `classify` / `idempotentHeaders` helpers locally because those are
 * module-private in communityApi.ts and not re-exported.
 */

import { z } from 'zod';
import axios from 'axios';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';
import { CommunityApiError } from './communityApi';

// ─── Shared enums (mirror backend community-event.dto.ts) ────────────────────

/** Forward-only lifecycle states (Prisma `CommunityEventState`). */
export const COMMUNITY_EVENT_STATES = [
  'scheduled',
  'tomorrow',
  'live',
  'replay',
  'reflected',
] as const;
export type CommunityEventState = (typeof COMMUNITY_EVENT_STATES)[number];

/** All RSVP statuses, including system/coach-derived attendance outcomes. */
export const COMMUNITY_RSVP_STATUSES = [
  'going',
  'maybe',
  'declined',
  'attended',
  'missed',
] as const;
export type CommunityRsvpStatus = (typeof COMMUNITY_RSVP_STATUSES)[number];

/**
 * RSVP statuses a CLIENT may set on themselves. `attended` / `missed` are
 * system/coach-derived attendance outcomes, never self-asserted — so the
 * client UI only ever sends one of these three.
 */
export const COMMUNITY_CLIENT_RSVP_STATUSES = [
  'going',
  'maybe',
  'declined',
] as const;
export type CommunityClientRsvpStatus =
  (typeof COMMUNITY_CLIENT_RSVP_STATUSES)[number];

// ─── Response schemas (Zod, strict — mirror backend) ─────────────────────────

const CommunityEventRsvpCountsSchema = z
  .object({
    going: z.number().int().nonnegative(),
    maybe: z.number().int().nonnegative(),
    declined: z.number().int().nonnegative(),
    attended: z.number().int().nonnegative(),
    missed: z.number().int().nonnegative(),
  })
  .strict();
export type CommunityEventRsvpCounts = z.infer<
  typeof CommunityEventRsvpCountsSchema
>;

export const CommunityEventSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    cohort_id: z.string().uuid().nullable(),
    created_by_user_id: z.string().uuid(),
    title: z.string(),
    description: z.string().nullable(),
    state: z.enum(COMMUNITY_EVENT_STATES),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime().nullable(),
    /** External live OR replay link (no native room exists — Step 0). */
    external_url: z.string().nullable(),
    reflected_at: z.string().datetime().nullable(),
    canceled: z.boolean(),
    rsvp_counts: CommunityEventRsvpCountsSchema,
    /** The caller's own RSVP status, or null when they have not responded. */
    viewer_rsvp_status: z.enum(COMMUNITY_RSVP_STATUSES).nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type CommunityEvent = z.infer<typeof CommunityEventSchema>;

const CommunityEventResponseSchema = z
  .object({ event: CommunityEventSchema })
  .strict();

const CommunityEventListResponseSchema = z
  .object({
    events: z.array(CommunityEventSchema),
    next_before: z.string().nullable(),
  })
  .strict();
export type CommunityEventListResponse = z.infer<
  typeof CommunityEventListResponseSchema
>;

const CommunityRsvpSchema = z
  .object({
    event_id: z.string().uuid(),
    user_id: z.string().uuid(),
    status: z.enum(COMMUNITY_RSVP_STATUSES),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type CommunityRsvp = z.infer<typeof CommunityRsvpSchema>;

const CommunityRsvpResponseSchema = z
  .object({ rsvp: CommunityRsvpSchema })
  .strict();

// ─── Transport helpers (local — communityApi's are module-private) ───────────

function classify(status: number): CommunityApiError['kind'] {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 410) return 'gone';
  if (status >= 500) return 'server';
  if (status === 0) return 'network';
  return 'unknown';
}

/**
 * Run an axios call and normalise failures into a CommunityApiError. ZodErrors
 * (contract drift) are re-wrapped as `contract` so a screen can show a calm
 * "we could not load this" state instead of crashing on a parse throw.
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
      throw new CommunityApiError(
        classify(status),
        status,
        `community events request failed (${status || 'network'})`,
        err,
      );
    }
    throw new CommunityApiError(
      'unknown',
      -1,
      'community events request failed',
      err,
    );
  }
  try {
    return schema.parse(res.data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new CommunityApiError(
        'contract',
        200,
        'community events response shape drifted from the backend contract',
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

// ─── Request input types ─────────────────────────────────────────────────────

export interface CreateEventInput {
  title: string;
  starts_at: string;
  description?: string;
  ends_at?: string;
  cohort_id?: string;
  live_url?: string;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  live_url?: string;
  /** Forward-only lifecycle advance; validated by the backend state machine. */
  state?: CommunityEventState;
}

export interface ListEventsOptions {
  state?: CommunityEventState;
  cohort_id?: string;
  limit?: number;
}

// ─── Endpoint object ─────────────────────────────────────────────────────────

export const communityEventsApi = {
  /**
   * GET /community/workspaces/:workspaceId/events — list events for a
   * workspace, optionally filtered by lifecycle `state` and/or `cohort_id`.
   */
  list(
    workspaceId: string,
    opts: ListEventsOptions = {},
  ): Promise<CommunityEventListResponse> {
    const params: Record<string, string> = {};
    if (opts.state) params.state = opts.state;
    if (opts.cohort_id) params.cohort_id = opts.cohort_id;
    if (opts.limit != null) params.limit = String(opts.limit);
    return call(CommunityEventListResponseSchema, () =>
      api.get<unknown>(`/community/workspaces/${workspaceId}/events`, {
        params,
      }),
    );
  },

  /** GET /community/events/:eventId — single event detail. */
  getOne(eventId: string): Promise<CommunityEvent> {
    return call(CommunityEventResponseSchema, () =>
      api.get<unknown>(`/community/events/${eventId}`),
    ).then((r) => r.event);
  },

  /**
   * POST /community/workspaces/:workspaceId/events — coach creates an event.
   * Idempotent (R19). Coach-only write enforced server-side.
   */
  create(workspaceId: string, input: CreateEventInput): Promise<CommunityEvent> {
    return call(CommunityEventResponseSchema, () =>
      api.post<unknown>(
        `/community/workspaces/${workspaceId}/events`,
        input,
        idempotentHeaders(),
      ),
    ).then((r) => r.event);
  },

  /**
   * PATCH /community/events/:eventId — coach edits fields and/or advances the
   * lifecycle state (forward-only). Idempotent (R19).
   */
  update(eventId: string, input: UpdateEventInput): Promise<CommunityEvent> {
    return call(CommunityEventResponseSchema, () =>
      api.patch<unknown>(
        `/community/events/${eventId}`,
        input,
        idempotentHeaders(),
      ),
    ).then((r) => r.event);
  },

  /**
   * POST /community/events/:eventId/rsvp — client sets/updates their own RSVP.
   * `status` is constrained to going / maybe / declined (attended / missed are
   * system-derived). Idempotent (R19).
   */
  rsvp(
    eventId: string,
    status: CommunityClientRsvpStatus,
  ): Promise<CommunityRsvp> {
    return call(CommunityRsvpResponseSchema, () =>
      api.post<unknown>(
        `/community/events/${eventId}/rsvp`,
        { status },
        idempotentHeaders(),
      ),
    ).then((r) => r.rsvp);
  },

  /**
   * POST /community/events/:eventId/replay — coach attaches an EXTERNAL replay
   * link (host-allowlisted). There is no native replay player — this is an
   * external URL only. Idempotent (R19).
   */
  attachReplay(eventId: string, replayUrl: string): Promise<CommunityEvent> {
    return call(CommunityEventResponseSchema, () =>
      api.post<unknown>(
        `/community/events/${eventId}/replay`,
        { replay_url: replayUrl },
        idempotentHeaders(),
      ),
    ).then((r) => r.event);
  },

  /**
   * POST /community/events/:eventId/reflect — coach closes the loop by moving
   * the event to the `reflected` state. Idempotent (R19).
   */
  reflect(eventId: string): Promise<CommunityEvent> {
    return call(CommunityEventResponseSchema, () =>
      api.post<unknown>(
        `/community/events/${eventId}/reflect`,
        {},
        idempotentHeaders(),
      ),
    ).then((r) => r.event);
  },
};

export type CommunityEventsApi = typeof communityEventsApi;
