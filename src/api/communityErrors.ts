/**
 * communityErrors — specific, actionable failure copy for community safety and
 * write surfaces (owner rule 2026-10-01 13:34: no generic or vague errors).
 *
 * Every failure says what happened and offers a working next step:
 *   - known backend machine codes map to specific copy (block, DM, post,
 *     moderation, content filter, voice, notices); the backend's own human
 *     `message` wins for the codes whose message is written for members
 *     (content filter, block, DM, voice upload checks). A blocked member's DM
 *     attempt gets the same `community.dm.not_found` as a member who left, so
 *     the block is never disclosed (there is no `community.dm.blocked`);
 *   - known HTTP statuses (401, 403, 404, 409, 410, 429, offline) map to
 *     specific copy;
 *   - anything else shows a short reference (the server's X-Request-ID, or the
 *     outbound one when the server never answered) plus the support email, and
 *     is reported to Sentry with the full reference.
 *
 * Copy rules: plain warm words, no exclamation marks, no emojis.
 */
import { captureError } from '../services/sentry';
import { extractRequestId, REQUEST_ID_HEADER } from '../utils/correlation';
import { randomUuid } from '../utils/idempotency';
import { SUPPORT_EMAIL } from '../constants/support';

/**
 * Published support path when /community/safety has not loaded: the app's one
 * support constant (OR-109-1; src/constants/support.ts).
 */
export const COMMUNITY_SUPPORT_EMAIL = SUPPORT_EMAIL;

export type CommunityAction =
  | 'report'
  | 'block'
  | 'unblock'
  | 'load_blocks'
  | 'load_notices'
  | 'send_reply'
  | 'send_message'
  | 'send_post'
  | 'moderate'
  | 'load_queue'
  | 'load_challenge'
  | 'challenge_action'
  | 'load_posts'
  | 'load_space'
  | 'delete'
  | 'send_win'
  | 'load_wins'
  | 'load_voice'
  | 'send_voice';

export interface CommunityFailure {
  /** Short alert title naming what did not happen. */
  title: string;
  /** What happened and what to do next. */
  message: string;
  /** Short support reference, only for unexpected failures. */
  reference: string | null;
  /** Machine code from the server, when it sent one. */
  code: string | null;
  /** HTTP status (0 when the request never got an answer). */
  status: number | null;
}

const TITLES: Record<CommunityAction, string> = {
  report: 'Report not sent',
  block: 'Not blocked',
  unblock: 'Not unblocked',
  load_blocks: 'Block list not loaded',
  load_notices: 'Notices not loaded',
  send_reply: 'Reply not sent',
  send_message: 'Message not sent',
  send_post: 'Post not shared',
  moderate: 'Action not applied',
  load_queue: 'Review queue not loaded',
  load_challenge: 'Challenge not loaded',
  challenge_action: 'Not saved',
  load_posts: 'Posts not loaded',
  load_space: 'Space not loaded',
  delete: 'Not deleted',
  send_win: 'Win not shared',
  load_wins: 'Wins not loaded',
  load_voice: 'Voice note not loaded',
  send_voice: 'Voice note not sent',
};

const VERBS: Record<CommunityAction, string> = {
  report: 'send your report',
  block: 'block this member',
  unblock: 'unblock this member',
  load_blocks: 'load your block list',
  load_notices: 'load your notices',
  send_reply: 'send your reply',
  send_message: 'send your message',
  send_post: 'share your post',
  moderate: 'apply that action',
  load_queue: 'load the review queue',
  load_challenge: 'load this challenge',
  challenge_action: 'save that',
  load_posts: 'load these posts',
  load_space: 'load this space',
  delete: 'delete this',
  send_win: 'share your win',
  load_wins: 'load community wins',
  load_voice: 'load this voice note',
  send_voice: 'send your voice note',
};

