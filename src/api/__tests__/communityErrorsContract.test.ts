/**
 * C-314-4: every machine code communityErrors maps must be one the backend
 * actually emits. A mapped code the server never sends is dead copy hiding a
 * contract drift (the old `community.dm.blocked`: a blocked member's DM now
 * gets the same `community.dm.not_found` as a member who left, so the block
 * is not disclosed).
 *
 * BACKEND_COMMUNITY_CODES is every `code: 'community.*'` literal in
 * growth-project-backend src/community at PR #610 head (collected with
 * `rg -o "code: 'community\.[a-z_.]+'" src/community`). Update it together
 * with the backend when a code is added or retired.
 */
import {
  describeCommunityFailure,
  MAPPED_COMMUNITY_CODES,
} from '../communityErrors';

jest.mock('../../services/sentry', () => ({ captureError: jest.fn() }));

const BACKEND_COMMUNITY_CODES = new Set([
  'community.ack.disabled',
  'community.ack.illegal_transition',
  'community.ack.message_not_found',
  'community.ai_triage.disabled',
  'community.ai_triage.not_coach',
  'community.block.not_found',
  'community.block.self',
  'community.block.workspace_coach',
  'community.challenge.invalid_window',
  'community.challenge.not_coach',
  'community.challenge.not_found',
  'community.challenge.not_joined',
  'community.classroom.media_too_large',
  'community.classroom.no_media',
  'community.classroom.not_coach',
  'community.classroom.not_found',
  'community.classroom.storage_not_configured',
  'community.cohort.cannot_remove_owner_coach',
  'community.cohort.invalid_assign_target',
  'community.cohort.invalid_date_range',
  'community.cohort.name_taken',
  'community.cohort.no_access',
  'community.cohort.not_coach',
  'community.cohort.not_found',
  'community.cohort.user_not_found',
  'community.content.rejected',
  'community.dm.blocked_by_you',
  'community.dm.disabled',
  'community.dm.not_found',
  'community.event.canceled',
  'community.event.coach_only',
  'community.event.cohort_not_in_workspace',
  'community.event.ends_before_start',
  'community.event.illegal_transition',
  'community.event.invalid_link',
  'community.event.invalid_rsvp_status',
  'community.event.invalid_state',
  'community.event.invalid_state_filter',
  'community.event.not_found',
  'community.event.replay_requires_link',
  'community.event.rsvp_closed',
  'community.event.rsvp_not_eligible',
  'community.inbox.not_coach',
  'community.message.edit_window_closed',
  'community.message.not_author',
  'community.message.not_found',
  'community.moderation.cannot_ban_coach',
  'community.moderation.not_found',
  'community.moderation.not_moderator',
  'community.notice.not_found',
  'community.plan_context.foreign_owner',
  'community.plan_context.invalid_reference',
  'community.plan_context.malformed',
  'community.plan_context.not_found',
  'community.post.client_posts_disabled',
  'community.post.not_author',
  'community.post.not_found',
  'community.reaction.target_not_found',
  'community.search.not_found',
  'community.voice.already_posted',
  'community.voice.ambiguous_target',
  'community.voice.dm_not_supported',
  'community.voice.duration_out_of_range',
  'community.voice.mime_rejected',
  'community.voice.not_author',
  'community.voice.not_entitled',
  'community.voice.not_found',
  'community.voice.size_duration_mismatch',
  'community.voice.size_out_of_range',
  'community.voice.storage_key_rejected',
  'community.voice.storage_unavailable',
  'community.voice.upload_mismatch',
  'community.voice.upload_missing',
  'community.wearable_prompts.forbidden',
  'community.wearable_prompts.not_found',
  'community.win.not_found',
  'community.win.removed_member',
  'community.workspace.no_access',
  'community.workspace.not_found',
]);

function axiosError(status: number, data: Record<string, unknown>) {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data, headers: {} },
    config: { headers: {} },
  });
}

describe('communityErrors maps only codes the backend emits (C-314-4)', () => {
  it('every mapped code is emitted by the backend', () => {
    const stale = MAPPED_COMMUNITY_CODES.filter((c) => !BACKEND_COMMUNITY_CODES.has(c));
    expect(stale).toEqual([]);
  });

  it('no longer maps the retired community.dm.blocked', () => {
    expect(MAPPED_COMMUNITY_CODES).not.toContain('community.dm.blocked');
  });

  it('a blocked DM gets the server wording for community.dm.not_found (no block disclosed)', () => {
    const message =
      'This conversation is not available. The member may have left the community. Refresh and try again.';
    const f = describeCommunityFailure(
      axiosError(404, { code: 'community.dm.not_found', message }),
      'send_message',
    );
    expect(f.message).toBe(message);
    expect(f.reference).toBeNull();
  });

  it.each([
    'community.voice.upload_missing',
    'community.voice.upload_mismatch',
    'community.voice.already_posted',
    'community.voice.storage_unavailable',
  ])('%s: the voice upload checks show specific copy, not a support reference', (code) => {
    const f = describeCommunityFailure(axiosError(400, { code }), 'send_voice');
    expect(f.reference).toBeNull();
    expect(f.message.length).toBeGreaterThan(20);
    expect(f.message).not.toMatch(/something went wrong/i);
  });
});
