/**
 * LeaderboardScreen — Phase 7C
 *
 * Displays the combined-score leaderboard for the requesting user's
 * coach roster. Only opted-in peers appear. The requesting user's row
 * is always rendered, highlighted with an oxblood underline.
 *
 * Design doctrine:
 *   - Bone/ink/oxblood palette from tokens.ts.
 *   - Cormorant Garamond display, Inter body.
 *   - No emoji, no celebration chrome.
 *   - Numbers over adjectives.
 *   - Raw weight, body fat, and monetary data NEVER surfaced.
 *
 * States:
 *   1. Loading — activity indicator, bone background.
 *   2. Empty (not opted in) — opt-in card with toggle + display name input.
 *   3. Empty (opted in, no peers) — instructional copy.
 *   4. Populated — ranked list of rows.
 *   5. Error — minimal error message, retry action.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors } from '../../theme/tokens';
import {
  getLeaderboard,
  setLeaderboardOptIn,
  LeaderboardEntry,
  LeaderboardResponse,
} from '../../services/leaderboardApi';

// ─── Constants ────────────────────────────────────────────────────────────────

// Oxblood used for self-row highlight and negative deltas.
// Sourced from the bone/ink/oxblood doctrine palette.
const OXBLOOD = '#4A0404';

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  return (
    <View style={styles.barTrack} accessibilityLabel={`Score bar: ${score} of 100`}>
      <View style={[styles.barFill, { width: `${score}%` }]} />
    </View>
  );
}

/**
 * Renders a single rank row.
 * The self-row (isRequester) uses a distinct style (oxblood underline)
 * and a stable testID so UI tests can reliably locate it.
 */
function RankRow({ entry }: { entry: LeaderboardEntry }) {
  const isMe = entry.isRequester;
  const hasDelta = entry.weekDelta !== null && entry.weekDelta !== 0;
  const deltaSign = (entry.weekDelta ?? 0) > 0 ? '+' : '';
  const deltaColor = (entry.weekDelta ?? 0) >= 0 ? colors.forest : OXBLOOD;

  const inner = (
    <>
      <Text style={styles.rankText}>{entry.rank}</Text>
      <View style={styles.rowMiddle}>
        <Text style={[styles.nameText, isMe && styles.nameTextMe]} numberOfLines={1}>
          {entry.displayName}
        </Text>
        <ScoreBar score={entry.combinedScore} />
      </View>
      <View style={styles.scoreBlock}>
        <Text style={styles.scoreText}>{entry.combinedScore}</Text>
        {hasDelta && (
          <Text style={[styles.deltaText, { color: deltaColor }]}>
            {deltaSign}{entry.weekDelta}
          </Text>
        )}
      </View>
    </>
  );

  // Self-row: oxblood underline highlight + stable testID for UI tests.
  if (isMe) {
    return (
      <View
        style={[styles.row, styles.rowHighlighted]}
        accessibilityRole="text"
        testID="leaderboard-self-row"
      >
        {inner}
      </View>
    );
  }

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      testID={`leaderboard-row-${entry.userId}`}
    >
      {inner}
    </View>
  );
}