/** Codes whose server `message` is written for members; shown verbatim. */
const SERVER_WORDED = new Set([
  'community.content.rejected',
  'community.block.self',
  'community.block.not_found',
  'community.block.workspace_coach',
  'community.dm.blocked_by_you',
  'community.dm.not_found',
  'community.win.removed_member',
  'community.voice.dm_not_supported',
  'community.voice.not_author',
  'community.voice.duration_out_of_range',
  'community.voice.not_entitled',
  'community.voice.upload_missing',
  'community.voice.upload_mismatch',
  'community.voice.already_posted',
  'community.voice.storage_unavailable',
  'community.notice.not_found',
]);

/** Local copy for known machine codes (used when the server sent no message). */
const BY_CODE: Record<string, string> = {
  'community.content.rejected':
    'This was not posted because it appears to contain abusive or explicit language. Your draft is kept so you can rephrase it.',
  'community.block.self': 'You cannot block yourself.',
  'community.block.not_found':
    'This member could not be found in your community. They may have left. Go back and refresh.',
  'community.block.workspace_coach':
    'You cannot block your coach. You can report a message or post, or email the safety contact in Community safety.',
  'community.dm.blocked_by_you':
    'You blocked this member. To message them again, unblock them in Community safety.',
  'community.dm.disabled':
    'Direct messages are turned off in this community. You can still post in the Hall or your cohort, or message your coach.',
  'community.dm.not_found':
    'This conversation is no longer available. Go back to Messages and refresh.',
  'community.post.not_found':
    'This post is no longer available. It may have been removed. Go back and refresh.',
  'community.message.not_found':
    'This message is no longer available. It may have been removed. Go back and refresh.',
  'community.post.client_posts_disabled':
    'Your coach has turned off member posts in the Hall. You can reply to posts, or post in your cohort.',
  'community.workspace.no_access':
    'You are no longer a member of this community. Contact your coach if you think this is a mistake.',
  'community.cohort.not_found':
    'This cohort is no longer available. Go back and refresh, or contact your coach.',
  'community.challenge.not_joined': 'Join the challenge first, then you can comment.',
  'community.moderation.not_found':
    'This report has already been handled or removed. Pull down to refresh the queue.',
  'community.moderation.not_moderator':
    'Only the coach who owns this community can act on its reports.',
  'community.moderation.cannot_ban_coach':
    'A coach cannot be removed from their own community. Hide the content instead.',
  'community.win.not_found':
    'This win is no longer available. It may have been removed. Pull down to refresh.',
  'community.win.removed_member':
    'You cannot share wins in this community because your access was removed. If you think this is a mistake, email the safety contact in Community safety.',
  'community.voice.not_found':
    'This voice note is no longer available. It may have been deleted or removed. Go back and refresh.',
  'community.voice.dm_not_supported':
    'Voice notes can be shared in your community spaces, not in direct messages. Send a text message instead, or share the voice note in a space.',
  'community.voice.not_author':
    'Only the person who recorded this voice note, or your coach, can delete it. You can report it instead.',
  'community.voice.mime_rejected':
    'This recording format is not supported. Record the voice note again in the app, then send it.',
  'community.voice.duration_out_of_range':
    'This voice note is too long. Record a shorter one, then send it.',
  'community.voice.size_out_of_range':
    'This recording is too large to send. Record a shorter voice note, then send it.',
  'community.voice.size_duration_mismatch':
    'This recording could not be checked. Record the voice note again in the app, then send it.',
  'community.voice.storage_key_rejected':
    'This recording could not be attached. Record the voice note again in the app, then send it.',
  'community.voice.ambiguous_target':
    'A voice note can go to one space at a time. Choose one space, then send it again.',
  'community.voice.not_entitled':
    'Voice notes are not included in your current plan. You can post a text message instead, or ask your coach about your plan.',
  'community.voice.upload_missing':
    'We could not find the uploaded recording. Check your connection, record the voice note again, then send it.',
  'community.voice.upload_mismatch':
    'The uploaded recording does not match what was recorded. Record the voice note again in the app, then send it.',
  'community.voice.already_posted':
    'This recording was already posted. Refresh to see it, or record a new voice note.',
  'community.voice.storage_unavailable':
    'Voice notes cannot be checked right now. Your recording was not posted. Try sending it again in a minute.',
  'community.notice.not_found':
    'This notice could not be found. Refresh Community safety to see your notices.',
};

