/**
 * SC-M1 (agent 168): the space chat's server calls. Shapes from SC-BE1's CONTRACT (b#1135 @ 81ff66f3, comment
 * 6348434182) and SC-BE2's CONTRACT (b#1137, comment 6352782763: the read line). Paths have no /api prefix (services/api adds the base).
 *   GET  community/cohorts/:id/messages?before=&limit=  newest first, deleted and blocked (either way) left out; 404/403 = no access
 *   POST community/cohorts/:id/messages { body }        Idempotency-Key reused on every retry and Try again; FX-IDEM (b#1144,
 *                                                       CONTRACT 6370303541) answers a resend with the first message
 *   DELETE community/messages/:id                       own text message
 *   GET/POST community/cohorts/:id/read                  SC-BE2; any failure (404 before it ships) hides the line
 */
import { z } from 'zod';
import api from '../../../services/api';
import { call } from '../../../api/apiCall';

const SenderSchema = z
  .object({ id: z.string(), name: z.string(), avatar_url: z.string().nullable().optional(), is_coach: z.boolean() })
  .passthrough();
const VoiceSchema = z
  .object({
    id: z.string(),
    duration_ms: z.number(),
    waveform_peaks: z.array(z.number()).nullable().optional(),
  })
  .passthrough();
export const SpaceMessageSchema = z
  .object({
    id: z.string(),
    cohort_id: z.string(),
    sender_user_id: z.string(),
    body: z.string().nullable(),
    // A plain string so a kind this build does not know never fails the page (it is not drawn).
    kind: z.string(),
    created_at: z.string(),
    deleted: z.boolean().optional(),
    parent_message_id: z.string().nullable().optional(),
    voice_note: VoiceSchema.nullable().optional(),
    sender: SenderSchema.optional(),
  })
  .passthrough();
export type SpaceMessage = z.infer<typeof SpaceMessageSchema>;

const PageSchema = z
  .object({ messages: z.array(SpaceMessageSchema), next_before: z.string().nullable() })
  .passthrough();
export type SpaceMessagePage = z.infer<typeof PageSchema>;
const SentSchema = z.object({ message: SpaceMessageSchema }).passthrough();
const ReadSchema = z
  .object({ last_read_at: z.string().nullable(), last_read_message_id: z.string().nullable() })
  .passthrough();
export type SpaceRead = z.infer<typeof ReadSchema>;
const AnySchema = z.unknown();

export const SPACE_PAGE_LIMIT = 30;
export const SPACE_MESSAGE_MAX = 4000;

export const spaceChatApi = {
  list(cohortId: string, before?: string | null): Promise<SpaceMessagePage> {
    return call(
      PageSchema,
      () => api.get<unknown>(`/community/cohorts/${cohortId}/messages`, {
        params: { limit: SPACE_PAGE_LIMIT, ...(before ? { before } : {}) },
      }),
      'space_chat',
    );
  },
  send(cohortId: string, body: string, idempotencyKey: string): Promise<SpaceMessage> {
    return call(
      SentSchema,
      () => api.post<unknown>(`/community/cohorts/${cohortId}/messages`, { body }, {
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      'space_chat',
    ).then((r) => r.message);
  },
  remove(messageId: string): Promise<void> {
    return call(AnySchema, () => api.delete<unknown>(`/community/messages/${messageId}`), 'space_chat').then(
      () => undefined,
    );
  },
  getRead(cohortId: string): Promise<SpaceRead> {
    return call(ReadSchema, () => api.get<unknown>(`/community/cohorts/${cohortId}/read`), 'space_chat');
  },
  markRead(cohortId: string, messageId: string): Promise<void> {
    return call(
      AnySchema,
      () => api.post<unknown>(`/community/cohorts/${cohortId}/read`, { message_id: messageId }),
      'space_chat',
    ).then(() => undefined);
  },
};

/**
 * The server will not show this space (or this route) to the viewer: 404 (unknown space, or no read route yet) or 403
 * (SC-BE2's CONTRACT 6352782763: a non-member, another workspace, or a ban is 403 `community.cohort.no_access`).
 */
export function isNoAccess(err: unknown): boolean {
  const status = !!err && typeof err === 'object' ? (err as { status?: number }).status : undefined;
  return status === 404 || status === 403;
}
