/**
 * FR-871R7 (agent 180; m#871 Sol B871-1 / Opus B1): who is in a space, for the member's Space info sheet.
 *
 *   GET community/cohorts/:id/members?cursor=&limit=   backend community-cohort-members.controller.ts (on main): someone
 *       who can read the space reads its people, 50 a page by default, in user id order, with the two-way block filter and
 *       the space's name rule (first names; full names in a space for the coach's clients). Anyone who cannot read the
 *       space gets 404, like an unknown space.
 *
 * Only what the sheet draws is read: who (user_id), the name and the role. A member's answer carries no email, status or
 * join date, and the sheet would not draw them if it did. Kept in memory only (meta persist: false), so other people's
 * names stay off the disk; the sheet asks again each time it opens.
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { z } from 'zod';
import api from '../../../services/api';
import { call } from '../../../api/apiCall';

const MemberSchema = z
  .object({
    user_id: z.string(),
    display_name: z.string(),
    // 'coach' | 'co_coach' | 'student'; a plain string, so a role added later draws as a member instead of failing.
    role: z.string(),
  })
  .passthrough();
export type SpaceMember = z.infer<typeof MemberSchema>;

const PageSchema = z.object({ members: z.array(MemberSchema), next_cursor: z.string().nullable() }).passthrough();
export type SpaceMembersPage = z.infer<typeof PageSchema>;

export const SPACE_MEMBERS_PAGE = 50;

export function listSpaceMembers(cohortId: string, cursor?: string | null): Promise<SpaceMembersPage> {
  return call(
    PageSchema,
    () => api.get<unknown>(`/community/cohorts/${cohortId}/members`, {
      params: { limit: SPACE_MEMBERS_PAGE, ...(cursor ? { cursor } : {}) },
    }),
    'space_members',
  );
}

export const spaceMembersKey = (cohortId: string) => ['community', 'space-members', cohortId] as const;

/** The space's people, a page at a time; asks only while `enabled` (the sheet is open and the server let the viewer in). */
export function useSpaceMembers(cohortId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: spaceMembersKey(cohortId),
    queryFn: ({ pageParam }) => listSpaceMembers(cohortId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: SpaceMembersPage) => last.next_cursor,
    enabled,
    staleTime: 0,
    retry: false,
    meta: { persist: false },
  });
}
