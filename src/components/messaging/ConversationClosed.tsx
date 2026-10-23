/**
 * BLOCK-ALL-M: one rule for "this conversation is closed to me" (owner 10-22: "if someone is a banned person from a space
 * or direct5ly person to person banned, hide ALL messaging entirely, dont even let the banned person type!"; #168-4 op 1).
 *
 * FX-872: closed until the server says open. Every composer, record button, reply, react and "start a conversation"
 * entry draws only when `open` is true: the screen's own reads came back (`ready`) and nothing says closed. While the
 * reads are out nothing editable draws, so there is no moment where a blocked or banned person can type.
 *
 * Closed when: I blocked the other person (the one block cache, src/lib/blockSync.ts), the server refused a read or a
 * send with one of its "not for you" answers (closedRefusal.ts), or the coaching inbox row says `closed` (b#1141
 * contract A, the only signal the person blocked gets). A refused send never clears the draft and is remembered for the
 * session, so leaving and coming back keeps it closed.
 *
 * BLOCK-TELL, owner #169-5 CLOSED-LINE: in a one-to-one conversation the line says who closed it (BAM-2a / BAM-2b,
 * `useClosedBy` + ConversationClosedLine's `by` and `name`); spaces, bans and a member who left keep BAM-1. A blocked
 * chat is in neither person's list (owner 10-23 "Dissapear"), so the side comes from my block list, the coaching row
 * and the server's refusal when the chat is reached another way (profile, notification, link).
 */
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ReactNavigation from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { spacing, typography } from '../../theme/tokens';
import { useBlockedUsersStore } from '../../store/blockedUsersStore';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useFeatureFlags } from '../../hooks/useFeatureFlags';
import { messagingV2Api, type InboxThread } from '../../api/messagingV2Api';
import { queryClient } from '../../services/queryClient';
import { closedRefusals, isClosedRefusal } from './closedRefusal';

export { isClosedRefusal } from './closedRefusal';

/** K2-S-104 (planning/MOCKUP3/K2), needs owner (137-2). BAM-1: spaces, bans, a member who left, or no name to show. */
export const CLOSED_LINE = 'This conversation is closed';
/** BAM-2a, owner #169-5 (OWNER DECISION 6357189136 on m#872), approved: I blocked them. */
export const BLOCKED_BY_ME_LINE = 'You blocked them. Unblock in Settings';
const SETTINGS_WORD = 'Settings';
/** BAM-2b, same ruling: they blocked me. {N} is the name I already see for them in this conversation. */
export const blockedYouLine = (name: string): string => `${name} has blocked you`;

/** Who closed a one-to-one conversation: 'me' (BAM-2a), 'them' (BAM-2b), null (BAM-1). */
export type ClosedBy = 'me' | 'them' | null;

/** The side a refusal names (#169-5, b#1145): only the community DM codes say it. */
function refusalSide(err: unknown, depth = 0): ClosedBy | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { code?: unknown; cause?: unknown; response?: { data?: { code?: unknown } } };
  const inner = depth < 2 && e.cause ? refusalSide(e.cause, depth + 1) : undefined;
  if (inner !== undefined) return inner;
  const code = typeof e.response?.data?.code === 'string' ? e.response.data.code : e.code;
  if (code === 'community.dm.blocked_by_you') return 'me';
  if (code === 'community.dm.blocked_by_them') return 'them';
  return undefined;
}

/**
 * Which line a closed one-to-one conversation shows (#169-5). 'me' when my block list has them, the coaching row says
 * the block is mine (`mine`), or the server says blocked_by_you; 'them' when the server says blocked_by_them, or in a
 * coaching chat (`pair`: every closed state there is a block on one side) when the block is not mine; null (BAM-1) for
 * bans, a member who left, and everything else. Null while open.
 */
export function useClosedBy(
  otherUserId: string | null | undefined,
  closed: boolean,
  { errors = [], pair = false, mine = false }: { errors?: unknown[]; pair?: boolean; mine?: boolean } = {},
): ClosedBy {
  const blockedByMe = useBlockedUsersStore((s) => !!otherUserId && s.blocked.some((b) => b.id === otherUserId));
  if (!closed) return null;
  const said = errors.map((e) => refusalSide(e));
  if (blockedByMe || mine || said.includes('me')) return 'me';
  return said.includes('them') || pair ? 'them' : null;
}

/**
 * One conversation's gate. `otherUserId`: the person on the other side (1:1 and DMs), checked against my block list so
 * an unblock reopens it. `errors`: read or send errors the screen already holds (react-query). `ready`: the screen's
 * own reads came back, so the server has answered (there is no default: a screen that forgets it never opens).
 * `serverClosed`: the server's own row says closed. `close(err)`: call it with a failed send; it returns true (and
 * switches to closed) when the refusal means closed.
 */
