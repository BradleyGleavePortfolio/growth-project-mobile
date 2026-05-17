/**
 * CommunityWinCard — Contribution Loops (UX Psych #5)
 *
 * Displays an anonymised community win. Reaction buttons have been removed
 * as the reactToWin API has been deprecated.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CommunityWinCard({ win }: CommunityWinCardProps) {
  const displayName = win.displayName ?? win.user?.name ?? 'A member';
  const action = win.action ?? win.title ?? '';
  const timestamp = win.createdAt ?? win.created_at;

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
    fontWeight: '500',
  },
  nameMeta: {
    flex: 1,
  },
  displayName: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.primary,
  },
  timeAgo: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 1,
  },
  action: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.textPrimary,
    lineHeight: 21,
  },
  description: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
