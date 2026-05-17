/**
 * LeaderboardSettingsScreen — Phase 7C
 *
 * Allows the user to:
 *   - Toggle leaderboard opt-in on/off.
 *   - Set or change their display name (max 40 chars).
 *   - Read a plain-English explainer of what is measured and what is private.
 *
 * Design doctrine:
 *   - Bone/ink/oxblood palette.
 *   - Cormorant Garamond display, Inter body.
 *   - No emoji, no gamification.
 *   - Default state is opt-out — this screen exists to enable the feature.
 */
import React, { useCallback, useEffect, useState } from 'react';
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
import { colors } from '../../theme/tokens';
import { Colors } from '../../constants/colors';
import {
  getLeaderboard,
  setLeaderboardOptIn,
} from '../../services/leaderboardApi';

const OXBLOOD = Colors.earningsAccent;

// ─── Explainer component ──────────────────────────────────────────────────────

function MeasuredExplainer() {
  return (
    <View style={styles.explainerCard}>
      <Text style={styles.explainerHeading}>What is measured</Text>

      <Text style={styles.explainerBody}>
        Your combined score is calculated from four habit signals in the last 30 days,
        weighted as follows:
      </Text>

      {([
        ['Check-in consistency', '30%', 'Days you submitted a check-in in the last 30 days.'],
        ['Workouts logged',      '25%', 'Workouts recorded relative to a 3-per-week target.'],
        ['Meals logged',         '20%', 'Meals recorded relative to a 3-per-day target.'],
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
        coach are never surfaced on the leaderboard — not now, not in the future.
      </Text>

      <View style={styles.explainerDivider} />

      <Text style={styles.explainerHeading}>Who can see you</Text>
      <Text style={styles.explainerBody}>
        Only clients assigned to the same coach as you will see your display name
        and score. The leaderboard is never platform-wide. You can opt out at any
        time and your row disappears immediately.
      </Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function LeaderboardSettingsScreen() {
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const [isOptedIn, setIsOptedIn]       = useState(false);
  const [displayName, setDisplayName]   = useState('');
  const [savedName, setSavedName]       = useState('');

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
    setIsOptedIn(value);
    setSaving(true);
    try {
      await setLeaderboardOptIn({
        enabled: value,
        displayName: value && displayName.trim() ? displayName.trim() : undefined,
      });
    } catch {
      // Revert optimistic update
      setIsOptedIn(!value);
      setError('Could not save your preference. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveName = async () => {
    if (!isOptedIn) return;
    setSaving(true);
    try {
      await setLeaderboardOptIn({
        enabled: true,
        displayName: displayName.trim() || undefined,
      });
      setSavedName(displayName.trim());
    } catch {
      setError('Could not save your display name. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const nameChanged = displayName.trim() !== savedName.trim();

  if (loading) {
    return (
      <View style={styles.centered} testID="leaderboard-settings-loading">
        <ActivityIndicator color={colors.ink} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
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
                {isOptedIn ? 'Visible to your coach\'s roster.' : 'Hidden from all leaderboards.'}
              </Text>
            </View>
            <Switch
              value={isOptedIn}
              onValueChange={handleToggle}
              disabled={saving}
              trackColor={{ false: colors.stone, true: colors.forest }}
              thumbColor={colors.bone}
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
              placeholderTextColor={colors.stone}
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
                <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save name'}</Text>
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
        <MeasuredExplainer />

      </ScrollView>
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
  },
  scrollContent: {
    paddingBottom: 48,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.stone,
  },
  title: {
    fontFamily: 'Cormorant-SemiBold',
    fontSize: 26,
    color: colors.ink,
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    color: colors.charcoal,
    lineHeight: 21,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.stone,
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
    color: colors.ink,
  },
  toggleSub: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: colors.stone,
    marginTop: 3,
  },
  sectionLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: colors.ink,
    marginBottom: 4,
  },
  sectionSub: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: colors.stone,
    lineHeight: 18,
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
    marginBottom: 12,
  },
  saveButton: {
    backgroundColor: colors.ink,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: colors.stone,
  },
  saveButtonText: {
    fontFamily: 'Inter-Medium',
    fontSize: 14,
    color: colors.bone,
    letterSpacing: 0.4,
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: Colors.noticeCriticalUltraBg,
    borderLeftWidth: 3,
    borderLeftColor: OXBLOOD,
    padding: 12,
  },
  errorText: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: OXBLOOD,
    lineHeight: 20,
  },
  explainerCard: {
    margin: 20,
    padding: 20,
    backgroundColor: colors.cream,
    borderWidth: 0.5,
    borderColor: colors.stone,
  },
  explainerHeading: {
    fontFamily: 'Cormorant-SemiBold',
    fontSize: 18,
    color: colors.ink,
    marginBottom: 10,
  },
  explainerBody: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: colors.charcoal,
    lineHeight: 21,
    marginBottom: 14,
  },
  explainerDivider: {
    height: 0.5,
    backgroundColor: colors.stone,
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
    color: colors.ink,
  },
  metricWeight: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: colors.forest,
    marginTop: 1,
  },
  metricDesc: {
    flex: 1,
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    color: colors.charcoal,
    lineHeight: 18,
  },
});
