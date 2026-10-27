/**
 * SpaceTree (C6-M1S; C6CHAT-S-V2 c01 and x1, MOCK-COMMX2): the community's
 * sections, drawn on the Home page or, `deep`, in the space-list drawer. One
 * reader (useSpaceTree) feeds both, so they never disagree.
 *
 * Today's API has no layers (B-LAYERS) and no threads (B4), so the spaces
 * are one flat Spaces section in the server's order. Each space carries the
 * server's unread count (SC-BE2 `unread_count`, 99 = "99+"; m#871 Sol B5);
 * an older server sends none and the row has no badge. Section-kind spaces hold
 * other spaces, so they wait for B-LAYERS. The coach row is the C3 coach
 * thread with its real unread count.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import api from '../../services/api';
import HapticPressable from '../HapticPressable';
import { featureFlags } from '../../config/featureFlags';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachChatClosed } from '../../hooks/useCoachChatClosed';
import { communityKeys, useCommunityCohorts, useCommunityMe, useCommunityWorkspace } from '../../hooks/useCommunity';
import { HapticService } from '../../ui/haptics/haptics.service';
import { startSpaceOutbox } from './space-chat/spaceChatOutbox';
import { forestPop as fp, layout, typography } from '../../theme/tokens';
import type { CommunityNav } from '../../screens/community/communityNavTypes';

export type SpaceTarget =
  | { kind: 'space'; id: string }
  | { kind: 'coach' }
  | { kind: 'route'; name: 'Leaderboard' | 'CommunityClassroom' };

type IconName = React.ComponentProps<typeof Ionicons>['name'];
export interface SpaceRow { key: string; label: string; icon: IconName | '#'; meta?: string; chip?: string; badge?: number; target: SpaceTarget }
export interface SpaceSection { key: string; title: string; rows: SpaceRow[] }

/** SC-BE2 caps a space's count at 99, meaning 99 or more: drawn "99+" like any count over 99. */
const spaceBadge = (n: number | undefined) => (n != null && n >= 99 ? 100 : n);
const firstWord = (v: unknown) => (typeof v === 'string' ? (v.trim().split(/\s+/)[0] ?? '') : '');

