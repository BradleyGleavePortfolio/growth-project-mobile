/**
 * BLOCK-ALL-M: one rule for "this conversation is closed to me" (owner 10-22: "if someone is a banned person from a space
 * or direct5ly person to person banned, hide ALL messaging entirely, dont even let the banned person type!"; #168-4 op 1).
 *
 * Closed when the phone knows it: I blocked the other person (my own block list), or the server refused a read or a send
 * with one of its "not for you" answers. Every chat composer (coaching 1:1, community DM, Hall posts, replies, challenge
 * notes) swaps for ConversationClosedLine in the same spot. A refused send never clears the draft: the composers keep it
 * on the device.
 *
 * BLOCK-TELL, owner #169-5 CLOSED-LINE: in a one-to-one conversation the line says who closed it (BAM-2a / BAM-2b);
 * spaces, bans and a member who left keep BAM-1. A blocked chat is in neither person's list (owner 10-23 "Dissapear"), so
 * the side comes from my block list and the server's answer when the chat is reached another way (profile, notification,
 * link).
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ReactNavigation from '@react-navigation/native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, typography } from '../../theme/tokens';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { HapticService } from '../../ui/haptics/haptics.service';

/** BAM-1 = K2-S-104 (planning/MOCKUP3/K2): spaces, bans, a member who left, or no name to show. */
export const CLOSED_LINE = 'This conversation is closed';
/** BAM-2a, owner #169-5 (OWNER DECISION 6357189136 on m#872), approved: I blocked them. */
export const BLOCKED_BY_ME_LINE = 'You blocked them. Unblock in Settings';
const SETTINGS_WORD = 'Settings';
/** BAM-2b, same ruling: they blocked me. {N} is the name I already see for them in this conversation. */
export const blockedYouLine = (name: string): string => `${name} has blocked you`;

/** Who closed a one-to-one conversation: 'me' (BAM-2a), 'them' (BAM-2b), null (BAM-1). */
export type ClosedBy = 'me' | 'them' | null;
/** 'pair': a one-to-one block whose side the answer does not say (the coaching answers). */
type Refusal = ClosedBy | 'pair';

