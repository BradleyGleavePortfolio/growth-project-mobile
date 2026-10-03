/**
 * Copy for "Your conversations with Roman" (list, read, delete one, delete
 * all). Owner rules: plain warm words, no exclamation marks, no emojis, and
 * every failure says what happened and what to do next. Every backend reason
 * (romanChatsApi RomanChatsFailure) has its own line per operation; only an
 * unknown failure shows a short reference and the support address.
 */
import type { RomanChatsFailure, RomanChatSummary } from '../../api/romanChatsApi';
import { SUPPORT_EMAIL } from '../../constants/support';
import { shortReference } from '../../utils/correlation';

export type RomanChatsOp = 'load' | 'load_more' | 'delete_one' | 'delete_all' | 'read';

const withRef = (ref: string | null) =>
  `write to support at ${SUPPORT_EMAIL}${ref ? ` and mention reference ${ref}` : ''}`;

export const ROMAN_CHATS_COPY = {
  title: 'Your conversations with Roman',
  entryLabel: 'Your conversations with Roman',
  entryHint: 'See, open and delete your past conversations with Roman',
  intro:
    'Your conversations with Roman are kept until you delete them or your account. Your coach never sees them. Deleting a conversation removes it for good.',
  empty: 'You have no conversations with Roman. Each day you talk with Roman, that conversation shows up here.',
  loading: 'Loading your conversations with Roman',
  loadingMore: 'Loading older conversations',
  loadMore: 'Show older conversations',
  retry: 'Try again',
  contactSupport: 'Contact support',
  back: 'Back',
  backToList: 'Back to your conversations',
  open: 'Opens this conversation',
  coachTools: 'From your coach tools',
  deleteOne: 'Delete',
  deleteAll: 'Delete all conversations',
  deleting: 'Deleting',
  deletedOne: 'Conversation deleted.',
  deletedAll: 'All your conversations with Roman are deleted.',
  alreadyGone: 'This conversation was already deleted, so there was nothing left to remove.',
  refreshed: 'This list of conversations was out of date, so it has been refreshed.',
  signedOutState: 'You are signed out, so your conversations with Roman are not shown. Sign in to see or delete them.',
  otherAccount:
    'You signed out or switched accounts after opening this conversation, so it is no longer shown. Go back to open it again.',

  confirmOneTitle: 'Delete this conversation?',
  /** `which` comes from chatIdentity: the start date and time, the message count and, for coach tools, where it was. */
  confirmOneBody: (which: string) =>
    `This permanently deletes your conversation with Roman from ${which}. It cannot be undone.`,
  confirmOneAction: 'Delete conversation',
  keep: 'Keep it',
  confirmAllTitle: 'Delete all your conversations with Roman?',
  confirmAllBody:
    'This permanently deletes every conversation you have had with Roman, from every day. It cannot be undone. Your plan, your logs and your messages with your coach stay as they are.',
  confirmAllTypeLabel: 'Type DELETE to confirm',
  confirmAllWord: 'DELETE',

  transcriptTitle: (when: string) => `Conversation from ${when}`,
  transcriptEmpty: 'This conversation has no messages.',
  transcriptLoading: 'Loading this conversation',
  readOnlyNote: 'Past conversations are read only.',
  earlier: 'Show earlier messages',
  loadingEarlier: 'Loading earlier messages',
} as const;

/** Count with the right noun. */
export function messageCountLabel(n: number): string {
  return n === 1 ? '1 message' : `${n} messages`;
}

/**
 * "Thursday, October 1 at 6:12 PM" (plus the year when it is not this year),
 * in the phone's local time. Opus/Sol B-331-1: the backend keeps one chat per
 * UTC day, so two chats can start on the same local date (every evening in
 * the Americas); the start time tells them apart on the row, the transcript
 * title and the permanent-delete confirm.
 */
export function chatDateLabel(chat: Pick<RomanChatSummary, 'startedAt'>, now: Date = new Date()): string {
  const d = new Date(chat.startedAt);
  if (Number.isNaN(d.getTime())) return 'an earlier day';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  const day = d.toLocaleDateString('en-US', opts);
  // Newer ICU puts a narrow no-break space before AM/PM; keep plain spaces.
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, ' ');
  return `${day} at ${time}`;
}

/**
 * Which conversation a permanent delete is about, in words: start date and
 * time, message count and, for coach tools chats, where it happened.
 * "Thursday, October 1 at 6:12 PM (4 messages, in your coach tools)".
 */
export function chatIdentity(
  chat: Pick<RomanChatSummary, 'startedAt' | 'messageCount' | 'surface'>,
  now: Date = new Date(),
): string {
  const details = [messageCountLabel(chat.messageCount)];
  if (chat.surface === 'coach') details.push('in your coach tools');
  return `${chatDateLabel(chat, now)} (${details.join(', ')})`;
}

/** What the screen shows for a failure, and which action it offers. */
export interface RomanChatsFailureView {
  message: string;
  /** retry: run the same request again. support: also offer Contact support. */
  action: 'retry' | 'retry_support' | 'back' | 'none';
  /** The short reference shown, also passed to the support email. */
  reference: string | null;
  /** Unknown failures only: report to Sentry (status, code, reference; no content). */
  report: boolean;
}

