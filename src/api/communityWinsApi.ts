/**
 * communityWinsApi — member wins (More > Community "Share a win").
 *
 * Backend contract (growth-project-backend src/community/community.service.ts
 * + community-wins.policy.ts):
 *   GET    /community/feed      -> [{ id, user_id, display_name, title, description,
 *                                    created_at, is_mine, displayName, action, createdAt }]
 *   POST   /community/wins      { title, description } -> one win (same shape)
 *   DELETE /community/wins/:id  -> { id, deleted: true }   (author only)
 * Wins are shared with the coach's moderated circle only; the content filter
 * may answer 422 community.content.rejected (keep the draft); a member removed
 * from the community gets 403 community.win.removed_member. Report a win with
 * communitySafetyApi.report({ target_type: 'win', ... }).
 *
 * The feed is Zod-validated and normalised here, so an older backend build
 * (legacy keys only: displayName / action / createdAt) still renders a title
 * and a date instead of blank cards.
 */
import { z } from 'zod';
import api from '../services/api';
import { generateIdempotencyKey } from '../utils/idempotency';
import { call } from './apiCall';

const RawWinSchema = z
  .object({
    id: z.string(),
    user_id: z.string().nullish(),
    display_name: z.string().nullish(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    created_at: z.string().nullish(),
    is_mine: z.boolean().nullish(),
    // Legacy keys (older backend builds, persisted caches).
    displayName: z.string().nullish(),
    action: z.string().nullish(),
    createdAt: z.string().nullish(),
  })
  .passthrough();
type RawWin = z.infer<typeof RawWinSchema>;

/** One member win, as the screen renders it. */
export interface CommunityWin {
  id: string;
  /** Author id, or null when an old cached row did not carry it. */
  userId: string | null;
  /** First name only for other members (client privacy). */
  displayName: string;
  title: string;
  description: string;
  /** ISO timestamp, or null when unknown. */
  createdAt: string | null;
  isMine: boolean;
}

const FeedSchema = z.array(RawWinSchema);
const DeleteSchema = z.object({ id: z.string(), deleted: z.literal(true) }).passthrough();

function validIso(v: string | null | undefined): string | null {
  if (!v) return null;
  return Number.isNaN(Date.parse(v)) ? null : v;
}

/** Normalise one feed row (current or legacy shape). */
export function normalizeWin(raw: RawWin, viewerId?: string | null): CommunityWin {
  const userId = raw.user_id ?? null;
  const isMine = raw.is_mine ?? (!!viewerId && !!userId && userId === viewerId);
  return {
    id: raw.id,
    userId,
    displayName: (raw.display_name ?? raw.displayName ?? '').trim() || 'Teammate',
    title: (raw.title ?? raw.action ?? '').trim(),
    description: (raw.description ?? '').trim(),
    createdAt: validIso(raw.created_at ?? raw.createdAt),
    isMine,
  };
}

export const communityWinsApi = {
  async getFeed(viewerId?: string | null): Promise<CommunityWin[]> {
    const rows = await call(
      FeedSchema,
      () => api.get<unknown>('/community/feed'),
      'community wins',
    );
    return rows.map((r) => normalizeWin(r, viewerId));
  },

  async postWin(input: { title: string; description: string }): Promise<CommunityWin> {
    const row = await call(
      RawWinSchema,
      () =>
        api.post<unknown>('/community/wins', input, {
          headers: { 'Idempotency-Key': generateIdempotencyKey() },
        }),
      'community post win',
    );
    return normalizeWin(row);
  },

  async deleteWin(winId: string): Promise<void> {
    await call(
      DeleteSchema,
      () => api.delete<unknown>(`/community/wins/${winId}`),
      'community delete win',
    );
  },
};