/** Backend answers that mean "closed to you" (messaging-errors.ts, community-safety, community.service, posts). */
const CLOSED_CODES = new Map<string, Refusal>([
  ['messaging.blocked', 'pair'], // edit / pin / react with a block on either side
  ['community.dm.blocked_by_you', 'me'], // a DM to someone I blocked
  ['community.dm.blocked_by_them', 'them'], // #169-5: a DM with someone who blocked me
  ['community.dm.not_found', null], // a member who left, is banned, or never joined
  ['community.workspace.no_access', null], // banned, or no longer a member
  ['community.cohort.no_access', null],
  ['community.post.not_found', null], // the Hall or a post the viewer can no longer open (a ban reads as not found)
  ['community.challenge.not_found', null], // a challenge's notes after a ban or a block
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

/** What a failed request says about this conversation (axios errors, MessagingApiError, and CommunityApiError, which
 * keeps the axios error as `cause`): undefined when it is not a "closed to you" answer. */
function refusalOf(err: unknown, depth = 0): Refusal | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as ErrLike;
  const inner = depth < 2 && e.cause ? refusalOf(e.cause, depth + 1) : undefined;
  if (inner !== undefined) return inner;
  const data = e.response?.data;
  const code = typeof data?.code === 'string' ? data.code : e.code;
  if (typeof code === 'string' && CLOSED_CODES.has(code)) return CLOSED_CODES.get(code);
  const status = e.response?.status ?? e.status;
  const coaching = data?.error === 'BLOCKED' || data?.message === COACHING_BLOCKED || e.userMessage === COACHING_BLOCKED;
  return status === 403 && coaching ? 'pair' : undefined;
}

/** True when a failed request means this conversation is closed to the viewer. */
export function isClosedRefusal(err: unknown): boolean {
  return refusalOf(err) !== undefined;
}

/**
 * `closed` and `by` for one conversation. `otherUserId`: the person on the other side (1:1 and DMs), checked against my
 * block list so an unblock reopens it. `errors`: read or send errors the screen already holds (react-query). `close(err)`:
 * call it with a failed send; it returns true (and closes) when the refusal means closed. `by`: 'me' when my block list
 * has them or the server says the block is mine; 'them' when the server says they blocked me, or a coaching refusal
 * (which names no side) meets no block of mine; null (BAM-1) for every other closed state.
 */
export function useConversationClosed(otherUserId?: string | null, errors: unknown[] = []) {
  const blockedByMe = useBlockedUsersStore((s) => !!otherUserId && s.blocked.some((b) => b.id === otherUserId));
  const [refused, setRefused] = useState<Refusal | undefined>(undefined);
  const wasBlocked = useRef(blockedByMe);
  useEffect(() => {
    if (wasBlocked.current && !blockedByMe) setRefused(undefined); // unblocked: open again
    wasBlocked.current = blockedByMe;
  }, [blockedByMe]);
  const close = useCallback((err: unknown) => {
    const r = refusalOf(err);
    if (r === undefined) return false;
    setRefused(r);
    void HapticService.warning();
    return true;
  }, []);
  const said = [refused, ...errors.map((e) => refusalOf(e))].filter((r) => r !== undefined);
  const mine = blockedByMe || said.includes('me');
  const by: ClosedBy = mine ? 'me' : said.includes('them') || said.includes('pair') ? 'them' : null;
  return { closed: mine || said.length > 0, by, close };
}

// A stand-in @react-navigation/native (tests) may leave the context out: then there is no list to open.
const NAV_CONTEXT =
  (ReactNavigation as unknown as { NavigationContext?: React.Context<unknown> }).NavigationContext ?? React.createContext<unknown>(undefined);

type NavLike = {
  getParent?: () => NavLike | undefined;
  getState?: () => { routeNames?: string[] } | undefined;
  navigate: (name: string, params?: object) => void;
};

/** "Settings" in BAM-2a opens the blocked-people list (client: the You stack; coach: the Settings stack), when this
 * navigator tree has one; otherwise the line is plain text (no dead link). */
function useOpenBlockedList(): (() => void) | null {
  const navigation = useContext(NAV_CONTEXT) as NavLike | undefined;
  return useMemo(() => {
    for (let nav = navigation; nav; nav = nav.getParent?.()) {
      const at = nav;
      const names = at.getState?.()?.routeNames ?? [];
      if (names.includes('BlockedUsers')) return () => at.navigate('BlockedUsers');
      const tab = names.find((n) => n === 'MoreTab' || n === 'SettingsStack');
      if (tab) return () => at.navigate(tab, { screen: 'BlockedUsers', initial: false });
    }
    return null;
  }, [navigation]);
}

/** The closed state, drawn where the composer was (same bar: surface, hairline top, composer padding). `by` and `name`
 * pick the one-to-one line (#169-5); without them it is BAM-1. */
export function ConversationClosedLine({
  by = null,
  name,
  testID = 'conversation-closed',
  style,
}: {
  by?: ClosedBy;
  name?: string | null;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  const openBlocked = useOpenBlockedList();
  const who = name?.trim();
  const line = by === 'me' ? BLOCKED_BY_ME_LINE : by === 'them' && who ? blockedYouLine(who) : CLOSED_LINE;
  const link = by === 'me' ? openBlocked : null;
  const bar = [styles.bar, { backgroundColor: semanticColors.bgSurface, borderTopColor: semanticColors.border }, style];
  const muted = [typography.bodySmall, { color: semanticColors.textMuted }];
  const icon = <Ionicons name="lock-closed-outline" size={16} color={semanticColors.textMuted} />;
  if (link) {
    return (
      <HapticPressable testID={testID} accessibilityRole="link" accessibilityLabel={line} onPress={link} style={bar}>
        {icon}
        <Text style={muted}>
          {line.slice(0, -SETTINGS_WORD.length)}
          <Text style={[styles.link, { color: semanticColors.textPrimary }]}>{SETTINGS_WORD}</Text>
        </Text>
      </HapticPressable>
    );
  }
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={line} accessibilityLiveRegion="polite" style={bar}>
      {icon}
      <Text style={muted}>{line}</Text>
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
  link: { textDecorationLine: 'underline', fontWeight: '600' },
});