/**
 * Every machine code this module maps, for the contract test against the
 * codes the backend emits (C-314-4: a mapped code the server never sends is
 * dead copy that hides a contract drift).
 */
export const MAPPED_COMMUNITY_CODES: ReadonlyArray<string> = Array.from(
  new Set([...SERVER_WORDED, ...Object.keys(BY_CODE)]),
);

interface ErrorBody {
  code?: unknown;
  message?: unknown;
}

interface ResponseLike {
  status?: number;
  data?: unknown;
  headers?: unknown;
}

/** Walk an error and its `.cause` chain to the first axios-like error. */
function axiosLike(
  err: unknown,
): { response?: ResponseLike; config?: { headers?: unknown } } | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i += 1) {
    const e = cur as {
      response?: ResponseLike;
      config?: { headers?: unknown };
      isAxiosError?: unknown;
      cause?: unknown;
    };
    if (e.response || e.isAxiosError === true || e.config) return e;
    cur = e.cause;
  }
  return null;
}

function outboundRequestId(config: { headers?: unknown } | undefined): string | null {
  const headers = config?.headers;
  if (!headers || typeof headers !== 'object') return null;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (
      key.toLowerCase() === REQUEST_ID_HEADER.toLowerCase() &&
      typeof value === 'string' &&
      value
    ) {
      return value;
    }
  }
  return null;
}

/** First 8 characters, uppercased: easy to read out, enough to search logs. */
export function shortReference(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/**
 * Describe a failed community request for the member. Unexpected failures are
 * reported to Sentry (with the full reference) and carry a short reference in
 * the copy. Never throws.
 */
export function describeCommunityFailure(
  err: unknown,
  action: CommunityAction,
  supportEmail: string = COMMUNITY_SUPPORT_EMAIL,
): CommunityFailure {
  const title = TITLES[action];
  const ax = axiosLike(err);
  const res = ax?.response;
  const status = res ? (typeof res.status === 'number' ? res.status : null) : ax ? 0 : null;
  const body: ErrorBody | null =
    res?.data && typeof res.data === 'object' ? (res.data as ErrorBody) : null;
  const code = typeof body?.code === 'string' ? body.code : null;
  const serverMessage =
    typeof body?.message === 'string' && body.message.trim() ? body.message : null;

  const known = (message: string): CommunityFailure => ({
    title: code === 'community.content.rejected' ? 'Please rephrase' : title,
    message,
    reference: null,
    code,
    status,
  });

  if (code && SERVER_WORDED.has(code)) return known(serverMessage ?? BY_CODE[code]);
  if (code && BY_CODE[code]) return known(BY_CODE[code]);

  switch (status) {
    case 0:
      return known('You appear to be offline. Check your connection, then try again.');
    case 401:
      return known('You have been signed out. Sign in again, then try once more.');
    case 403:
      return known(
        'You do not have access to this anymore. Contact your coach if you think this is a mistake.',
      );
    case 404:
    case 410:
      return known(
        'This is no longer available. It may have been removed or hidden. Go back and refresh.',
      );
    case 409:
      return known('This changed while you were looking at it. Refresh, then try again.');
    case 429:
      return known('You are doing that a little too often. Wait a minute, then try again.');
    default:
      break;
  }

  const fullRef =
    (res ? extractRequestId({ response: res }) : null) ??
    outboundRequestId(ax?.config) ??
    randomUuid();
  const reference = shortReference(fullRef);
  captureError(err, {
    area: 'community',
    action,
    status,
    code,
    request_id: fullRef,
    reference,
  });
  return {
    title,
    message: `We could not ${VERBS[action]} because of a problem on our side. Try again in a few minutes. If it keeps happening, email ${supportEmail} and quote reference ${reference}.`,
    reference,
    code,
    status,
  };
}
