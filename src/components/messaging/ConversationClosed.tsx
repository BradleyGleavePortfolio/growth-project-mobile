/**
 * BLOCK-ALL-M: one rule for "this conversation is closed to me" (owner 10-22: "if someone is a banned person from a space
 * or direct5ly person to person banned, hide ALL messaging entirely, dont even let the banned person type!"; #168-4 op 1).
 *
 * Closed when the phone knows it: I blocked the other person (my own block list), or the server refused a read or a send
 * with one of its existing "not for you" answers. Every chat composer (coaching 1:1, community DM, Hall posts, replies,
 * challenge notes) swaps for ConversationClosedLine in the same spot. A refused send never clears the draft: the
 * composers keep it on the device. The line never says who blocked whom.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { spacing, typography } from '../../theme/tokens';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { HapticService } from '../../ui/haptics/haptics.service';

/** K2-S-104 (planning/MOCKUP3/K2), needs owner (137-2). */
export const CLOSED_LINE = 'This conversation is closed';

/** Backend main answers that mean "closed to you" (messaging-errors.ts, community-safety, community.service, posts). */
const CLOSED_CODES = new Set([
  'messaging.blocked', // edit / pin / react with a block on either side
  'community.dm.blocked_by_you', // a DM to someone I blocked
  'community.dm.not_found', // a DM with someone who blocked me (the block is never disclosed)
  'community.workspace.no_access', // banned, or no longer a member
  'community.cohort.no_access',
  'community.post.not_found', // the Hall or a post the viewer can no longer open (a ban reads as not found)
  'community.challenge.not_found', // a challenge's notes after a ban or a block
]);
/** The coaching send refusal carries no code, only this text (backend messaging.service sendAsCoach / sendAsClient). */
const COACHING_BLOCKED = 'Messages cannot be sent to blocked users';

type ErrLike = {
  status?: number;
  code?: unknown;
  userMessage?: unknown;
  cause?: unknown;
  response?: { status?: number; data?: { code?: unknown; error?: unknown; message?: unknown } };
};

/** True when a failed request means this conversation is closed to the viewer (axios errors, MessagingApiError, and
 * CommunityApiError, which keeps the axios error as `cause`). */
export function isClosedRefusal(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as ErrLike;
  if (depth < 2 && e.cause && isClosedRefusal(e.cause, depth + 1)) return true;
  const data = e.response?.data;
  const code = typeof data?.code === 'string' ? data.code : e.code;
  if (typeof code === 'string' && CLOSED_CODES.has(code)) return true;
  const status = e.response?.status ?? e.status;
  return status === 403 && (data?.error === 'BLOCKED' || data?.message === COACHING_BLOCKED || e.userMessage === COACHING_BLOCKED);
}

/**
 * `closed` for one conversation. `otherUserId`: the person on the other side (1:1 and DMs), checked against my block list
 * so an unblock reopens it. `errors`: read or send errors the screen already holds (react-query). `close(err)`: call it
 * with a failed send; it returns true (and switches to closed) when the refusal means closed.
 */
export function useConversationClosed(otherUserId?: string | null, errors: unknown[] = []) {
  const blockedByMe = useBlockedUsersStore((s) => !!otherUserId && s.blocked.some((b) => b.id === otherUserId));
  const [refused, setRefused] = useState(false);
  const wasBlocked = useRef(blockedByMe);
  useEffect(() => {
    if (wasBlocked.current && !blockedByMe) setRefused(false); // unblocked: open again
    wasBlocked.current = blockedByMe;
  }, [blockedByMe]);
  const close = useCallback((err: unknown) => {
    if (!isClosedRefusal(err)) return false;
    setRefused(true);
    void HapticService.warning();
    return true;
  }, []);
  return { closed: blockedByMe || refused || errors.some((e) => isClosedRefusal(e)), close };
}

/** The closed state, drawn where the composer was (same bar: surface, hairline top, composer padding). */
export function ConversationClosedLine({ testID = 'conversation-closed', style }: { testID?: string; style?: StyleProp<ViewStyle> }): React.ReactElement {
  const { semanticColors } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={CLOSED_LINE}
      accessibilityLiveRegion="polite"
      style={[styles.bar, { backgroundColor: semanticColors.bgSurface, borderTopColor: semanticColors.border }, style]}
    >
      <Ionicons name="lock-closed-outline" size={16} color={semanticColors.textMuted} />
      <Text style={[typography.bodySmall, { color: semanticColors.textMuted }]}>{CLOSED_LINE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44 + spacing.md * 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
