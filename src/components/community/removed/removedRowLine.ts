/**
 * removedRowLine (REMOVED-BY-M3): the one line a coach-removed Hall post or comment shows in its place, drawn by
 * the same quiet row as a removed voice note (VoiceRemovedPlaceholder). Backend #1176 CONTRACT 6450153770 section 6.
 *
 *   the coach who removed it   "You removed this post" / "You removed this comment"        (RB-W9, owner #178-3)
 *   its author                 "Your coach removed your post" / "...your comment" + Community safety (RB-W10)
 *   everyone else              "Removed by Coach {name}" (RB-W4, owner 10-26 "3.) b"; "Removed by Coach" if blank)
 */
import { isCoachRemoved, type RemovedMark } from '../../../api/communityRemovedRows';
import type { VoiceRemovedLine } from './VoiceRemovedPlaceholder';

const WORDS = {
  post: { remover: 'You removed this post', author: 'Your coach removed your post' },
  comment: { remover: 'You removed this comment', author: 'Your coach removed your comment' },
} as const;

/** The line for this viewer, or null when no coach removed the row (live rows, author deletes, older servers). */
export function removedRowLine(
  row: RemovedMark & { author_user_id: string },
  noun: keyof typeof WORDS,
  viewerUserId?: string | null,
): VoiceRemovedLine | null {
  if (!isCoachRemoved(row)) return null;
  if (viewerUserId && row.removed_by?.user_id === viewerUserId) return { who: 'remover', text: WORDS[noun].remover };
  if (viewerUserId && row.author_user_id === viewerUserId) return { who: 'author', text: WORDS[noun].author };
  const name = row.removed_by?.name.trim() ?? '';
  return { who: 'other', text: name ? `Removed by Coach ${name}` : 'Removed by Coach' };
}
