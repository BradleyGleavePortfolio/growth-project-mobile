/**
 * COACH-DM-M (owner 203-D3, Studio look #203-E25; PLAN on m#962): what the coach's community DM screens share.
 *
 * Names come only from the coach's roster (GET /coach/clients?status=all, every page, by the store's own paging rule)
 * held in the query cache under this coach's id, never in the shared coach store, which keeps active clients only
 * (coachStore.ts:27-30). A client with an empty name is shown as "Direct message" with no initials: never an email,
 * an id, "Coach" or a made-up name. The DM reads are the client's own hooks (useCommunity.ts).
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { coachApi } from '../../../services/api';
import { ROSTER_MAX_PAGES, ROSTER_PAGE_SIZE } from '../../../store/coachStore';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { useCommunityMe, useDmThreads } from '../../../hooks/useCommunity';
import HapticPressable from '../../../components/HapticPressable';
import { useTheme } from '../../../theme/useTheme';
import { forestPop as fp, radius, spacing } from '../../../theme/tokens';
import { calendarDateInZone, formatDayLabel } from '../../../calendar/calendarTime';
import { resolveClientTimezone } from '../../../api/schedulingApi';

/** The most rows GET .../dms answers (b#1243 community-dms.service.ts:28-29, no cursor): a shorter page is the whole list. */
export const COACH_DM_LIMIT = 100;
/** W17, the server's DM row title (community-notifications.types.ts:154): the name when there is no roster name. */
export const NO_NAME = 'Direct message';
export const OFF_TITLE = 'Direct messages are off';
export const OFF_LINE = 'Your clients cannot send you direct messages in your community yet.';
export const OFF_SEND_LINE = 'Direct messages are off in your community.';

export interface RosterEntry { name: string | null; archived: boolean }
/** The roster query's data: plain JSON, so the app's saved query cache restores it as it was (LS-962R1 B1). */
export type RosterData = Record<string, RosterEntry>;

const EMPTY_ROSTER: ReadonlyMap<string, RosterEntry> = new Map();
const rosterViews = new WeakMap<object, ReadonlyMap<string, RosterEntry>>();
/** The one reader of the roster: client id to entry, built once per data object. Anything else reads as empty. */
export function rosterOf(data: unknown): ReadonlyMap<string, RosterEntry> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return EMPTY_ROSTER;
  let view = rosterViews.get(data);
  if (!view) {
    view = new Map(Object.entries(data as RosterData).filter(([, r]) => !!r && typeof r === 'object'));
    rosterViews.set(data, view);
  }
  return view;
}

/** Every page of the coach's roster, active and archived, by client id (one read for names and New message). */
export function useDmRoster() {
  const coachId = useCurrentUser()?.id ?? null;
  return useQuery({
    queryKey: ['coach', 'dm-roster', coachId],
    enabled: !!coachId,
    staleTime: 60_000,
    queryFn: async (): Promise<RosterData> => {
      const byId = new Map<string, RosterEntry>();
      let cursor: string | undefined;
      for (let page = 0; page < ROSTER_MAX_PAGES; page += 1) {
        const rows: unknown = (await coachApi.getClients('all', cursor, ROSTER_PAGE_SIZE)).data;
        if (!Array.isArray(rows)) throw new Error('roster page was not a list'); // never a half-named list
        for (const r of rows as Array<{ id?: unknown; name?: unknown; archived_at?: unknown } | null>) {
          if (!r || typeof r.id !== 'string') continue;
          byId.set(r.id, { name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : null, archived: !!r.archived_at });
        }
        const last = rows[rows.length - 1] as { id?: unknown } | undefined;
        if (rows.length < ROSTER_PAGE_SIZE || typeof last?.id !== 'string') break;
        cursor = last.id;
      }
      return Object.fromEntries(byId);
    },
  });
}

/** The server's code on a failed DM call (CommunityApiError keeps the axios error as `cause`). */
export function dmCode(err: unknown): string | null {
  let e = err as { cause?: unknown; response?: { data?: { code?: unknown } } } | null | undefined;
  for (let i = 0; e && typeof e === 'object' && i < 3; i += 1, e = e.cause as typeof e) {
    if (typeof e.response?.data?.code === 'string') return e.response.data.code;
  }
  return null;
}

/** DMs off: 403 community.dm.disabled (the community's setting) or 503 community.disabled (the server switch). */
export const isDmOff = (err: unknown): boolean => ['community.dm.disabled', 'community.disabled'].includes(dmCode(err) ?? '');

/** The coach's workspace (GET /community/me: the one they own) and their DM list, read with ?limit=100. */
export function useCoachDms() {
  const me = useCommunityMe();
  const workspaceId = me.data?.workspace_id ?? null;
  const on = !!me.data?.flags.community_dm && !!workspaceId;
  const threads = useDmThreads(on ? workspaceId : null, { limit: COACH_DM_LIMIT });
  return { me, threads, off: (me.isSuccess && !on) || isDmOff(threads.error) };
}

export function initialsOf(name: string | null): string | null {
  const words = (name ?? '').split(/\s+/).filter(Boolean);
  const letter = (w?: string) => (w ? Array.from(w)[0] : '');
  const out = (letter(words[0]) + (words.length > 1 ? letter(words[words.length - 1]) : '')).toUpperCase();
  return out || null;
}
export const firstNameOf = (name: string | null): string | null => name?.split(/\s+/)[0] ?? null;

/** The day a message was sent, in the phone's zone. */
export const dayKey = (iso: string): string => calendarDateInZone(new Date(iso), resolveClientTimezone());
/** "Today", "Yesterday", else the date ("Monday, November 2"). */
export function dayLabel(iso: string, now = new Date()): string {
  const tz = resolveClientTimezone();
  const today = calendarDateInZone(now, tz);
  const key = dayKey(iso);
  if (key === today) return 'Today';
  const [y, m, d] = today.split('-').map(Number);
  return key === new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10) ? 'Yesterday' : formatDayLabel(new Date(iso), tz);
}

/** A centred state: loading, error with Try again, off, empty. One filled action at most. */
export function DmState({ icon, title, line, busy, action, onAction, outlined, testID, actionTestID }: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title?: string;
  line: string;
  busy?: boolean;
  action?: string;
  onAction?: () => void;
  outlined?: boolean;
  testID?: string;
  actionTestID?: string;
}): React.ReactElement {
  const { semanticColors: c } = useTheme();
  return (
    <View style={s.center} accessibilityState={busy ? { busy: true } : undefined} testID={testID}>
      {busy ? <ActivityIndicator color={c.accent} /> : icon ? <Ionicons name={icon} size={28} color={c.textMuted} /> : null}
      {title ? <Text style={[s.title, { color: c.textPrimary }]} accessibilityRole="header">{title}</Text> : null}
      <Text style={[s.line, { color: c.textMuted }]}>{line}</Text>
      {action && onAction ? (
        <HapticPressable intent="light" onPress={onAction} accessibilityRole="button" accessibilityLabel={action}
          testID={actionTestID}
          style={[s.action, outlined ? { borderColor: c.border, borderWidth: 1 } : { backgroundColor: fp.deep }]}>
          <Text style={[s.actionText, { color: outlined ? c.accentText : fp.onDeep }]}>{action}</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  line: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  action: { marginTop: spacing.sm, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.button, justifyContent: 'center' },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, fontWeight: '600' },
});
