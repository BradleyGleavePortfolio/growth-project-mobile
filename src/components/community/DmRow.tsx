/**
 * DmRow — a single conversation row in the DM inbox. Compact (dense row uses
 * the Roman monogram accent per voice policy §4), shows the other participant,
 * a relative last-activity time, and an unread badge. A >= 48dp touch target.
 *
 * Per the wire posture, the row never receives message bodies over realtime;
 * the thread list comes from the authenticated REST endpoint. Standardized on
 * semanticColors / tokens.ts.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/useTheme';
import { Ionicons } from '@expo/vector-icons';
import { forestPop, radius, spacing } from '../../theme/tokens';
import RomanAvatar from '../roman/RomanAvatar';
import UnreadBadge from './UnreadBadge';
import type { CommunityDmThread } from '../../api/communityApi';
import { NO_NAME } from '../../screens/community/coach-dm/coachDm';

export interface DmRowProps {
  thread: CommunityDmThread;
  /** Display label for the other participant (coach or fellow client). */
  participantLabel: string;
  /** Whether the other participant is the calling client's coach. */
  isCoach?: boolean;
  unread?: number;
  /** COACH-DM-M (Studio row): the person's initials in a tile (null: a blank tile, no name to draw them from) and a
   * chevron. Unset, the row draws as before (the client's DM list passes neither). */
  initials?: string | null;
  chevron?: boolean;
  /** REFINE-985R3 (owner pick 203-P2, DM-LIST-MOCK Style 1 "Coach first"; the client's DM list only): the first minute's
   * mark (S1_L1_ios.html .tile.ring :44, a leaf ring round the tile; .meta.now :54, "Active now" in forest 600) and the
   * time as the row's spoken value, so two rows with the same name are told apart. Unset, the row draws and reads as
   * before (the coach's DM list passes none). */
  coachFirst?: boolean;
  onPress: (thread: CommunityDmThread) => void;
  testID?: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

/** The time line under a name, the one copy of its words; `now` is the first minute. */
export function dmActivity(iso: string | null): { line: string; now: boolean } {
  const time = relativeTime(iso);
  return { line: time === 'now' ? 'Active now' : time ? `Active ${time} ago` : 'No messages yet', now: time === 'now' };
}

export default function DmRow({
  thread,
  participantLabel,
  isCoach,
  unread = 0,
  initials,
  chevron,
  coachFirst = false,
  onPress,
  testID,
}: DmRowProps): React.ReactElement {
  const { semanticColors, colorScheme } = useTheme();
  const activity = dmActivity(thread.last_message_at);
  const now = coachFirst && activity.now;
  const studio = initials !== undefined;
  // REFINE-962: Studio's row (S_list_ios.html .row :56, .mono.cl :52/:54, .nm :57, .meta :58) for the coach's list only;
  // a dark theme keeps its own text and lines.
  const studioLight = studio && colorScheme !== 'dark';
  const meta = studioLight ? forestPop.n700 : semanticColors.textMuted;

  return (
    <HapticPressable
      intent="light"
      onPress={() => onPress(thread)}
      accessibilityRole="button"
      accessibilityLabel={`Open conversation with ${participantLabel}`}
      accessibilityValue={coachFirst && thread.last_message_at ? { text: activity.line.charAt(0).toLowerCase() + activity.line.slice(1) } : undefined}
      testID={testID}
      style={[styles.row, { borderBottomColor: semanticColors.border },
        studio ? styles.studioRow : null, studioLight ? { borderBottomColor: forestPop.sageLine } : null]}
    >
      {studio ? (
        <View style={[styles.tile, { backgroundColor: forestPop.sage }]} testID={testID ? `tile-${testID}` : undefined}>
          {now ? <View style={styles.ring} testID={testID ? `ring-${testID}` : undefined} /> : null}
          {initials ? <Text style={[styles.tileText, { color: forestPop.forest }]}>{initials}</Text> : null}
        </View>
      ) : isCoach ? (
        <RomanAvatar crop="monogram" size={40} testID="dm-row-roman" />
      ) : (
        <View
          style={[
            styles.avatar,
            { backgroundColor: semanticColors.bgSurface },
          ]}
        >
          <Text style={[styles.avatarMark, { color: semanticColors.textMuted }]}>
            {/* COACH-DM-CLIENT-M: a letter only from a real name ("D" from NO_NAME would be untrue); the circle stays */}
            {participantLabel === NO_NAME ? null : participantLabel.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text
          style={[styles.name, { color: semanticColors.textPrimary }, studio ? styles.studioName : null]}
          numberOfLines={1}
        >
          {participantLabel}
          {isCoach ? '  ·  your coach' : ''}
        </Text>
        <Text style={[styles.time, { color: semanticColors.textMuted }, studio ? [styles.studioTime, { color: meta }] : null, now ? styles.nowTime : null]}>
          {activity.line}
        </Text>
      </View>
      <UnreadBadge count={unread} corner={false} testID="dm-row-badge" />
      {chevron ? <Ionicons name="chevron-forward" size={20} color={studio ? meta : semanticColors.textMuted} /> : null}
    </HapticPressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarMark: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Coach rows only (`initials` set): Studio .mono.cl 44 pt, radius 12, a 1 pt sage line.
  tile: { width: 44, height: 44, borderRadius: radius.input, borderWidth: 1, borderColor: forestPop.sageLine, justifyContent: 'center', alignItems: 'center' },
  tileText: { fontSize: 14, fontWeight: '600' },
  studioRow: { minHeight: 64, gap: 14, paddingVertical: 8, paddingHorizontal: 18, borderBottomWidth: 1 },
  studioName: { fontSize: 16.5 },
  studioTime: { fontSize: 13.5 },
  // REFINE-985R3 `coachFirst`: Style 1 .tile.ring (a 2 pt leaf outline, 2 pt off the tile: 5 pt out from inside its
  // 1 pt line, outer radius 16) and .meta.now (forest, 600).
  ring: { position: 'absolute', top: -5, right: -5, bottom: -5, left: -5, borderRadius: 16, borderWidth: 2, borderColor: forestPop.leaf },
  nowTime: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', color: forestPop.forest },
  body: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
  },
});
