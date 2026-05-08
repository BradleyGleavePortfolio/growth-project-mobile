/**
 * LeaderboardScreen — Phase 7C
 * Phase 11: Migrated to useTheme() semantic tokens for dark-mode support.
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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import {
  getLeaderboard,
  setLeaderboardOptIn,
  LeaderboardEntry,
  LeaderboardResponse,
} from '../../services/leaderboardApi';

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreBar({ score, sc }: { score: number; sc: SemanticTokens }) {
  const barStyles = useMemo(
    () => StyleSheet.create({
      track: { height: 3, backgroundColor: sc.bgSurface, borderRadius: 2, overflow: 'hidden' },
      fill:  { height: 3, backgroundColor: sc.accent,    borderRadius: 2 },
    }),
    [sc],
  );
  return (
    <View style={barStyles.track} accessibilityLabel={`Score bar: ${score} of 100`}>
      <View style={[barStyles.fill, { width: `${score}%` as `${number}%` }]} />
    </View>
  );
}

/**
 * Renders a single rank row.
 * The self-row (isRequester) uses a distinct style (oxblood underline)
 * and a stable testID so UI tests can reliably locate it.
 */
function RankRow({ entry, sc }: { entry: LeaderboardEntry; sc: SemanticTokens }) {
  const isMe = entry.isRequester;
  const hasDelta = entry.weekDelta !== null && entry.weekDelta !== 0;
  const deltaSign = (entry.weekDelta ?? 0) > 0 ? '+' : '';
  // Positive delta = accent; negative delta = accent (oxblood is the accent in both modes)
  const deltaColor = sc.accent;

  const rowStyles = useMemo(
    () => StyleSheet.create({
      row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 0.5,
        borderBottomColor: sc.border,
      },
      rowHighlighted: {
        borderBottomWidth: 2,
        borderBottomColor: sc.accent,
      },
      rankText: { fontFamily: 'Inter-Medium', fontSize: 14, color: sc.textMuted, width: 32 },
      nameText: { fontFamily: 'Inter-Regular', fontSize: 15, color: sc.textPrimary, marginBottom: 5 },
      nameTextMe: { fontFamily: 'Inter-SemiBold', color: sc.textPrimary },
      rowMiddle: { flex: 1, marginRight: 12 },
      scoreBlock: { alignItems: 'flex-end', width: 52 },
      scoreText: { fontFamily: 'Inter-SemiBold', fontSize: 18, color: sc.textPrimary },
      deltaText: { fontFamily: 'Inter-Regular', fontSize: 11, marginTop: 2 },
    }),
    [sc],
  );

  const inner = (
    <>
      <Text style={rowStyles.rankText}>{entry.rank}</Text>
      <View style={rowStyles.rowMiddle}>
        <Text style={[rowStyles.nameText, isMe && rowStyles.nameTextMe]} numberOfLines={1}>
          {entry.displayName}
        </Text>
        <ScoreBar score={entry.combinedScore} sc={sc} />
      </View>
      <View style={rowStyles.scoreBlock}>
        <Text style={rowStyles.scoreText}>{entry.combinedScore}</Text>
        {hasDelta && (
          <Text style={[rowStyles.deltaText, { color: deltaColor }]}>
            {deltaSign}{entry.weekDelta}
          </Text>
        )}
      </View>
    </>
  );

  // Self-row: accent underline highlight + stable testID for UI tests.
  if (isMe) {
    return (
      <View
        style={[rowStyles.row, rowStyles.rowHighlighted]}
        accessibilityRole="text"
        testID="leaderboard-self-row"
      >
        {inner}
      </View>
    );
  }

  return (
    <View
      style={rowStyles.row}
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
  sc,
}: {
  onOptIn: (displayName: string) => void;
  saving: boolean;
  sc: SemanticTokens;
}) {
  const [displayName, setDisplayName] = useState('');

  const cardStyles = useMemo(
    () => StyleSheet.create({
      card:        { margin: 20, padding: 24, backgroundColor: sc.bgSurface, borderWidth: 0.5, borderColor: sc.border },
      heading:     { fontFamily: 'Cormorant-SemiBold', fontSize: 22, color: sc.textPrimary, marginBottom: 12 },
      body:        { fontFamily: 'Inter-Regular', fontSize: 14, color: sc.textMuted, lineHeight: 22, marginBottom: 12 },
      nameInput:   { borderWidth: 1, borderColor: sc.border, padding: 12, fontFamily: 'Inter-Regular', fontSize: 14, color: sc.textPrimary, backgroundColor: sc.bgPrimary, marginBottom: 16, marginTop: 4 },
      btn:         { backgroundColor: sc.textPrimary, paddingVertical: 14, alignItems: 'center' as const },
      btnDisabled: { backgroundColor: sc.textMuted },
      btnText:     { fontFamily: 'Inter-Medium', fontSize: 14, color: sc.bgPrimary, letterSpacing: 0.5 },
    }),
    [sc],
  );

  return (
    <View style={cardStyles.card} testID="leaderboard-opt-in-card">
      <Text style={cardStyles.heading}>Join the leaderboard</Text>
      <Text style={cardStyles.body}>
        Opt in to your coach's leaderboard. You'll show up as soon as you log activity.
      </Text>
      <Text style={cardStyles.body}>
        Your combined score reflects check-in consistency, workouts logged, meals
        logged, and coach engagement — weight and monetary data are never shared.
      </Text>
      <TextInput
        style={cardStyles.nameInput}
        placeholder="Display name (optional)"
        placeholderTextColor={sc.textMuted}
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={40}
        autoCapitalize="words"
        testID="leaderboard-display-name-input"
        accessibilityLabel="Display name"
      />
      <Pressable
        style={[cardStyles.btn, saving && cardStyles.btnDisabled]}
        onPress={() => onOptIn(displayName)}
        disabled={saving}
        testID="leaderboard-opt-in-button"
        accessibilityRole="button"
        accessibilityLabel="Opt in to leaderboard"
      >
        <Text style={cardStyles.btnText}>{saving ? 'Saving...' : 'Opt in'}</Text>
      </Pressable>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LeaderboardScreen() {
  const { semanticColors: sc } = useTheme();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardResponse | null>(null);

  const styles = useMemo(() => makeStyles(sc), [sc]);

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
        <ActivityIndicator color={sc.textPrimary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered} testID="leaderboard-error">
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={load} style={styles.retryButton} accessibilityRole="button" accessibilityLabel="Retry loading leaderboard">
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
        renderItem={({ item }) => <RankRow entry={item} sc={sc} />}
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
            <OptInCard onOptIn={handleOptIn} saving={saving} sc={sc} />
          ) : null
        }
      />

      {/* Sticky self-row when not already visible at top */}
      {isOptedIn && selfEntry && selfEntry.rank > 5 && (
        <View style={styles.stickyRow} testID="leaderboard-sticky-self-row">
          <RankRow entry={selfEntry} sc={sc} />
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (sc: SemanticTokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: sc.bgPrimary,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: sc.bgPrimary,
      padding: 24,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
      borderBottomWidth: 0.5,
      borderBottomColor: sc.border,
    },
    title: {
      fontFamily: 'Cormorant-SemiBold',
      fontSize: 28,
      color: sc.textPrimary,
      letterSpacing: 0.2,
    },
    selfRankLabel: {
      fontFamily: 'Inter-Regular',
      fontSize: 13,
      color: sc.textMuted,
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
      color: sc.textMuted,
      width: 32,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    colHeaderName: {
      fontFamily: 'Inter-Medium',
      fontSize: 11,
      color: sc.textMuted,
      flex: 1,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    colHeaderScore: {
      fontFamily: 'Inter-Medium',
      fontSize: 11,
      color: sc.textMuted,
      width: 52,
      textAlign: 'right',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    list: {
      paddingBottom: 32,
    },
    emptyState: {
      padding: 32,
      alignItems: 'center',
    },
    emptyText: {
      fontFamily: 'Inter-Regular',
      fontSize: 14,
      color: sc.textMuted,
      textAlign: 'center',
      lineHeight: 22,
    },
    errorText: {
      fontFamily: 'Inter-Regular',
      fontSize: 14,
      color: sc.textMuted,
      textAlign: 'center',
      lineHeight: 22,
      marginBottom: 16,
    },
    retryButton: {
      paddingVertical: 10,
      paddingHorizontal: 24,
      borderWidth: 1,
      borderColor: sc.textPrimary,
    },
    retryText: {
      fontFamily: 'Inter-Medium',
      fontSize: 14,
      color: sc.textPrimary,
    },
    stickyRow: {
      borderTopWidth: 0.5,
      borderTopColor: sc.border,
      backgroundColor: sc.bgPrimary,
    },
  });
