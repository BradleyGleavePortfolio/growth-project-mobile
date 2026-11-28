/**
 * LEAVE-MUTE-M (agent 203): the phone's calls to b#1168 (LEAVE-MUTE-BE, CONTRACT 6423745363 and its update 6477611562)
 * and SC-BE2's notification routes (community-space-reads.controller.ts). Every route answers 404
 * community.cohort.not_found for a space the caller cannot read now; a leave the server refuses (Announcements, a section
 * heading, the coach's own space) answers 409 community.space.cannot_leave. Paths have no /api prefix (services/api).
 *   POST   community/cohorts/:id/leave                      -> { cohort_id, left_at }   (leaving twice keeps the first time)
 *   POST   community/cohorts/:id/join                       -> { cohort_id, left_at: null }
 *   GET    community/cohorts/:id/left                       -> { cohort_id, left: [{ user_id, name, left_at }] } oldest first,
 *                                                              newest 200, kept after a rejoin, without blocks either way
 *   GET    community/cohorts/:id/threads                    -> { cohort_id, threads: [{ thread_message_id, state, since }] }
 *   PUT    community/cohorts/:id/threads/:messageId/mute    -> the thread's state (a reply's id resolves to its first message)
 *   DELETE community/cohorts/:id/threads/:messageId/mute    -> 204
 *   PUT    community/cohorts/:id/threads/:messageId/leave   -> the thread's state
 *   DELETE community/cohorts/:id/threads/:messageId/leave   -> 204 (Follow thread)
 *   GET    community/cohorts/:id/notifications              -> { mode, default_mode, effective_mode, silenced_until }
 *   PUT    community/cohorts/:id/notifications { mode }     -> the same
 *   POST   community/cohorts/:id/notifications/silence { hours: 1 | 8 | 24 }  -> the same (Mute all until then)
 *   DELETE community/cohorts/:id/notifications/silence      -> the same
 */
import { z } from 'zod';
import api from '../../../services/api';
import { call } from '../../../api/apiCall';

export const NOTIFY_MODES = ['all', 'mute_low', 'mute_all'] as const;
export type NotifyMode = (typeof NOTIFY_MODES)[number];
export type SilenceHours = 1 | 8 | 24;
export type ThreadStateName = 'muted' | 'left';

const Mode = z.enum(NOTIFY_MODES);
const NotifySchema = z
  .object({ mode: Mode, default_mode: Mode, effective_mode: Mode, silenced_until: z.string().nullable() })
  .passthrough();
export type SpaceNotify = z.infer<typeof NotifySchema>;
const LeaveSchema = z.object({ cohort_id: z.string(), left_at: z.string().nullable() }).passthrough();
export type SpaceLeave = z.infer<typeof LeaveSchema>;
const LeftSchema = z
  .object({ cohort_id: z.string(), left: z.array(z.object({ user_id: z.string(), name: z.string(), left_at: z.string() }).passthrough()) })
  .passthrough();
export type SpaceLeftRow = z.infer<typeof LeftSchema>['left'][number];
const ThreadSchema = z
  .object({ thread_message_id: z.string(), state: z.enum(['muted', 'left']), since: z.string() })
  .passthrough();
export type SpaceThreadState = z.infer<typeof ThreadSchema>;
const ThreadsSchema = z.object({ cohort_id: z.string(), threads: z.array(ThreadSchema) }).passthrough();
const AnySchema = z.unknown();

const base = (cohortId: string) => `/community/cohorts/${cohortId}`;
const threadPath = (cohortId: string, messageId: string, state: ThreadStateName) =>
  `${base(cohortId)}/threads/${messageId}/${state === 'muted' ? 'mute' : 'leave'}`;

export const spaceLeaveMuteApi = {
  leave(cohortId: string): Promise<SpaceLeave> {
    return call(LeaveSchema, () => api.post<unknown>(`${base(cohortId)}/leave`, {}), 'space_chat');
  },
  join(cohortId: string): Promise<SpaceLeave> {
    return call(LeaveSchema, () => api.post<unknown>(`${base(cohortId)}/join`, {}), 'space_chat');
  },
  listLeft(cohortId: string): Promise<SpaceLeftRow[]> {
    return call(LeftSchema, () => api.get<unknown>(`${base(cohortId)}/left`), 'space_chat').then((r) => r.left);
  },
  listThreads(cohortId: string): Promise<SpaceThreadState[]> {
    return call(ThreadsSchema, () => api.get<unknown>(`${base(cohortId)}/threads`), 'space_chat').then((r) => r.threads);
  },
  setThread(cohortId: string, messageId: string, state: ThreadStateName): Promise<SpaceThreadState> {
    return call(ThreadSchema, () => api.put<unknown>(threadPath(cohortId, messageId, state), {}), 'space_chat');
  },
  clearThread(cohortId: string, messageId: string, state: ThreadStateName): Promise<void> {
    return call(AnySchema, () => api.delete<unknown>(threadPath(cohortId, messageId, state)), 'space_chat').then(() => undefined);
  },
  getNotify(cohortId: string): Promise<SpaceNotify> {
    return call(NotifySchema, () => api.get<unknown>(`${base(cohortId)}/notifications`), 'space_chat');
  },
  setMode(cohortId: string, mode: NotifyMode): Promise<SpaceNotify> {
    return call(NotifySchema, () => api.put<unknown>(`${base(cohortId)}/notifications`, { mode }), 'space_chat');
  },
  silence(cohortId: string, hours: SilenceHours): Promise<SpaceNotify> {
    return call(NotifySchema, () => api.post<unknown>(`${base(cohortId)}/notifications/silence`, { hours }), 'space_chat');
  },
  unsilence(cohortId: string): Promise<SpaceNotify> {
    return call(NotifySchema, () => api.delete<unknown>(`${base(cohortId)}/notifications/silence`), 'space_chat');
  },
};