function OptInCard({
  onOptIn,
  saving,
}: {
  onOptIn: (displayName: string) => void;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState('');

  return (
    <View style={styles.optInCard} testID="leaderboard-opt-in-card">
      <Text style={styles.optInHeading}>Join the leaderboard</Text>
      <Text style={styles.optInBody}>
        Opt in to your coach's leaderboard. You'll show up as soon as you log activity.
      </Text>
      <Text style={styles.optInBody}>
        Your combined score reflects check-in consistency, workouts logged, meals
        logged, and coach engagement — weight and monetary data are never shared.
      </Text>
      <TextInput
        style={styles.nameInput}
        placeholder="Display name (optional)"
        placeholderTextColor={colors.stone}
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={40}
        autoCapitalize="words"
        testID="leaderboard-display-name-input"
      />
      <Pressable
        style={[styles.optInButton, saving && styles.optInButtonDisabled]}
        onPress={() => onOptIn(displayName)}
        disabled={saving}
        testID="leaderboard-opt-in-button"
        accessibilityRole="button"
        accessibilityLabel="Opt in to leaderboard"
      >
        <Text style={styles.optInButtonText}>{saving ? 'Saving…' : 'Opt in'}</Text>
      </Pressable>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LeaderboardScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardResponse | null>(null);

  const isOptedIn = data?.entries.some((e) => e.isRequester) ?? false;

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await getLeaderboard();
      setData(result);
    } catch {
      setError('Unable to load the leaderboard. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOptIn = async (displayName: string) => {
    setSaving(true);
    try {
      await setLeaderboardOptIn({
        enabled: true,
        displayName: displayName.trim() || undefined,
      });
      await load();
    } catch {
      setError('Could not save your preference. Try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered} testID="leaderboard-loading">
        <ActivityIndicator color={colors.ink} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered} testID="leaderboard-error">
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={load} style={styles.retryButton} accessibilityRole="button">
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const publicEntries = data?.entries.filter((e) => !e.isRequester || isOptedIn) ?? [];
  const selfEntry = data?.entries.find((e) => e.isRequester);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        {data?.selfRank != null && (
          <Text style={styles.selfRankLabel}>Your rank: {data.selfRank}</Text>
        )}
      </View>

      {/* Column headers */}
      {publicEntries.length > 0 && (
        <View style={styles.columnHeaders}>
          <Text style={styles.colHeaderRank}>#</Text>
          <Text style={styles.colHeaderName}>Member</Text>
          <Text style={styles.colHeaderScore}>Score</Text>
        </View>
      )}

      <FlatList
        data={publicEntries}
        keyExtractor={(item) => item.userId}
        renderItem={({ item }) => <RankRow entry={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          isOptedIn ? (
            <View style={styles.emptyState} testID="leaderboard-empty-opted-in">
              <Text style={styles.emptyText}>
                No peers have opted in yet. Your score will appear here once others join.
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          !isOptedIn ? (
            <OptInCard onOptIn={handleOptIn} saving={saving} />
          ) : null
        }
      />

      {/* Sticky self-row when not already visible at top */}
      {isOptedIn && selfEntry && selfEntry.rank > 5 && (
        <View style={styles.stickyRow} testID="leaderboard-sticky-self-row">
          <RankRow entry={selfEntry} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bone,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bone,
    padding: 24,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.stone,
  },
  title: {
    fontFamily: 'Cormorant-SemiBold',
    fontSize: 28,
    color: colors.ink,
    letterSpacing: 0.2,
  },
  selfRankLabel: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: colors.charcoal,
    marginTop: 4,
  },
  columnHeaders: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  colHeaderRank: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: colors.stone,
    width: 32,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  colHeaderName: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: colors.stone,
    flex: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  colHeaderScore: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: colors.stone,
    width: 52,
    textAlign: 'right',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  list: {
    paddingBottom: 32,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.stone,
  },
  rowHighlighted: {
    borderBottomWidth: 2,
    borderBottomColor: OXBLOOD,
  },
  rankText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: colors.charcoal,
    width: 32,
  },
  rowMiddle: {
    flex: 1,
    marginRight: 12,
  },
  nameText: {
    fontFamily: 'Inter-Regular',
    fontSize: 15,
    color: colors.ink,
    marginBottom: 5,
  },
  nameTextMe: {
    fontFamily: 'Inter-SemiBold',
    color: colors.ink,
  },
  barTrack: {
    height: 3,
    backgroundColor: colors.cream,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: 3,
    backgroundColor: colors.forest,
    borderRadius: 2,
  },
  scoreBlock: {
    alignItems: 'flex-end',
    width: 52,
  },
  scoreText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 18,
    color: colors.ink,
  },
  deltaText: {
    fontFamily: 'Inter-Regular',
    fontSize: 11,
    marginTop: 2,
  },
  emptyState: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: colors.charcoal,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorText: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: colors.charcoal,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  retryText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: colors.ink,
  },
  optInCard: {
    margin: 20,
    padding: 24,
    backgroundColor: colors.cream,
    borderWidth: 0.5,
    borderColor: colors.stone,
  },
  optInHeading: {
    fontFamily: 'Cormorant-SemiBold',
    fontSize: 22,
    color: colors.ink,
    marginBottom: 12,
  },
  optInBody: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: colors.charcoal,
    lineHeight: 22,
    marginBottom: 12,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: colors.stone,
    padding: 12,
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.bone,
    marginBottom: 16,
    marginTop: 4,
  },
  optInButton: {
    backgroundColor: colors.ink,
    paddingVertical: 14,
    alignItems: 'center',
  },
  optInButtonDisabled: {
    backgroundColor: colors.stone,
  },
  optInButtonText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: colors.bone,
    letterSpacing: 0.5,
  },
  stickyRow: {
    borderTopWidth: 0.5,
    borderTopColor: colors.stone,
    backgroundColor: colors.bone,
  },
});
