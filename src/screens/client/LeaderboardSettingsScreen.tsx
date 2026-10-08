/**
 * LeaderboardSettingsScreen — Phase 7C
 *
 * Allows the user to:
 *   - Toggle leaderboard opt-in on/off.
 *   - Set or change their display name (max 40 chars).
 *   - Read a plain-English explainer of what is measured and what is private.
 *
 * Design doctrine:
 *   - Semantic theme palette.
 *   - Cormorant Garamond display, Inter body.
 *   - No emoji, no gamification.
 *   - Default state is opt-out — this screen exists to enable the feature.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavigationContext } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { typography, type SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import {
  getLeaderboard,
  setLeaderboardOptIn,
} from '../../services/leaderboardApi';
import { contentRejectedMessage } from '../../api/communitySafetyApi';

// ─── Explainer component ──────────────────────────────────────────────────────

function MeasuredExplainer({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.explainerCard}>
      <Text style={styles.explainerHeading}>What is measured</Text>

      <Text style={styles.explainerBody}>
        Your combined score is calculated from five parts, all from the last 30 days,
        weighted as follows:
      </Text>

      {([
        ['Check-in consistency', '30%', 'Days you submitted a check-in in the last 30 days.'],
        ['Workouts logged',      '25%', 'Workouts recorded relative to a 3-per-week target.'],
        ['Meals logged',         '20%', 'Food entries logged; 90 in 30 days is the full 20%.'],
        ['Coach engagement',     '15%', 'Messages sent to your coach in the last 30 days.'],
        ['Streak bonus',         '10%', 'Your current check-in streak (30 days = maximum).'],
      ] as const).map(([label, weight, desc]) => (
        <View key={label} style={styles.metricRow}>
          <View style={styles.metricLeft}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={styles.metricWeight}>{weight}</Text>
          </View>
          <Text style={styles.metricDesc}>{desc}</Text>
        </View>
      ))}

      <View style={styles.explainerDivider} />

      <Text style={styles.explainerHeading}>What is never shared</Text>
      <Text style={styles.explainerBody}>
        Your body weight, body fat percentage, income figures, financial account
        balances, and any health data you have not explicitly shared with your
        coach are never surfaced on this leaderboard.
      </Text>

      <View style={styles.explainerDivider} />

      <Text style={styles.explainerHeading}>Who can see you</Text>
      <Text style={styles.explainerBody}>
        Clients on your coach's roster can see your display name and score here.
        Opting out removes your row from this leaderboard.
      </Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LeaderboardSettingsScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [isOptedIn, setIsOptedIn]       = useState(false);
  const [displayName, setDisplayName]   = useState('');
  const [savedName, setSavedName]       = useState('');
  // Both host stacks hide the native header.
  const navigation = React.useContext(NavigationContext);
  const insets = useSafeAreaInsets();
  const canGoBack = navigation?.canGoBack() ?? false;

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await getLeaderboard();
      // Use the explicit backend field — never infer from entries list membership.
      const optedIn = result.viewer.is_opted_in;
      setIsOptedIn(optedIn);
      // When opted in the self entry is in the ranked list; populate the display name from it.
      const selfEntry = result.entries.find((e) => e.isRequester);
      if (selfEntry) {
        setSavedName(selfEntry.displayName ?? '');
        setDisplayName(selfEntry.displayName ?? '');
      }
    } catch {
      setError('Unable to load your leaderboard settings. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (value: boolean) => {
    setError(null);
    setIsOptedIn(value);
    setSaving(true);
    try {
      await setLeaderboardOptIn({
        enabled: value,
        displayName: value && displayName.trim() ? displayName.trim() : undefined,
      });
    } catch (err) {
      // Revert optimistic update; a name the community filter refuses says why.
      setIsOptedIn(!value);
      setError(contentRejectedMessage(err) ?? 'Could not save your preference. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveName = async () => {
    if (!isOptedIn) return;
    setError(null);
    setSaving(true);
    try {
      await setLeaderboardOptIn({
        enabled: true,
        displayName: displayName.trim() || undefined,
      });
      setSavedName(displayName.trim());
    } catch (err) {
      setError(contentRejectedMessage(err) ?? 'Could not save your display name. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const nameChanged = displayName.trim() !== savedName.trim();

  const backBar = canGoBack ? (
    <Pressable
      onPress={() => navigation?.goBack()}
      style={styles.backButton}
      accessibilityRole="button"
      accessibilityLabel="Back"
      testID="leaderboard-settings-back"
    >
      <Ionicons name="chevron-back" size={22} color={sc.accentText} />
      <Text style={styles.backText}>Back</Text>
    </Pressable>
  ) : null;

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {backBar}
        <View style={styles.centered} testID="leaderboard-settings-loading">
          <ActivityIndicator color={sc.accent} size="large" accessibilityLabel="Loading leaderboard settings" />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {backBar}
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Leaderboard settings</Text>
          <Text style={styles.subtitle}>
            Opt in to compare your habit consistency with others on your coach's roster.
          </Text>
        </View>

        {/* Toggle row */}
        <View style={styles.section}>
          <View style={styles.toggleRow} testID="leaderboard-settings-toggle-row">
            <View style={styles.toggleLeft}>
              <Text style={styles.toggleLabel}>Appear on leaderboard</Text>
              <Text style={styles.toggleSub}>
                {isOptedIn ? 'Visible to your coach\'s roster.' : 'Hidden from this leaderboard.'}
              </Text>
            </View>
            <Switch
              value={isOptedIn}
              onValueChange={handleToggle}
              disabled={saving}
              trackColor={{ false: sc.border, true: sc.accent }}
              thumbColor={sc.textOnAccent}
              testID="leaderboard-opt-in-switch"
              accessibilityLabel="Toggle leaderboard opt-in"
            />
          </View>
        </View>

        {/* Display name */}
        {isOptedIn && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Display name</Text>
            <Text style={styles.sectionSub}>
              Shown to your coach's other clients. Max 40 characters. Leave blank to use
              your first name and last initial.
            </Text>
            <TextInput
              style={styles.nameInput}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="e.g. Alex T."
              placeholderTextColor={sc.textMuted}
              maxLength={40}
              autoCapitalize="words"
              testID="leaderboard-settings-name-input"
            />
            {nameChanged && (
              <Pressable
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={handleSaveName}
                disabled={saving}
                testID="leaderboard-settings-save-name"
                accessibilityRole="button"
                accessibilityLabel="Save display name"
              >
                <Text style={[styles.saveButtonText, saving && { color: sc.textOnDisabled }]}>{saving ? 'Saving…' : 'Save name'}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* Error */}
        {error && (
          <View style={styles.errorBanner} testID="leaderboard-settings-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Explainer */}
        <MeasuredExplainer styles={styles} />

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: sc.bgPrimary,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: sc.bgPrimary,
  },
  scrollContent: {
    paddingBottom: 48,
  },
  backButton: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  backText: { fontFamily: 'Inter-Medium', fontSize: 15, color: sc.accentText },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: sc.border,
  },
  title: {
    ...typography.h1,
    color: sc.textPrimary,
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: sc.textMuted,
    lineHeight: 21,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: sc.border,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLeft: {
    flex: 1,
    marginRight: 16,
  },
  toggleLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 15,
    color: sc.textPrimary,
  },
  toggleSub: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: sc.textMuted,
    marginTop: 3,
  },
  sectionLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: sc.textPrimary,
    marginBottom: 4,
  },
  sectionSub: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: sc.textMuted,
    lineHeight: 18,
    marginBottom: 12,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: sc.border,
    padding: 12,
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: sc.textPrimary,
    backgroundColor: sc.bgPrimary,
    marginBottom: 12,
  },
  saveButton: {
    backgroundColor: sc.accent,
    borderRadius: 4,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: sc.disabledBg,
  },
  saveButtonText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: sc.textOnAccent,
    letterSpacing: 0.4,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    padding: 12,
  },
  errorText: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: sc.textPrimary,
    lineHeight: 20,
  },
  explainerCard: {
    margin: 20,
    paddingVertical: 20,
  },
  explainerHeading: {
    fontFamily: 'Inter-Medium',
    fontSize: 18,
    color: sc.textPrimary,
    marginBottom: 10,
  },
  explainerBody: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: sc.textMuted,
    lineHeight: 21,
    marginBottom: 14,
  },
  explainerDivider: {
    height: 0.5,
    backgroundColor: sc.border,
    marginVertical: 16,
  },
  metricRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  metricLeft: {
    width: 120,
    marginRight: 12,
  },
  metricLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: sc.textPrimary,
  },
  metricWeight: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: sc.textMuted,
    fontVariant: ['tabular-nums'],
    marginTop: 1,
  },
  metricDesc: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: sc.textMuted,
    lineHeight: 18,
  },
});
