/**
 * CommunityWinCard — Contribution Loops (UX Psych #5)
 *
 * Displays an anonymised community win with fire  and clap  reaction
 * buttons. Taps trigger HapticPressable for tactile feedback and call the
 * reactToWin mutation. Counts update optimistically via React Query.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import HapticPressable from '../HapticPressable';
import { ApiCommunityWin } from '../../hooks/useApi';
import { Colors } from '../../constants/colors';

// ─── Relative-time helper ─────────────────────────────────────────────────────
function formatTimeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'Yesterday' : `${days}d ago`;
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface CommunityWinCardProps {
  win: ApiCommunityWin;
  onReact: (winId: string, kind: 'fire' | 'clap') => void;
  isPending?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CommunityWinCard({ win, onReact, isPending }: CommunityWinCardProps) {
  // Local optimistic counts until React Query re-fetches
  const [localReactions, setLocalReactions] = useState<{ fire: number; clap: number } | null>(
    null,
  );

  const reactions = localReactions ?? win.reactions ?? { fire: 0, clap: 0 };
  const displayName = win.displayName ?? win.user?.name ?? 'A member';
  const action = win.action ?? win.title ?? '';
  const timestamp = win.createdAt ?? win.created_at;

  const handleReact = (kind: 'fire' | 'clap') => {
    if (isPending) return;
    // Optimistic update
    setLocalReactions({ ...reactions, [kind]: reactions[kind] + 1 });
    onReact(win.id, kind);
  };

  return (
    <View style={styles.card}>
      {/* Top row: name + time */}
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.nameMeta}>
          <Text style={styles.displayName}>{displayName}</Text>
          <Text style={styles.timeAgo}>{formatTimeAgo(timestamp)}</Text>
        </View>
      </View>

      {/* Win action text */}
      <Text style={styles.action}>{action}</Text>
      {win.description && win.description !== action ? (
        <Text style={styles.description}>{win.description}</Text>
      ) : null}

      {/* Reaction buttons */}
      <View style={styles.reactionRow}>
        <HapticPressable
          style={styles.reactionBtn}
          onPress={() => handleReact('fire')}
          accessibilityLabel={`Fire reaction, ${reactions.fire} so far`}
          accessibilityRole="button"
        >
          <Text style={styles.reactionEmoji}></Text>
          <Text style={styles.reactionCount}>{reactions.fire}</Text>
        </HapticPressable>

        <HapticPressable
          style={styles.reactionBtn}
          onPress={() => handleReact('clap')}
          accessibilityLabel={`Clap reaction, ${reactions.clap} so far`}
          accessibilityRole="button"
        >
          <Text style={styles.reactionEmoji}></Text>
          <Text style={styles.reactionCount}>{reactions.clap}</Text>
        </HapticPressable>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.primaryDark,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: Colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  nameMeta: {
    flex: 1,
  },
  displayName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
  },
  timeAgo: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  action: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  description: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  reactionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.background,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reactionEmoji: {
    fontSize: 16,
  },
  reactionCount: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
});
