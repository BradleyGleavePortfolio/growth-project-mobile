/**
 * Day1WinScreen — Phase 7A: Day 1 Win Sequence
 *
 * Shown once to every new client on their first cold app open after
 * onboarding. Presents three quick-win cards. Tapping one calls
 * POST /me/first-win/complete, shows the 2-sentence AI coaching message,
 * then navigates the client into the main app.
 *
 * Design doctrine:
 *   - bone/ink/forest palette via useTheme().colors only — no hex codes.
 *   - Cormorant Garamond for display text, Inter for body copy.
 *   - No emoji. No gamification chrome. No celebration chrome.
 *   - Every interactive element has accessibilityLabel + accessibilityRole.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  StyleSheet,
  Alert,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { firstWinApi, WinType } from '../../services/firstWinApi';
import { track } from '../../lib/analytics';
import { typography } from '../../theme/tokens';

// ── Win card definitions ──────────────────────────────────────────────────────

interface WinCard {
  id: WinType;
  title: string;
  description: string;
}

const WIN_CARDS: WinCard[] = [
  {
    id: 'logged_first_weight',
    title: 'Log your starting weight',
    description: 'One number. Sets the baseline every future measurement is compared against.',
  },
  {
    id: 'first_checkin',
    title: 'Submit your first check-in',
    description: 'Opens the daily feedback loop between you and your coach.',
  },
  {
    id: 'first_meal',
    title: 'Log your first meal',
    description: 'Three days of honest food data tells your coach more than any intake form.',
  },
];

// Static testIDs for each card. Template literals would not be detectable by
// source-guard tests that scan the file as a plain string.
const WIN_CARD_TEST_IDS: Record<WinType, string> = {
  logged_first_weight: 'day1win-card-logged_first_weight',
  set_first_goal:      'day1win-card-set_first_goal',
  first_checkin:       'day1win-card-first_checkin',
  first_meal:          'day1win-card-first_meal',
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface Day1WinScreenProps {
  // When invoked with a winType, RootNavigator transitions to the main app
  // and deep-links into the corresponding logger screen. When invoked without
  // args (skip / API failure continue), it just transitions to the main app.
  onComplete: (target?: WinType) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Day1WinScreen({ onComplete }: Day1WinScreenProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [selectedWin, setSelectedWin] = useState<WinType | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [failureCount, setFailureCount] = useState(0);

  const handleSelectWin = useCallback(
    async (winType: WinType) => {
      if (loading) return;
      setSelectedWin(winType);
      setLoading(true);

      try {
        const response = await firstWinApi.complete(winType);
        const { aiMessage: msg } = response.data;
        setAiMessage(msg);
        setDone(true);
        track('day1_win_completed', { winType });
      } catch (err) {
        // Surface the error but don't block the user — they can try again.
        setLoading(false);
        setSelectedWin(null);
        setFailureCount((n) => n + 1);
        Alert.alert(
          'Connection issue',
          'Could not record your win. Check your connection and try again, or continue without recording.',
        );
      }
    },
    [loading],
  );

  // Continue without selecting a win — used by skip and by the persistent-
  // failure escape hatch. Routes straight into the main app.
  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Continue from the completion view — routes to the matching logger.
  const handleContinue = useCallback(() => {
    onComplete(selectedWin ?? undefined);
  }, [onComplete, selectedWin]);

  // ── Completion state ────────────────────────────────────────────────────────

  if (done && aiMessage) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={styles.completionContainer}
          testID="day1win-complete-view"
        >
          <Text style={styles.completionEyebrow}>YOUR FIRST DATA POINT</Text>
          <Text style={styles.completionHeadline}>
            {WIN_CARDS.find((c) => c.id === selectedWin)?.title ?? 'First win logged.'}
          </Text>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <Text style={styles.aiMessageText}>{aiMessage}</Text>

          <Pressable
            style={[styles.continueButton, { backgroundColor: colors.primary }]}
            onPress={handleContinue}
            accessibilityLabel="Continue to the app"
            accessibilityRole="button"
            testID="day1win-continue-button"
          >
            <Text style={[styles.continueButtonText, { color: colors.textOnPrimary }]}>
              CONTINUE
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Selection state ─────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={styles.selectionContainer}
        testID="day1win-selection-view"
      >
        <Text style={styles.eyebrow}>DAY ONE</Text>
        <Text style={styles.headline}>One action.{'\n'}Your programme starts here.</Text>
        <Text style={styles.subtext}>
          Pick the action you can do right now. It takes less than 60 seconds.
        </Text>

        <View style={styles.cardList}>
          {WIN_CARDS.map((card) => {
            const isSelected = selectedWin === card.id;
            return (
              <Pressable
                key={card.id}
                style={[
                  styles.winCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: isSelected ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => handleSelectWin(card.id)}
                disabled={loading}
                accessibilityLabel={card.title}
                accessibilityRole="button"
                testID={WIN_CARD_TEST_IDS[card.id]}
              >
                {loading && isSelected ? (
                  <ActivityIndicator
                    size="small"
                    color={colors.primary}
                    style={styles.cardSpinner}
                  />
                ) : null}
                <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                  {card.title}
                </Text>
                <Text style={[styles.cardDescription, { color: colors.textMuted }]}>
                  {card.description}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={styles.skipButton}
          onPress={handleSkip}
          accessibilityLabel="Skip and continue to the app"
          accessibilityRole="button"
          testID="day1win-skip-button"
        >
          <Text style={[styles.skipText, { color: colors.textMuted }]}>Skip for now</Text>
        </Pressable>

        {/* Persistent-API-failure escape hatch: after 2 failed attempts a new
            client can continue into the main app without their win recorded.
            The status endpoint will retry on next boot. */}
        {failureCount >= 2 ? (
          <Pressable
            style={styles.skipButton}
            onPress={handleSkip}
            accessibilityLabel="Continue without recording, your win can be logged later"
            accessibilityRole="button"
            testID="day1win-continue-anyway-button"
          >
            <Text style={[styles.skipText, { color: colors.textMuted }]}>
              Continue anyway — try again later
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

function makeStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    selectionContainer: {
      padding: 24,
      paddingTop: 48,
    },
    completionContainer: {
      padding: 24,
      paddingTop: 64,
      flexGrow: 1,
      justifyContent: 'center',
    },
    eyebrow: {
      ...typography.eyebrow,
      color: colors.primary,
      marginBottom: 16,
    },
    headline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 36,
      lineHeight: 40,
      color: colors.textPrimary,
      marginBottom: 12,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      lineHeight: 24,
      color: colors.textMuted,
      marginBottom: 32,
    },
    cardList: {
      gap: 12,
      marginBottom: 32,
    },
    winCard: {
      padding: 20,
      borderWidth: 1,
      borderRadius: 2,
    },
    cardSpinner: {
      marginBottom: 8,
      alignSelf: 'flex-start',
    },
    cardTitle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 4,
    },
    cardDescription: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      lineHeight: 20,
    },
    skipButton: {
      alignSelf: 'center',
      paddingVertical: 12,
    },
    skipText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
    },

    // Completion view
    completionEyebrow: {
      ...typography.eyebrow,
      color: colors.primary,
      marginBottom: 16,
    },
    completionHeadline: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      lineHeight: 34,
      color: colors.textPrimary,
      marginBottom: 24,
    },
    divider: {
      height: 1,
      marginBottom: 24,
    },
    aiMessageText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 16,
      lineHeight: 26,
      color: colors.textPrimary,
      marginBottom: 48,
    },
    continueButton: {
      height: 52,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 0,
    },
    continueButtonText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      letterSpacing: 1.4,
    },
  });
}
