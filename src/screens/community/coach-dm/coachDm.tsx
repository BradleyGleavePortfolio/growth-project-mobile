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
import { colors, forestPop as fp, radius, spacing } from '../../../theme/tokens';
import type { CommunityMeResponse } from '../../../api/communityApi';
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

/** The one off rule (LO-962R1 N2): DMs are on only when the server says community_dm true for the coach's workspace. */
export const dmOn = (me: Pick<CommunityMeResponse, 'workspace_id' | 'flags'> | null | undefined): boolean =>
  !!me?.workspace_id && me.flags?.community_dm === true;

/** The coach's workspace (GET /community/me: the one they own) and their DM list, read with ?limit=100. */
export function useCoachDms() {
  const me = useCommunityMe();
  const on = dmOn(me.data);
  const threads = useDmThreads(on ? me.data?.workspace_id : null, { limit: COACH_DM_LIMIT });
  return { me, threads, off: (!!me.data && !on) || isDmOff(threads.error) };
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
const dayNumber = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
/**
 * Studio's day rows (S_thread_ios.html .sep): "Today", "Yesterday", the weekday for 2 to 6 days back ("Monday"), else
 * the date ("Saturday, November 7"; Studio draws no older row). Days are calendar days in the phone's zone, so a clock
 * change or a message just before midnight never shifts a row.
 */
export function dayLabel(iso: string, now = new Date()): string {
  const tz = resolveClientTimezone();
  const back = dayNumber(calendarDateInZone(now, tz)) - dayNumber(dayKey(iso));
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  if (back >= 2 && back <= 6) return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(iso));
  return formatDayLabel(new Date(iso), tz);
}

/** Studio's light inks (S_thread_ios.html :56-:70); a dark theme keeps its own text and lines. */
export function useStudioInk() {
  const { semanticColors: c, colorScheme } = useTheme();
  const light = colorScheme !== 'dark';
  return {
    body: light ? colors.charcoal : c.textMuted, // #3D3D3A: state lines, day rows
    meta: light ? fp.n700 : c.textMuted, // #5A5A56: times, counts, glyphs
    line: light ? fp.sageLine : c.border, // #C9D8CD: dividers and outlines
    accent: light ? fp.forest : c.accentText, // #2C4A36
  };
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
  const ink = useStudioInk();
  const alert = icon === 'alert-circle-outline'; // Studio: the alert at 30 in grey, the bubble at 34 in forest
  return (
    <View style={s.center} accessibilityState={busy ? { busy: true } : undefined} testID={testID}>
      {busy ? <ActivityIndicator color={c.accent} />
        : icon ? <Ionicons name={icon} size={alert ? 30 : 34} color={alert ? ink.meta : ink.accent} /> : null}
      {title ? <Text style={[s.title, { color: c.textPrimary }]} accessibilityRole="header">{title}</Text> : null}
      <Text style={[s.line, { color: ink.body }]}>{line}</Text>
      {action && onAction ? (
        <HapticPressable intent="light" onPress={onAction} accessibilityRole="button" accessibilityLabel={action}
          testID={actionTestID}
          style={[s.action, outlined ? { borderColor: ink.line, borderWidth: 1.5 } : { backgroundColor: fp.forest }]}>
          <Text style={[s.actionText, { color: outlined ? ink.accent : fp.onDeep }]}>{action}</Text>
        </HapticPressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // Studio .state, h2, p, .btn (S_list_ios.html:64-:68)
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 20, fontWeight: '600', textAlign: 'center' },
  line: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  action: { marginTop: spacing.xs, minHeight: 48, paddingHorizontal: 18, borderRadius: radius.button, justifyContent: 'center' },
  actionText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, fontWeight: '600' },
});
