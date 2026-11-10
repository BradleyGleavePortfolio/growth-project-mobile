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

export default function DmRow({
  thread,
  participantLabel,
  isCoach,
  unread = 0,
  initials,
  chevron,
  onPress,
  testID,
}: DmRowProps): React.ReactElement {
  const { semanticColors } = useTheme();
  const time = relativeTime(thread.last_message_at);
  const studio = initials !== undefined;

  return (
    <HapticPressable
      intent="light"
      onPress={() => onPress(thread)}
      accessibilityRole="button"
      accessibilityLabel={`Open conversation with ${participantLabel}`}
      testID={testID}
      style={[styles.row, { borderBottomColor: semanticColors.border }]}
    >
      {studio ? (
        <View style={[styles.tile, { backgroundColor: forestPop.sage }]}>
          {initials ? <Text style={[styles.tileText, { color: forestPop.deep }]}>{initials}</Text> : null}
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
            {participantLabel.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <Text
          style={[styles.name, { color: semanticColors.textPrimary }]}
          numberOfLines={1}
        >
          {participantLabel}
          {isCoach ? '  ·  your coach' : ''}
        </Text>
        <Text style={[styles.time, { color: semanticColors.textMuted }]}>
          {time === 'now' && studio ? 'Active now' : time ? `Active ${time} ago` : 'No messages yet'}
        </Text>
      </View>
      <UnreadBadge count={unread} corner={false} testID="dm-row-badge" />
      {chevron ? <Ionicons name="chevron-forward" size={20} color={semanticColors.textMuted} /> : null}
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
  tile: { width: 40, height: 40, borderRadius: radius.input, justifyContent: 'center', alignItems: 'center' },
  tileText: { fontSize: 14, fontWeight: '600' },
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