/** The community name, its sections, and the load state, from today's endpoints. */
export function useSpaceTree() {
  const user = useCurrentUser();
  const coachId = user?.coach_id ?? null;
  // FX-871: the space chat outbox starts with Community Home, so texts kept from an earlier session go out unopened.
  useEffect(() => { if (featureFlags.communitySpaceChat) startSpaceOutbox(user?.id ?? null); }, [user?.id]);
  const me = useCommunityMe();
  const workspaceId = me.data?.feature_flag_state === 'enabled' ? (me.data.workspace_id ?? null) : null;
  const cohorts = useCommunityCohorts(workspaceId != null);
  // FR-871R6 (Sol B879-6): a live ping re-reads only community/me (useCommunityBadge). When its space count moves,
  // the per-space counts are read again too, so an open Home or drawer shows the new numbers with no pull.
  const qc = useQueryClient();
  const spaceUnread = me.data?.unread?.cohort_messages;
  const seenUnread = useRef(spaceUnread);
  useEffect(() => {
    if (spaceUnread === undefined || spaceUnread === seenUnread.current) return;
    const first = seenUnread.current === undefined;
    seenUnread.current = spaceUnread;
    if (!first) void qc.invalidateQueries({ queryKey: communityKeys.cohorts() });
  }, [qc, spaceUnread]);
  const workspace = useCommunityWorkspace(workspaceId);
  const coachName = useQuery({
    queryKey: ['community', 'home', 'coach-name', coachId],
    enabled: coachId != null,
    staleTime: 300_000,
    queryFn: async () => (await api.get<{ name?: unknown }>('/v1/clients/me/coach')).data?.name ?? null,
  });
  const coachUnread = useQuery({
    queryKey: ['community', 'home', 'coach-unread', coachId],
    enabled: coachId != null,
    refetchInterval: 30_000,
    queryFn: async () => Number((await api.get<{ total?: unknown }>('/messages/unread-count')).data?.total) || 0,
  });

  const spaces: SpaceRow[] = (cohorts.data?.cohorts ?? [])
    .filter((c) => c.kind !== 'section')
    .map((c): SpaceRow => ({ key: c.id, label: c.name, icon: c.kind === 'announcement' ? 'megaphone-outline' : '#', badge: spaceBadge(c.unread_count), target: { kind: 'space', id: c.id } }));
  if (coachId) spaces.push({ key: 'leaderboard', label: 'Leaderboard', icon: 'podium-outline', chip: 'Private', target: { kind: 'route', name: 'Leaderboard' } });
  if (featureFlags.communityClassroom) spaces.push({ key: 'classroom', label: 'Classroom', icon: 'book-outline', target: { kind: 'route', name: 'CommunityClassroom' } });
  // FR-880R2 (owner 10-23 "Dissapear", Sol B2): a closed coaching chat, either person's block, leaves Community Home
  // and the drawer: no row, no name, no count. The row waits for the first answer so it never shows and then goes.
  const coachChat = useCoachChatClosed(coachId);
  const first = firstWord(coachName.data);
  const dms: SpaceRow[] = coachId && coachChat.known && !coachChat.closed
    ? [{ key: 'coach', label: first || 'Your coach', meta: first ? 'Your coach' : undefined, icon: 'chatbubble-outline', badge: coachUnread.data ?? 0, target: { kind: 'coach' } }]
    : [];
  const sections: SpaceSection[] = [
    { key: 'spaces', title: 'Spaces', rows: spaces },
    { key: 'dms', title: 'Direct messages', rows: dms },
  ].filter((sec) => sec.rows.length > 0);

  const retry = async () => {
    const results = await Promise.all([me.isError ? me.refetch() : null, cohorts.isError ? cohorts.refetch() : null]);
    if (results.some((r) => r?.isError)) void HapticService.error();
  };
  return {
    name: workspace.data?.name.trim() || 'Community',
    sections,
    loading: me.isLoading || cohorts.isLoading,
    failed: me.isError || cohorts.isError,
    retry,
  };
}

/** Where a row goes. A space from the drawer replaces the open space, so Back still returns to Home. */
export function useOpenSpaceTarget(replaceSpace = false) {
  const nav = useNavigation<CommunityNav>();
  const root = nav as unknown as NavigationProp<ParamListBase>;
  return (t: SpaceTarget) => {
    if (t.kind === 'coach') root.navigate('Home', { screen: 'Messages' });
    else if (t.kind === 'route') root.navigate(t.name);
    else if (featureFlags.communitySpaceChat && replaceSpace) nav.replace('CommunitySpaceChat', { cohortId: t.id });
    else if (featureFlags.communitySpaceChat) nav.navigate('CommunitySpaceChat', { cohortId: t.id });
    else if (replaceSpace) nav.replace('CommunitySpace', { space: 'cohort', cohortId: t.id });
    else nav.navigate('CommunitySpace', { space: 'cohort', cohortId: t.id });
  };
}