/**
 * The copy for every failure of every operation. Exhaustive over
 * RomanChatsFailure['reason'] (TypeScript checks the switch).
 */
export function failureView(op: RomanChatsOp, f: RomanChatsFailure): RomanChatsFailureView {
  switch (f.reason) {
    case 'offline':
      return {
        message:
          op === 'delete_one'
            ? 'The app could not reach the server, so this conversation may not be deleted yet. Check your connection, then delete it again. Deleting again is safe.'
            : op === 'delete_all'
              ? 'The app could not reach the server, so your conversations may not be deleted yet. Check your connection, then try again. Deleting again is safe.'
              : op === 'read'
                ? 'The app could not reach the server to open this conversation. Check your connection, then tap Try again.'
                : 'The app could not reach the server to load your conversations. Check your connection, then tap Try again.',
        action: 'retry',
        reference: null,
        report: false,
      };
    case 'signed_out':
      return {
        message: 'Your sign-in has ended, so nothing was changed. Sign in again, then come back to Settings > Privacy > Roman and AI.',
        action: 'none',
        reference: null,
        report: false,
      };
    case 'not_allowed': {
      const ref = shortReference(f.requestId);
      return {
        message: `This account cannot use Roman, so there are no conversations to show or delete. If that seems wrong, ${withRef(ref)}.`,
        action: 'retry_support',
        reference: ref,
        report: false,
      };
    }
    case 'not_found':
      return op === 'read'
        ? {
            message: 'This conversation no longer exists. It may have been deleted on another device.',
            action: 'back',
            reference: null,
            report: false,
          }
        : {
            message: ROMAN_CHATS_COPY.alreadyGone,
            action: 'none',
            reference: null,
            report: false,
          };
    case 'route_missing':
      return op === 'read'
        ? {
            message:
              'Reading past conversations is switched off on the server right now. You can still delete this conversation here.',
            action: 'none',
            reference: null,
            report: false,
          }
        : op === 'delete_one' || op === 'delete_all'
          ? {
              message: `Deleting conversations is not available on the server yet, so nothing was deleted. Check back later, or ${withRef(null)}.`,
              action: 'retry_support',
              reference: null,
              report: false,
            }
          : {
              message: `Your conversation history is not available on the server yet, so nothing can be shown here. Nothing was changed. Check back later, or ${withRef(null)}.`,
              action: 'retry_support',
              reference: null,
              report: false,
            };
    case 'cursor_invalid':
      return { message: ROMAN_CHATS_COPY.refreshed, action: 'none', reference: null, report: false };
    case 'erase_incomplete':
      return {
        message:
          op === 'delete_all'
            ? 'Roman could not finish deleting your conversations. The ones already deleted stay deleted. Try again in a moment to delete the rest.'
            : 'Roman could not finish deleting this conversation. Delete it again in a moment to make sure. Deleting it twice is safe.',
        action: 'retry',
        reference: null,
        report: false,
      };
    case 'query_invalid': {
      // Only an outdated or modified app sends a query the server refuses.
      const ref = shortReference(f.requestId);
      return {
        message: `This version of the app asked for your conversations in a way the server no longer accepts, so nothing was changed. Update the app, then try again. If it keeps happening, ${withRef(ref)}.`,
        action: 'retry_support',
        reference: ref,
        report: true,
      };
    }
    case 'account_changed':
      // Normally never read: the screen clears itself on the same auth change.
      return {
        message:
          op === 'delete_one' || op === 'delete_all'
            ? f.mayHaveBeenSent
              ? 'The account signed in on this phone changed while this was being deleted, so the result is not shown. Open Your conversations with Roman again to see what is there.'
              : 'The account signed in on this phone changed, so nothing was deleted. Open Your conversations with Roman again to see what is there.'
            : 'The account signed in on this phone changed, so this is no longer shown. Open Your conversations with Roman again to see what is there.',
        action: 'none',
        reference: null,
        report: false,
      };
    case 'busy':
      return {
        message: 'There were too many requests in a row, so this one was not done. Wait a minute, then try again.',
        action: 'retry',
        reference: null,
        report: false,
      };
    case 'unexpected': {
      const ref = shortReference(f.requestId);
      const what =
        op === 'delete_one'
          ? 'The server could not confirm that this conversation was deleted, so it has not been removed here. Try again. Deleting again is safe.'
          : op === 'delete_all'
            ? 'The server could not confirm that your conversations were deleted, so the list shows what is still there. Try again. Deleting again is safe.'
            : op === 'read'
              ? 'The server could not open this conversation. Tap Try again.'
              : 'The server could not load your conversations. Tap Try again.';
      return { message: `${what} If it keeps happening, ${withRef(ref)}.`, action: 'retry_support', reference: ref, report: true };
    }
  }
}

/** Subject of the Contact support email: the reference only, never chat content. */
export function supportSubject(reference: string | null): string {
  return `Roman conversations${reference ? ` (reference ${reference})` : ''}`;
}
