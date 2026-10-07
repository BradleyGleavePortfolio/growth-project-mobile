/**
 * LeaderboardScreen — Phase 7C
 * Phase 11: Migrated to useTheme() semantic tokens for dark-mode support.
 *
 * Displays the combined-score leaderboard for the requesting user's
 * coach roster. Only opted-in peers appear. A computed self-rank and score
 * lead the screen; the self row keeps its stable identifier.
 *
 * Design doctrine:
 *   - Semantic theme palette, unfilled rows and hairline separators.
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContext } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { typography, type SemanticTokens } from '../../theme/tokens';
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
      <View style={[barStyles.fill, { width: `${score}%` }]} />
    </View>
  );
}

/**
 * Renders a single rank row.
 * The self-row (isRequester) uses a distinct text weight
 * and a stable testID so UI tests can reliably locate it.
 */
function RankRow({ entry, sc }: { entry: LeaderboardEntry; sc: SemanticTokens }) {
  const isMe = entry.isRequester;
  const hasDelta = entry.weekDelta !== null && entry.weekDelta !== 0;
  const deltaSign = (entry.weekDelta ?? 0) > 0 ? '+' : '';
  const deltaColor = sc.textMuted;

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
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: sc.border,
      },
      rankText: { fontFamily: 'Inter-Medium', fontSize: 14, color: sc.textMuted, width: 32, fontVariant: ['tabular-nums'] },
      nameText: { fontFamily: 'Inter-Regular', fontSize: 15, color: sc.textPrimary, marginBottom: 5 },
      nameTextMe: { fontFamily: 'Inter-SemiBold', color: sc.textPrimary },
      rowMiddle: { flex: 1, marginRight: 12 },
      scoreBlock: { alignItems: 'flex-end', width: 52 },
      scoreText: { fontFamily: 'Inter-SemiBold', fontSize: 18, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
      deltaText: { fontFamily: 'Inter-Regular', fontSize: 13, marginTop: 2, fontVariant: ['tabular-nums'] },
    }),
    [sc],
  );

  // One spoken sentence per row instead of five loose fragments.
  const deltaSpoken = hasDelta
    ? `, ${(entry.weekDelta ?? 0) > 0 ? 'up' : 'down'} ${Math.abs(entry.weekDelta ?? 0)} since the last update`
    : '';
  const rowLabel = `Rank ${entry.rank}, ${isMe ? 'you, ' : ''}${entry.displayName}, score ${entry.combinedScore} of 100${deltaSpoken}`;

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

  // Self-row: stable testID for UI tests.
  if (isMe) {
    return (
      <View
        style={[rowStyles.row, rowStyles.rowHighlighted]}
        accessible
        accessibilityRole="text"
        accessibilityLabel={rowLabel}
        testID="leaderboard-self-row"
      >
        {inner}
      </View>
    );
  }

  return (
    <View
      style={rowStyles.row}
      accessible
      accessibilityRole="text"
      accessibilityLabel={rowLabel}
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
      card:        { margin: 20, paddingVertical: 24, borderTopWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
      heading:     { ...typography.h2, color: sc.textPrimary, marginBottom: 12 },
      body:        { fontFamily: 'Inter-Regular', fontSize: 14, color: sc.textMuted, lineHeight: 22, marginBottom: 12 },
      nameInput:   { borderWidth: 1, borderColor: sc.border, padding: 12, fontFamily: 'Inter-Regular', fontSize: 14, color: sc.textPrimary, backgroundColor: sc.bgPrimary, marginBottom: 16, marginTop: 4 },
      btn:         { backgroundColor: sc.accent, borderRadius: 4, minHeight: 48, paddingVertical: 14, alignItems: 'center' as const },
      btnDisabled: { backgroundColor: sc.disabledBg },
      btnText:     { fontFamily: 'Inter-Medium', fontSize: 14, color: saving ? sc.textOnDisabled : sc.textOnAccent, letterSpacing: 0.5 },
    }),
    [sc, saving],
  );

  return (
    <View style={cardStyles.card} testID="leaderboard-opt-in-card">
      <Text style={cardStyles.heading}>Join the leaderboard</Text>
      <Text style={cardStyles.body}>
        Opt in to show your display name and combined score on your coach's leaderboard.
      </Text>
      <Text style={cardStyles.body}>
        Your combined score reflects check-in consistency, workouts logged, meals
        logged, coach engagement, and check-in streak. Weight and monetary data are not shown here.
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
  // The board ranks one coach's clients: no coach, no board (never an error).
  const client = useCurrentUser();
  const insets = useSafeAreaInsets();
  const hasCoach = Boolean(client?.coach_id);
  // Both host stacks hide the native header; context works outside a navigator.
  const navigation = React.useContext(NavigationContext);
  const canGoBack = navigation?.canGoBack() ?? false;

  const styles = useMemo(() => makeStyles(sc), [sc]);

  // Use the explicit backend field — never infer from entries list membership.
  const isOptedIn = data?.viewer.is_opted_in ?? false;

  const load = useCallback(async (silent = false) => {
    setError(null);
    if (!silent) setLoading(true);
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
    if (!hasCoach) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, hasCoach]);

  // Coming back from Settings (opt in, opt out, rename) shows the new state.
  const leftScreen = useRef(false);
  useEffect(() => {
    if (!navigation || !hasCoach) return undefined;
    const offBlur = navigation.addListener('blur', () => { leftScreen.current = true; });
    const offFocus = navigation.addListener('focus', () => {
      if (leftScreen.current) void load(true);
      leftScreen.current = false;
    });
    return () => { offBlur(); offFocus(); };
  }, [navigation, hasCoach, load]);

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

  const topBar = (
    <View style={styles.topBar}>
      {canGoBack ? (
        <Pressable
          onPress={() => navigation?.goBack()}
          style={styles.topBarButton}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="leaderboard-back"
        >
          <Ionicons name="chevron-back" size={22} color={sc.accent} />
          <Text style={[styles.topBarText, { color: sc.accent }]}>Back</Text>
        </Pressable>
      ) : <View />}
      {hasCoach ? (
        <Pressable
          onPress={() => navigation?.navigate('LeaderboardSettings')}
          style={styles.topBarButton}
          accessibilityRole="button"
          accessibilityLabel="Leaderboard settings: opt in or out and set a display name"
          testID="leaderboard-settings-link"
        >
          <Text style={[styles.topBarText, { color: sc.accent }]}>Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );

  // Loading, error and no-coach share one shell so Back is always reachable.
  const shell = (testID: string, children: React.ReactNode) => (
    <SafeAreaView style={styles.container} edges={['top']}>
      {topBar}
      <View style={styles.centered} testID={testID}>{children}</View>
    </SafeAreaView>
  );

  if (!hasCoach) {
    return shell('leaderboard-no-coach', (
      <>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={[styles.emptyText, { marginTop: 12 }]}>
          The leaderboard ranks clients of the same coach. It opens once a coach adds you to
          their roster.
        </Text>
      </>
    ));
  }

  if (loading) {
    return shell('leaderboard-loading', (
      <ActivityIndicator color={sc.textPrimary} size="large" accessibilityLabel="Loading leaderboard" />
    ));
  }

  if (error) {
    return shell('leaderboard-error', (
      <>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => void load()} style={styles.retryButton} accessibilityRole="button" accessibilityLabel="Retry loading leaderboard">
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </>
    ));
  }

  const publicEntries = data?.entries.filter((e) => !e.isRequester || isOptedIn) ?? [];
  const selfEntry = data?.entries.find((e) => e.isRequester);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {topBar}
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        {isOptedIn && data?.selfRank != null && selfEntry && (
          <View testID="leaderboard-self-hero" style={{ marginTop: 20, gap: 4 }}>
            <Text style={styles.selfRankLabel}>Your rank: {data.selfRank}</Text>
            <Text style={styles.heroScore}>{selfEntry.combinedScore} of 100</Text>
          </View>
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
                No leaderboard entries to show yet.
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
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
    topBarButton: { minHeight: 44, minWidth: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
    topBarText: { fontFamily: 'Inter-Medium', fontSize: 15 },
    header: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 24,
      borderBottomWidth: 0.5,
      borderBottomColor: sc.border,
    },
    title: {
      ...typography.h1,
      color: sc.textPrimary,
      letterSpacing: 0.2,
    },
    selfRankLabel: {
      fontFamily: 'Inter-Regular',
      fontSize: 13,
      color: sc.textMuted,
      marginTop: 4,
      fontVariant: ['tabular-nums'],
    },
    heroScore: { ...typography.display, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
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
      minHeight: 48,
      justifyContent: 'center',
      borderRadius: 4,
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