/** The community's letter in gold (the coach's colour) on a forest tile. */
export function Monogram({ name, size = 44 }: { name: string; size?: number }): React.ReactElement {
  return (
    <View style={[s.tile, { width: size, height: size }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[s.letter, { fontSize: size * 0.58, lineHeight: size * 0.75 }]} maxFontSizeMultiplier={1}>
        {name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

const PAGE = { head: fp.forest, text: fp.ink, meta: fp.brand400, icon: fp.forest, chipBg: fp.sage, chipText: fp.forest };
const DEEP = { head: fp.onDeepMuted, text: fp.onDeep, meta: fp.onDeepMuted, icon: fp.onDeepMuted, chipBg: fp.forest, chipText: fp.onDeepMuted };

export function SpaceTree({ sections, deep = false, activeId, onOpen }: {
  sections: SpaceSection[];
  deep?: boolean;
  activeId?: string;
  onOpen: (t: SpaceTarget) => void;
}): React.ReactElement {
  const c = deep ? DEEP : PAGE;
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  return (
    <View>
      {sections.map((sec) => {
        const open = !closed[sec.key];
        return (
          <View key={sec.key}>
            <HapticPressable
              intent="light"
              onPress={() => setClosed((m) => ({ ...m, [sec.key]: open }))}
              accessibilityRole="button"
              accessibilityLabel={sec.title}
              accessibilityState={{ expanded: open }}
              style={s.header}
              testID={`space-section-${sec.key}`}
            >
              <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={c.head} />
              <Text style={[s.headText, { color: c.head }]}>{sec.title}</Text>
            </HapticPressable>
            {open
              ? sec.rows.map((r) => {
                  const active = r.target.kind === 'space' && r.target.id === activeId;
                  const badge = r.badge ?? 0;
                  return (
                    <HapticPressable
                      key={r.key}
                      intent="light"
                      onPress={() => onOpen(r.target)}
                      accessibilityRole="button"
                      accessibilityLabel={[r.label, r.meta, r.chip, badge > 0 ? `${badge > 99 ? '99+' : badge} new` : null].filter(Boolean).join(', ')}
                      accessibilityState={{ selected: active }}
                      style={[s.row, active && s.active]}
                      testID={`space-row-${r.key}`}
                    >
                      <View style={s.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        {r.icon === '#' ? <Text style={[s.hash, { color: c.icon }]}>#</Text> : <Ionicons name={r.icon} size={20} color={c.icon} />}
                      </View>
                      <Text numberOfLines={1} style={[s.label, { color: c.text }, badge > 0 && s.bold]}>
                        {r.label}
                        {r.meta ? <Text style={[s.meta, { color: c.meta }]}>{` · ${r.meta}`}</Text> : null}
                      </Text>
                      {r.chip ? (
                        <View style={[s.chip, { backgroundColor: c.chipBg }]}>
                          <Text style={[s.chipText, { color: c.chipText }]}>{r.chip}</Text>
                        </View>
                      ) : null}
                      {badge > 0 ? (
                        <View style={[s.badge, !deep && s.badgeEdge]} testID={`space-row-${r.key}-badge`}>
                          <Text style={s.badgeText} maxFontSizeMultiplier={1.3}>{badge > 99 ? '99+' : badge}</Text>
                        </View>
                      ) : null}
                    </HapticPressable>
                  );
                })
              : null}
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  tile: { borderRadius: 12, backgroundColor: fp.forest, borderWidth: 1, borderColor: fp.brand400, alignItems: 'center', justifyContent: 'center' },
  letter: { fontFamily: 'CormorantGaramond_400Regular', color: fp.gold },
  header: { minHeight: layout.touchMin, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginTop: 8 },
  headText: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontSize: 12, lineHeight: 16, letterSpacing: 1.4 },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderLeftWidth: 4, borderLeftColor: 'transparent' },
  active: { backgroundColor: fp.forest, borderLeftColor: fp.leaf },
  icon: { width: 24, alignItems: 'center' },
  hash: { fontFamily: 'Inter_400Regular', fontSize: 22, lineHeight: 26 },
  label: { ...typography.h4, fontFamily: 'Inter_400Regular', flex: 1 },
  bold: { fontFamily: 'Inter_600SemiBold' },
  meta: { fontFamily: 'Inter_400Regular' },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { ...typography.caption, letterSpacing: 0.2 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: fp.leaf, alignItems: 'center', justifyContent: 'center' },
  badgeEdge: { borderWidth: 1.5, borderColor: fp.moss },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 16, color: fp.ink },
});