export function useConversationClosed(
  otherUserId: string | null | undefined,
  errors: unknown[],
  ready: boolean,
  serverClosed?: boolean,
) {
  const blockedByMe = useBlockedUsersStore((s) => !!otherUserId && s.blocked.some((b) => b.id === otherUserId));
  const remembered = useSyncExternalStore(closedRefusals.subscribe, () => closedRefusals.has(otherUserId));
  const [refused, setRefused] = useState(false);
  const wasBlocked = useRef(blockedByMe);
  useEffect(() => {
    if (wasBlocked.current && !blockedByMe) {
      setRefused(false); // unblocked: open again
      closedRefusals.clear(otherUserId);
    }
    wasBlocked.current = blockedByMe;
  }, [blockedByMe, otherUserId]);
  useEffect(() => {
    if (serverClosed === false) closedRefusals.clear(otherUserId); // the server's row says open again
  }, [serverClosed, otherUserId]);
  const close = useCallback(
    (err: unknown) => {
      if (!isClosedRefusal(err)) return false;
      setRefused(true);
      closedRefusals.add(otherUserId);
      void HapticService.warning();
      AccessibilityInfo.announceForAccessibility?.(CLOSED_LINE); // the composer that had focus just went away
      return true;
    },
    [otherUserId],
  );
  const closed =
    blockedByMe || refused || remembered || serverClosed === true || errors.some((e) => isClosedRefusal(e));
  return { closed, open: ready && !closed, close };
}

type ReadLike = { isSuccess: boolean; isStale: boolean; isFetchedAfterMount: boolean };

/**
 * `ready` for screens built on react-query reads: true once every read succeeded on this visit (or holds data fetched
 * moments ago, still fresh), then latched for the visit so a background poll never pulls the box away. Data restored
 * from the cache at a cold start does not count: that is the moment a since-banned person would see a box.
 */
export function useServerAnswered(...reads: ReadLike[]): boolean {
  const now = reads.every((r) => r.isSuccess && (r.isFetchedAfterMount || !r.isStale));
  const [latched, setLatched] = useState(now);
  useEffect(() => {
    if (now) setLatched(true);
  }, [now]);
  return latched || now;
}

export const coachingRowKey = (side: 'client' | 'coach', otherUserId: string) =>
  ['messaging', 'v2', 'coaching-row', side, otherUserId] as const;

const COACH_INBOX_PAGES = 5; // 5 x 100 rows; a coach with more busy chats than that falls back to the send refusal

/**
 * The coaching chat's own inbox row (b#1141 contract A carries `closed` on it). `row`: undefined while unknown,
 * null when the inbox has no row for this pair, else the row. `settled`: the read came back (or failed, or messaging v2
 * is off, where the inbox does not exist and the thread read is the only answer).
 */
export function useCoachingRow(side: 'client' | 'coach', otherUserId: string | null | undefined) {
  const { flags } = useFeatureFlags();
  const enabled = !!flags.messaging_core_v2 && (side === 'client' || !!otherUserId);
  const q = useQuery({
    queryKey: coachingRowKey(side, side === 'client' ? 'mine' : (otherUserId ?? '')),
    enabled,
    staleTime: 0,
    retry: false, // a failed inbox read settles at once; the send refusal still closes it
    meta: { persist: false }, // never an "open" row saved to the phone on an earlier visit
    queryFn: async (): Promise<InboxThread | null> => {
      if (side === 'client') {
        const res = await messagingV2Api.getClientInbox();
        return res.items[0] ?? null; // the client inbox is one row: their coach's thread (empty when coachless)
      }
      let cursor: string | null = null;
      for (let page = 0; page < COACH_INBOX_PAGES; page++) {
        const res = await messagingV2Api.getCoachInbox({ cursor, limit: 100 });
        const row = res.items.find((t) => t.client_id === otherUserId);
        if (row) return row;
        if (!res.next_cursor) return null;
        cursor = res.next_cursor;
      }
      return null;
    },
  }, queryClient); // the app's one client (also outside a provider), so the block cache can drop and refetch this row
  // Settled only by a read made on this visit (a row still in memory from an earlier screen does not count).
  return { row: q.data, settled: !enabled || ((q.isSuccess || q.isError) && q.isFetchedAfterMount) };
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
  testID = 'conversation-closed',
  style,
  line: given,
  by = null,
  name,
}: {
  testID?: string;
  style?: StyleProp<ViewStyle>;
  /** The words, by prop, so the role lines (#169-5) can pass theirs. */
  line?: string;
  by?: ClosedBy;
  name?: string | null;
}): React.ReactElement {
  const { semanticColors } = useTheme();
  const openBlocked = useOpenBlockedList();
  const who = name?.trim();
  const line = given ?? (by === 'me' ? BLOCKED_BY_ME_LINE : by === 'them' && who ? blockedYouLine(who) : CLOSED_LINE);
  const link = !given && by === 'me' ? openBlocked : null;
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
