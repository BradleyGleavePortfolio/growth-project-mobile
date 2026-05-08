/**
 * PrivateCommunityHubScreen — Wave 11.
 *
 * Private community hub: rooms, cohorts, announcements, coach-led threads.
 * STUB: backend not live; the adapter returns an empty payload and the UI
 * renders the appropriate empty state.
 *
 * Doctrine encoded:
 *   - Default surface is private + coach-led + restrained. There is no
 *     "global feed" tab.
 *   - Voice-note attachment is shown as a gated affordance behind the
 *     `communityVoiceNotes` flag (OFF by default — no false promises).
 *   - Member counts are deliberately rounded ("about 12") to discourage
 *     vanity comparisons.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors as tokens, typography, spacing } from '../../theme/tokens';
import { fetchCommunityHub } from '../../services/wave11Adapters';
import type {
  CommunityHubPayload,
  CommunityRoom,
  CommunityRoomKind,
  CommunityPost,
} from '../../types/wave11';
import EmptyState from '../../components/EmptyState';
import { featureFlags } from '../../config/featureFlags';

const ROOM_LABEL: Record<CommunityRoomKind, string> = {
  private_room: 'Private room',
  cohort: 'Cohort',
  announcement: 'Announcement',
  coach_led_thread: 'Coach-led thread',
};

const ROOM_ICON: Record<CommunityRoomKind, keyof typeof Ionicons.glyphMap> = {
  private_room: 'lock-closed-outline',
  cohort: 'people-outline',
  announcement: 'megaphone-outline',
  coach_led_thread: 'chatbubbles-outline',
};

function approxCount(n: number): string {
  if (n < 5) return `${n} members`;
  if (n < 12) return 'about 10 members';
  if (n < 25) return 'about 20 members';
  if (n < 50) return 'about 40 members';
  return `${Math.round(n / 50) * 50}+ members`;
}

export default function PrivateCommunityHubScreen() {
  const [payload, setPayload] = useState<CommunityHubPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetchCommunityHub();
      setPayload(next);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!featureFlags.privateCommunityHub) {
    return (
      <View
        style={styles.flagOff}
        accessibilityLabel="Community is preview-only"
        accessibilityRole="none"
      >
        <EmptyState
          icon="lock-closed-outline"
          title="Community is preview-only"
          subtitle="Private rooms, cohorts, and coach-led threads are in development."
        />
      </View>
    );
  }

  if (loading && !payload) {
    return (
      <View
        style={styles.center}
        accessibilityLabel="Loading community"
        accessibilityRole="none"
      >
        <ActivityIndicator color={tokens.forest} />
      </View>
    );
  }

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      accessibilityLabel="Private Community Hub screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          accessibilityLabel="Pull to refresh community"
        />
      }
    >
      <Text style={styles.title} accessibilityRole="header">Community</Text>
      <Text style={styles.subtitle}>
        Private, coach-led. Restrained on purpose — quiet beats noisy.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Rooms</Text>
        {payload!.rooms.length === 0 ? (
          <EmptyState
            icon="home-outline"
            title="No rooms yet"
            subtitle="Your coach will invite you to a private room or cohort. You won't be added without an invitation."
          />
        ) : (
          payload!.rooms.map((r) => <RoomRow key={r.id} room={r} />)
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">Recent posts</Text>
        {payload!.recentPosts.length === 0 ? (
          <EmptyState
            icon="document-text-outline"
            title="Nothing new here"
            subtitle="Posts from your rooms appear here. Voice notes are coming — they'll always be reviewed before they go live."
          />
        ) : (
          payload!.recentPosts.map((p) => <PostRow key={p.id} post={p} />)
        )}
      </View>

      {!featureFlags.communityVoiceNotes ? (
        <View
          style={styles.gatedNote}
          accessibilityLabel="Voice notes coming soon — will be reviewed before going live"
          accessibilityRole="none"
        >
          <Ionicons name="mic-off-outline" size={14} color={tokens.charcoal} />
          <Text style={styles.gatedText}>
            Voice notes are coming soon. They&apos;ll be capped at 60s and scanned
            before they reach your room.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function RoomRow({ room }: { room: CommunityRoom }) {
  return (
    <View
      style={styles.roomRow}
      accessibilityRole="none"
      accessibilityLabel={`${room.title}, ${ROOM_LABEL[room.kind]}, ${approxCount(room.memberCountApprox)}${room.invitationOnly ? ', invite only' : ''}`}
    >
      <View style={styles.roomIcon}>
        <Ionicons name={ROOM_ICON[room.kind]} size={18} color={tokens.charcoal} />
      </View>
      <View style={styles.roomBody}>
        <Text style={styles.roomTitle}>{room.title}</Text>
        <Text style={styles.roomMeta}>
          {ROOM_LABEL[room.kind]} · {approxCount(room.memberCountApprox)}
          {room.invitationOnly ? ' · invite only' : ''}
        </Text>
      </View>
    </View>
  );
}

function PostRow({ post }: { post: CommunityPost }) {
  const hasVoice = post.attachments.some((a) => a.kind === 'voice_note');
  return (
    <View
      style={styles.post}
      accessibilityRole="none"
      accessibilityLabel={`Post by ${post.author.displayName}${post.pinned ? ', pinned' : ''}`}
    >
      <View style={styles.postHead}>
        <Text style={styles.postAuthor}>{post.author.displayName}</Text>
        {post.pinned ? (
          <Ionicons name="pin" size={13} color={tokens.mutedGold} />
        ) : null}
      </View>
      <Text style={styles.postBody} numberOfLines={3}>
        {post.body}
      </Text>
      {hasVoice && featureFlags.communityVoiceNotes ? (
        <View style={styles.voiceRow}>
          <Ionicons name="mic-outline" size={14} color={tokens.forest} />
          <Text style={styles.voiceText}>Voice note attached</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: tokens.bone },
  content: { padding: spacing.lg, paddingBottom: spacing['3xl'] },
  flagOff: { flex: 1, backgroundColor: tokens.bone, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.bone },
  title: { ...typography.h1, color: tokens.ink, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: tokens.charcoal, marginBottom: spacing.lg },
  section: { marginTop: spacing.lg, gap: spacing.md },
  sectionTitle: { ...typography.h3, color: tokens.ink, marginBottom: spacing.xs },
  roomRow: {
    flexDirection: 'row',
    backgroundColor: tokens.cream,
    borderRadius: 4,
    padding: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
  },
  roomIcon: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: tokens.bone,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roomBody: { flex: 1, gap: 2 },
  roomTitle: { ...typography.bodyMd, color: tokens.ink, fontWeight: '500' },
  roomMeta: { ...typography.bodySmall, color: tokens.charcoal },
  post: {
    backgroundColor: tokens.cream,
    borderRadius: 4,
    padding: spacing.md,
    gap: 6,
  },
  postHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  postAuthor: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: tokens.ink,
    flex: 1,
  },
  postBody: { ...typography.body, color: tokens.charcoal },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  voiceText: { ...typography.bodySmall, color: tokens.forest, fontWeight: '500' },
  gatedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: tokens.stone,
    borderStyle: 'dashed',
  },
  gatedText: { ...typography.bodySmall, color: tokens.charcoal, flex: 1 },
});
